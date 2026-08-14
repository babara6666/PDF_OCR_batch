"""
The router that ties the three stages together, plus the OCR triage that is
the whole point of adding this alongside Marker.

    detect (bytes) -> parse (per format) -> serialize (one GFM writer)

For PDFs the router first probes the text layer. A PDF that already carries
its text is converted here in milliseconds; a scan is handed back with
``needs_ocr=True`` so the caller can spend GPU time only where it is needed.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path

from .detect import IMAGE_FORMATS, detect_file
from .model import Document
from .parsers import office, pdf as pdf_parser
from .serialize import to_markdown

# Formats the fast path can convert with no model.
SUPPORTED = {"pdf", "docx", "xlsx", "pptx", "csv", "txt"}


@dataclass
class Result:
    ok: bool
    format: str = ""
    markdown: str = ""
    needs_ocr: bool = False
    reason: str = ""
    elapsed_ms: float = 0.0
    probe: dict | None = None
    warnings: list[str] = field(default_factory=list)
    error: str = ""

    def as_dict(self) -> dict:
        return {
            "ok": self.ok,
            "format": self.format,
            "markdown": self.markdown,
            "needs_ocr": self.needs_ocr,
            "reason": self.reason,
            "elapsed_ms": round(self.elapsed_ms, 2),
            "probe": self.probe,
            "warnings": self.warnings,
            "error": self.error,
        }


def triage(path: str | Path) -> Result:
    """Decide whether a file needs OCR, without converting it.

    Cheap enough to run over a whole batch before dispatching any work:
    a PDF text-layer probe reads text objects only, never renders a page.
    """
    started = time.perf_counter()
    fmt = detect_file(path)
    elapsed = lambda: (time.perf_counter() - started) * 1000  # noqa: E731

    if fmt in IMAGE_FORMATS:
        return Result(
            ok=True,
            format=fmt,
            needs_ocr=True,
            reason="image input has no text layer",
            elapsed_ms=elapsed(),
        )
    if fmt == "pdf":
        try:
            probe = pdf_parser.probe(pdf_parser.read_pages(path))
        except Exception as exc:
            return Result(
                ok=False,
                format=fmt,
                needs_ocr=True,
                reason="text-layer probe failed",
                error=f"{type(exc).__name__}: {exc}",
                elapsed_ms=elapsed(),
            )
        return Result(
            ok=True,
            format=fmt,
            needs_ocr=probe.needs_ocr,
            reason=probe.reason or "text layer usable",
            probe=probe.__dict__,
            elapsed_ms=elapsed(),
        )
    if fmt in SUPPORTED:
        return Result(
            ok=True, format=fmt, needs_ocr=False, reason="structured format", elapsed_ms=elapsed()
        )
    return Result(
        ok=False,
        format=fmt,
        needs_ocr=False,
        reason="unsupported format",
        error=f"fastdoc cannot convert '{fmt}'",
        elapsed_ms=elapsed(),
    )


def _parse(path: str | Path, fmt: str, page_breaks: bool) -> Document:
    if fmt == "docx":
        return office.parse_docx(path)
    if fmt == "xlsx":
        return office.parse_xlsx(path)
    if fmt == "pptx":
        return office.parse_pptx(path)
    if fmt == "csv":
        return office.parse_csv(path)
    if fmt == "txt":
        return office.parse_txt(path)
    raise ValueError(f"no parser for format '{fmt}'")


def convert(
    path: str | Path,
    page_breaks: bool = False,
    force: bool = False,
) -> Result:
    """Convert a file to Markdown on the fast path.

    ``force=True`` converts a scanned PDF anyway, returning whatever sparse
    text it holds — useful for measuring what the fast path would have missed.
    """
    started = time.perf_counter()
    fmt = detect_file(path)

    if fmt in IMAGE_FORMATS:
        return Result(
            ok=False,
            format=fmt,
            needs_ocr=True,
            reason="image input has no text layer",
            error="fastdoc cannot read images; use the OCR pipeline",
            elapsed_ms=(time.perf_counter() - started) * 1000,
        )

    try:
        if fmt == "pdf":
            pages = pdf_parser.read_pages(path)
            probe = pdf_parser.probe(pages)
            if probe.needs_ocr and not force:
                return Result(
                    ok=False,
                    format=fmt,
                    needs_ocr=True,
                    reason=probe.reason,
                    probe=probe.__dict__,
                    error="scanned PDF; OCR required",
                    elapsed_ms=(time.perf_counter() - started) * 1000,
                )
            doc = pdf_parser.parse_pages(pages, page_breaks=page_breaks)
            markdown = to_markdown(doc)
            return Result(
                ok=True,
                format=fmt,
                markdown=markdown,
                needs_ocr=probe.needs_ocr,
                reason=probe.reason,
                probe=probe.__dict__,
                warnings=doc.warnings,
                elapsed_ms=(time.perf_counter() - started) * 1000,
            )

        if fmt in SUPPORTED:
            doc = _parse(path, fmt, page_breaks)
            return Result(
                ok=True,
                format=fmt,
                markdown=to_markdown(doc),
                warnings=doc.warnings,
                elapsed_ms=(time.perf_counter() - started) * 1000,
            )

    except office.MissingDependency as exc:
        return Result(
            ok=False,
            format=fmt,
            error=str(exc),
            elapsed_ms=(time.perf_counter() - started) * 1000,
        )
    except Exception as exc:
        return Result(
            ok=False,
            format=fmt,
            error=f"{type(exc).__name__}: {exc}",
            elapsed_ms=(time.perf_counter() - started) * 1000,
        )

    return Result(
        ok=False,
        format=fmt,
        error=f"fastdoc cannot convert '{fmt}'",
        elapsed_ms=(time.perf_counter() - started) * 1000,
    )
