"""File-backed job store for the ERP import mode.

The OCR endpoints are stateless — they hand the markdown straight back in the
response. The ERP path cannot be: 知識通 is a *separate* process that shows up
later, over MCP, asking "what is there to map?" and posting rows back. So the
markdown has to outlive the upload request.

A directory per job is enough. There is no concurrency beyond one uvicorn
worker touching one job at a time, no query beyond "list" and "get by id", and
nothing here is worth a database:

    <ERP_JOBS_DIR>/<job_id>/
        meta.json     status, filename, timestamps, engine, error
        source.md     the markdown the OCR pipeline produced
        source_alt.md the second engine's markdown, when dual mode ran
        source.pdf    the original upload, kept so a reviewer can see the page
        pages/<n>.png rendered pages, written on first request (see pages.py)
        rows.json     what 知識通 posted back (absent until it does)
        expected.json for a training sample: the rows the customer already
                      produced by hand for this document, read off the xlsx
                      they uploaded with it

A job's `kind` says what it is for. `report` is the normal case — a document
on its way to ERP. `sample` is a document paired with the answer a human
already gave for it, used to learn a customer's profile; samples are held in
the same store because they need everything a report needs (markdown, both
engines, the PDF, pruning) but they must never appear in the review queue, so
every listing filters on kind.

Job ids are uuid4 hex, and every lookup re-validates that shape before it
touches the filesystem — the id arrives from an MCP client, i.e. from outside.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

JOBS_DIR = Path(
    os.getenv("ERP_JOBS_DIR", str(Path(__file__).parent.parent / "erp_jobs"))
)

# How long a job survives. These carry customer inspection data, so they should
# not pile up on disk forever; 14 days is long enough to re-run a batch that
# went wrong last week.
RETENTION_DAYS = int(os.getenv("ERP_JOBS_RETENTION_DAYS", "14"))

# Ceiling on stored jobs, enforced oldest-first. Retention alone does not bound
# disk when someone uploads 500 files a day.
MAX_JOBS = int(os.getenv("ERP_JOBS_MAX", "2000"))

# The original PDF is kept beside the markdown so the review table can show the
# page it came from. Markdown is a few KB; a scanned COA is a few MB, so this
# is the number that actually decides how much disk a job costs. Retention and
# MAX_JOBS above still bound it — a pruned job takes its PDF and page images
# with it, because prune removes the whole directory.
SOURCE_MAX_BYTES = int(float(os.getenv("ERP_SOURCE_MAX_MB", "20")) * 1024 * 1024)

# Total disk the store may occupy, enforced oldest-first alongside MAX_JOBS.
# A job used to be a few KB of markdown, so counting jobs was enough to bound
# it. With the PDF and its rendered pages beside them a single scanned report
# runs to several MB, and 2000 of those is not a number anyone signed up for.
MAX_TOTAL_BYTES = int(float(os.getenv("ERP_JOBS_MAX_MB", "4096")) * 1024 * 1024)

_JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")

STATUS_PENDING = "pending"  # markdown ready, nobody has mapped it yet
STATUS_MAPPED = "mapped"    # 知識通 posted rows back
STATUS_FAILED = "failed"    # OCR itself failed; kept so the UI can show why

KIND_REPORT = "report"  # a document on its way to ERP
KIND_SAMPLE = "sample"  # a document paired with the answer a human already gave


class JobNotFound(KeyError):
    """Raised for an unknown or malformed job id."""


def _job_dir(job_id: str) -> Path:
    if not _JOB_ID_RE.match(job_id or ""):
        raise JobNotFound(job_id)
    return JOBS_DIR / job_id


def _read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _write_json(path: Path, payload: Any) -> None:
    """Write atomically — a half-written meta.json makes a job unreadable."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    tmp.replace(path)


