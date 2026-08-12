"""
Benchmark the fastdoc fast path against the Marker OCR pipeline.

Three modes, cheapest first:

  triage    Probe every file's text layer and report how many could skip OCR.
            Loads no models — run this first on a real batch to find out
            whether the fast path is worth anything on your corpus.

  fast      Convert with fastdoc only and report throughput.

  compare   Convert with both and report time, size, and text agreement.
            Loads the Marker models, so it needs a GPU to be quick.

Examples:
    python bench_fastdoc.py triage  D:\\batches\\incoming
    python bench_fastdoc.py fast    D:\\batches\\incoming --out md_out
    python bench_fastdoc.py compare D:\\batches\\incoming --limit 10 --out md_out
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import fastdoc  # noqa: E402

SCAN_EXTS = {
    ".pdf", ".docx", ".xlsx", ".pptx", ".csv", ".txt",
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif",
}


def collect(target: Path, limit: int | None) -> list[Path]:
    if target.is_file():
        files = [target]
    else:
        files = sorted(
            p for p in target.rglob("*") if p.is_file() and p.suffix.lower() in SCAN_EXTS
        )
    return files[:limit] if limit else files


def warm_up() -> None:
    """Import and JIT-warm pdftext so the first file is not charged for it."""
    import pdftext.extraction  # noqa: F401


def fmt_ms(value: float) -> str:
    return f"{value:8.1f}ms"


# --------------------------------------------------------------------------
# triage
# --------------------------------------------------------------------------


def run_triage(files: list[Path], args) -> int:
    rows = []
    print(f"{'file':<44} {'format':<7} {'route':<10} {'probe':>10}  reason")
    print("-" * 110)
    for path in files:
        result = fastdoc.triage(path)
        route = "OCR" if result.needs_ocr else "fast"
        if not result.ok and not result.needs_ocr:
            route = "unsupported"
        rows.append((path, result, route))
        print(
            f"{path.name[:43]:<44} {result.format:<7} {route:<10} "
            f"{fmt_ms(result.elapsed_ms)}  {result.reason or result.error}"
        )

    fast = [r for _, r, route in rows if route == "fast"]
    ocr = [r for _, r, route in rows if route == "OCR"]
    other = [r for _, r, route in rows if route == "unsupported"]
    total = len(rows) or 1
    probe_times = [r.elapsed_ms for _, r, _ in rows]

    print("-" * 110)
    print(f"total files      : {len(rows)}")
    print(f"fast path        : {len(fast):>4}  ({len(fast) / total:.0%})")
    print(f"needs OCR        : {len(ocr):>4}  ({len(ocr) / total:.0%})")
    if other:
        print(f"unsupported      : {len(other):>4}")
    print(
        f"triage cost      : median {statistics.median(probe_times):.1f}ms, "
        f"total {sum(probe_times) / 1000:.2f}s"
    )
    if fast:
        print(
            "\nEvery file on the fast path is GPU time you no longer spend. "
            f"Run `compare` on those {len(fast)} to see the size of the win."
        )
    if args.json:
        Path(args.json).write_text(
            json.dumps(
                [{"file": str(p), **r.as_dict(), "route": route} for p, r, route in rows],
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        print(f"\nwrote {args.json}")
    return 0


# --------------------------------------------------------------------------
# fast
# --------------------------------------------------------------------------


def run_fast(files: list[Path], args) -> int:
    out_dir = Path(args.out) if args.out else None
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)

    times, converted, skipped, failed = [], 0, 0, 0
    print(f"{'file':<44} {'format':<7} {'time':>10} {'chars':>8}  status")
    print("-" * 100)
    for path in files:
        result = fastdoc.convert(path, page_breaks=args.page_breaks, force=args.force)
        if result.ok:
            converted += 1
            times.append(result.elapsed_ms)
            status = "ok" if not result.needs_ocr else "ok (forced, sparse)"
            if out_dir:
                (out_dir / f"{path.stem}.md").write_text(result.markdown, encoding="utf-8")
        elif result.needs_ocr:
            skipped += 1
            status = f"-> OCR: {result.reason}"
        else:
            failed += 1
            status = f"FAIL: {result.error}"
        print(
            f"{path.name[:43]:<44} {result.format:<7} {fmt_ms(result.elapsed_ms)} "
            f"{len(result.markdown):>8}  {status}"
        )

    print("-" * 100)
    print(f"converted {converted}, routed to OCR {skipped}, failed {failed}")
    if times:
        print(
            f"fast path: median {statistics.median(times):.1f}ms, "
            f"mean {statistics.mean(times):.1f}ms, max {max(times):.1f}ms"
        )
    if out_dir:
        print(f"markdown written to {out_dir}")
    return 0


# --------------------------------------------------------------------------
# compare
# --------------------------------------------------------------------------


def _similarity(a: str, b: str) -> float:
    """How much of Marker's text the fast path also captured (0-100)."""
    try:
        from rapidfuzz.fuzz import token_set_ratio
    except ImportError:
        return -1.0
    return round(token_set_ratio(" ".join(a.split()), " ".join(b.split())), 1)