# ── Writing ──────────────────────────────────────────────────────────────────
def create_job(
    *,
    filename: str,
    markdown: str,
    engine: str = "",
    error: str = "",
    batch_id: str = "",
    alt_markdown: str = "",
    alt_engine: str = "",
    profile_id: str = "default",
    kind: str = KIND_REPORT,
    expected_rows: list[dict] | None = None,
) -> str:
    """Store one OCR'd document and return its job id.

    In dual mode the same page comes back twice — Marker reconstructs the
    layout, fastdoc copies the embedded text layer verbatim. They are the same
    content, so only one is the primary; the other is kept alongside it because
    a reader that can see both can cross-check a digit it is unsure of.
    """
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    job_id = uuid.uuid4().hex
    d = JOBS_DIR / job_id
    d.mkdir()

    (d / "source.md").write_text(markdown or "", encoding="utf-8")
    if (alt_markdown or "").strip():
        (d / "source_alt.md").write_text(alt_markdown, encoding="utf-8")
    if expected_rows:
        _write_json(d / "expected.json", expected_rows)
    _write_json(
        d / "meta.json",
        {
            "job_id": job_id,
            "batch_id": batch_id,
            "filename": filename,
            "kind": kind,
            # Which customer's column set and aliases this document is read
            # under. Stored on the job so an export still works after the
            # profile picker has moved on to another customer.
            "profile_id": profile_id,
            "expected_row_count": len(expected_rows or []),
            "status": STATUS_FAILED if error else STATUS_PENDING,
            "engine": engine,
            "alt_engine": alt_engine if (alt_markdown or "").strip() else "",
            "has_alt": bool((alt_markdown or "").strip()),
            "error": error,
            "created_at": time.time(),
            "mapped_at": None,
            "mapped_by": "",
            "row_count": 0,
            "notes": "",
            # The PDF arrives in a second request — staging happens as soon as
            # OCR returns, and the upload of the source is a background trickle
            # behind it, so a job is briefly complete without one.
            "has_source": False,
            "page_count": 0,
            # Set when a human says "I checked this one". Export defaults to
            # reviewed jobs only: these rows are the basis for accepting
            # incoming material, so nothing reaches ERP unlooked-at.
            "reviewed_at": None,
            "reviewed_by": "",
            # Set while a backend-driven LLM run is working on this job.
            # idle | running | error
            "mapping_state": "idle",
            "mapping_error": "",
        },
    )
    _prune()
    return job_id


def set_rows(
    job_id: str,
    rows: list[dict],
    *,
    mapped_by: str = "知識通",
    notes: str = "",
) -> dict:
    """Record the normalised rows for a job and flip it to `mapped`."""
    d = _job_dir(job_id)
    meta = _read_json(d / "meta.json")
    if meta is None:
        raise JobNotFound(job_id)

    _write_json(d / "rows.json", rows)
    meta.update(
        status=STATUS_MAPPED,
        mapped_at=time.time(),
        mapped_by=mapped_by,
        row_count=len(rows),
        notes=notes,
        # New rows invalidate an earlier sign-off — whoever confirmed did not
        # see these. Sign-off is the last step of the review, so the reviewer
        # ticks it again after saving a correction.
        reviewed_at=None,
        reviewed_by="",
    )
    _write_json(d / "meta.json", meta)
    return meta


def save_source(job_id: str, data: bytes, page_count: int) -> dict:
    """Keep the original PDF next to the markdown it was OCR'd from.

    Optional by design: the review pane falls back to the markdown when there
    is no PDF, so a failed or skipped upload degrades the view rather than the
    job. `page_count` is passed in rather than derived here to keep this module
    free of pypdfium2 — see pages.py.
    """
    d = _job_dir(job_id)
    meta = _read_json(d / "meta.json")
    if meta is None:
        raise JobNotFound(job_id)

    (d / "source.pdf").write_bytes(data)
    meta.update(has_source=True, page_count=page_count)
    _write_json(d / "meta.json", meta)
    return meta


def set_expected_rows(job_id: str, rows: list[dict]) -> dict:
    """Attach the answer a human already produced for a training sample."""
    d = _job_dir(job_id)
    meta = _read_json(d / "meta.json")
    if meta is None:
        raise JobNotFound(job_id)
    _write_json(d / "expected.json", rows)
    meta.update(expected_row_count=len(rows))
    _write_json(d / "meta.json", meta)
    return meta


def set_mapping_state(job_id: str, state: str, *, error: str = "") -> dict:
    """Track a backend-driven mapping run so the UI can show it.

    Separate from `status`: status says what the job *is* (pending / mapped /
    failed), this says whether something is working on it right now. A run that
    fails leaves the job `pending` on purpose — 知識通 can still take it.
    """
    d = _job_dir(job_id)
    meta = _read_json(d / "meta.json")
    if meta is None:
        raise JobNotFound(job_id)
    meta.update(mapping_state=state, mapping_error=error)
    _write_json(d / "meta.json", meta)
    return meta


def set_reviewed(job_id: str, reviewed: bool, *, reviewed_by: str = "") -> dict:
    """Record (or clear) a human's sign-off on a job's rows."""
    d = _job_dir(job_id)
    meta = _read_json(d / "meta.json")
    if meta is None:
        raise JobNotFound(job_id)

    meta.update(
        reviewed_at=time.time() if reviewed else None,
        reviewed_by=reviewed_by if reviewed else "",
    )
    _write_json(d / "meta.json", meta)
    return meta


def delete_job(job_id: str) -> None:
    shutil.rmtree(_job_dir(job_id), ignore_errors=True)


# ── Reading ──────────────────────────────────────────────────────────────────
def get_meta(job_id: str) -> dict:
    meta = _read_json(_job_dir(job_id) / "meta.json")
    if meta is None:
        raise JobNotFound(job_id)
    return meta


def get_markdown(job_id: str) -> str:
    d = _job_dir(job_id)
    if not (d / "meta.json").exists():
        raise JobNotFound(job_id)
    try:
        return (d / "source.md").read_text(encoding="utf-8")
    except OSError:
        return ""


def get_alt_markdown(job_id: str) -> str:
    """The second engine's rendering, or "" when dual mode did not run."""
    d = _job_dir(job_id)
    if not (d / "meta.json").exists():
        raise JobNotFound(job_id)
    try:
        return (d / "source_alt.md").read_text(encoding="utf-8")
    except OSError:
        return ""


def get_rows(job_id: str) -> list[dict]:
    return _read_json(_job_dir(job_id) / "rows.json", default=[]) or []


def source_path(job_id: str) -> Path | None:
    """The stored PDF, or None when the job has none."""
    p = _job_dir(job_id) / "source.pdf"
    return p if p.exists() else None


def pages_dir(job_id: str) -> Path:
    """Where rendered page images are cached. Created on demand."""
    d = _job_dir(job_id) / "pages"
    d.mkdir(parents=True, exist_ok=True)
    return d


def is_reviewed(job_id: str) -> bool:
    try:
        return bool(get_meta(job_id).get("reviewed_at"))
    except JobNotFound:
        return False


def get_expected_rows(job_id: str) -> list[dict]:
    """For a training sample: the rows the customer already produced by hand."""
    return _read_json(_job_dir(job_id) / "expected.json", default=[]) or []


def list_jobs(
    *,
    status: str | None = None,
    batch_id: str = "",
    limit: int = 200,
    kind: str = KIND_REPORT,
    profile_id: str = "",
) -> list[dict]:
    """Job metadata, newest first. Cheap: one small JSON read per job.

    `kind` defaults to `report`, so training samples never surface in the
    review queue or the export — pass it explicitly to see them. Jobs written
    before profiles existed carry no `kind`; they are reports.
    """
    if not JOBS_DIR.exists():
        return []
    out = []
    for d in JOBS_DIR.iterdir():
        if not d.is_dir() or not _JOB_ID_RE.match(d.name):
            continue
        meta = _read_json(d / "meta.json")
        if meta is None:
            continue
        if kind and meta.get("kind", KIND_REPORT) != kind:
            continue
        if profile_id and meta.get("profile_id", "default") != profile_id:
            continue
        if status and meta.get("status") != status:
            continue
        if batch_id and meta.get("batch_id") != batch_id:
            continue
        out.append(meta)
    out.sort(key=lambda m: m.get("created_at", 0), reverse=True)
    return out[:limit]


# ── Housekeeping ─────────────────────────────────────────────────────────────
def _dir_bytes(d: Path) -> int:
    """Everything one job occupies: markdown, PDF, rows, rendered pages."""
    total = 0
    for p in d.rglob("*"):
        try:
            if p.is_file():
                total += p.stat().st_size
        except OSError:  # deleted from under us — it costs nothing now
            pass
    return total


def _prune() -> None:
    """Drop jobs past the retention window, then trim to MAX_JOBS and disk.

    Three bounds rather than one because they fail differently: retention is
    about not keeping customer inspection data around, MAX_JOBS about a
    directory nobody can list, and the byte budget about the PDFs and rendered
    pages, which are what actually fills a disk.
    """
    if not JOBS_DIR.exists():
        return
    cutoff = time.time() - RETENTION_DAYS * 86400
    metas = []
    for d in JOBS_DIR.iterdir():
        if not d.is_dir() or not _JOB_ID_RE.match(d.name):
            continue
        meta = _read_json(d / "meta.json")
        created = (meta or {}).get("created_at", 0)
        if meta is None or created < cutoff:
            shutil.rmtree(d, ignore_errors=True)
            continue
        metas.append((created, d))

    metas.sort()
    if len(metas) > MAX_JOBS:
        for _, d in metas[: len(metas) - MAX_JOBS]:
            shutil.rmtree(d, ignore_errors=True)
        metas = metas[len(metas) - MAX_JOBS :]

    # Oldest first until the store fits. Sizing every job means one stat per
    # file, which is cheap next to the OCR run that produced them.
    sizes = [(created, d, _dir_bytes(d)) for created, d in metas]
    total = sum(s for _, _, s in sizes)
    for _, d, size in sizes:
        if total <= MAX_TOTAL_BYTES:
            break
        shutil.rmtree(d, ignore_errors=True)
        total -= size