def run_compare(files: list[Path], args) -> int:
    print("loading Marker models (this is the cost the fast path avoids)...")
    load_start = time.perf_counter()
    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict
    from marker.output import text_from_rendered

    models = create_model_dict()
    print(f"models loaded in {time.perf_counter() - load_start:.1f}s\n")

    out_dir = Path(args.out) if args.out else None
    if out_dir:
        (out_dir / "fastdoc").mkdir(parents=True, exist_ok=True)
        (out_dir / "marker").mkdir(parents=True, exist_ok=True)

    rows = []
    header = (
        f"{'file':<34} {'route':<5} {'fastdoc':>10} {'marker':>10} "
        f"{'speedup':>8} {'fast ch':>8} {'mk ch':>8} {'sim':>6}"
    )
    print(header)
    print("-" * len(header))

    for path in files:
        fast = fastdoc.convert(path, page_breaks=False, force=True)

        marker_start = time.perf_counter()
        marker_md, marker_err = "", ""
        try:
            converter = PdfConverter(artifact_dict=models)
            marker_md, _, _ = text_from_rendered(converter(str(path)))
        except Exception as exc:
            marker_err = f"{type(exc).__name__}: {exc}"
        marker_ms = (time.perf_counter() - marker_start) * 1000

        route = "OCR" if fast.needs_ocr else "fast"
        speedup = marker_ms / fast.elapsed_ms if fast.elapsed_ms > 0 else 0.0
        sim = _similarity(fast.markdown, marker_md) if (fast.ok and marker_md) else -1.0

        rows.append(
            {
                "file": path.name,
                "format": fast.format,
                "route": route,
                "fastdoc_ms": round(fast.elapsed_ms, 1),
                "marker_ms": round(marker_ms, 1),
                "speedup": round(speedup, 1),
                "fastdoc_chars": len(fast.markdown),
                "marker_chars": len(marker_md),
                "similarity": sim,
                "fastdoc_error": fast.error,
                "marker_error": marker_err,
            }
        )
        print(
            f"{path.name[:33]:<34} {route:<5} {fmt_ms(fast.elapsed_ms)} "
            f"{fmt_ms(marker_ms)} {speedup:>7.1f}x {len(fast.markdown):>8} "
            f"{len(marker_md):>8} {sim:>6.1f}"
        )
        if out_dir:
            (out_dir / "fastdoc" / f"{path.stem}.md").write_text(
                fast.markdown, encoding="utf-8"
            )
            (out_dir / "marker" / f"{path.stem}.md").write_text(
                marker_md, encoding="utf-8"
            )

    print("-" * len(header))
    fast_rows = [r for r in rows if r["route"] == "fast"]
    if fast_rows:
        saved = sum(r["marker_ms"] - r["fastdoc_ms"] for r in fast_rows) / 1000
        print(
            f"{len(fast_rows)} file(s) on the fast path: "
            f"median speedup {statistics.median(r['speedup'] for r in fast_rows):.0f}x, "
            f"{saved:.1f}s of OCR time avoided"
        )
        sims = [r["similarity"] for r in fast_rows if r["similarity"] >= 0]
        if sims:
            print(
                f"text agreement with Marker: median {statistics.median(sims):.1f}, "
                f"min {min(sims):.1f}  (100 = same tokens)"
            )
    ocr_rows = [r for r in rows if r["route"] == "OCR"]
    if ocr_rows:
        print(
            f"{len(ocr_rows)} file(s) correctly kept on OCR "
            f"(fast path recovered a median of {statistics.median(r['fastdoc_chars'] for r in ocr_rows):.0f} chars — "
            "this is what you would lose by forcing them onto the fast path)"
        )
    if args.json:
        Path(args.json).write_text(
            json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(f"wrote {args.json}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("mode", choices=["triage", "fast", "compare"])
    parser.add_argument("target", type=Path, help="file or directory to process")
    parser.add_argument("--limit", type=int, default=None, help="process at most N files")
    parser.add_argument("--out", default=None, help="write markdown output here")
    parser.add_argument("--json", default=None, help="write per-file results as JSON")
    parser.add_argument(
        "--page-breaks", action="store_true", help="emit page markers in fastdoc output"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="fast-convert scanned PDFs too, to see what the text layer holds",
    )
    args = parser.parse_args()

    if not args.target.exists():
        print(f"no such path: {args.target}", file=sys.stderr)
        return 2

    files = collect(args.target, args.limit)
    if not files:
        print(f"no supported files under {args.target}", file=sys.stderr)
        return 2

    warm_up()
    print(f"{len(files)} file(s) from {args.target}\n")

    if args.mode == "triage":
        return run_triage(files, args)
    if args.mode == "fast":
        return run_fast(files, args)
    return run_compare(files, args)


if __name__ == "__main__":
    raise SystemExit(main())
