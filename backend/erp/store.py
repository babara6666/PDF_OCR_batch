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
        rows.json     what 知識通 posted back (absent until it does)

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

_JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")

STATUS_PENDING = "pending"  # markdown ready, nobody has mapped it yet
STATUS_MAPPED = "mapped"    # 知識通 posted rows back
STATUS_FAILED = "failed"    # OCR itself failed; kept so the UI can show why


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
    _write_json(
        d / "meta.json",
        {
            "job_id": job_id,
            "batch_id": batch_id,
            "filename": filename,
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


def list_jobs(
    *, status: str | None = None, batch_id: str = "", limit: int = 200
) -> list[dict]:
    """Job metadata, newest first. Cheap: one small JSON read per job."""
    if not JOBS_DIR.exists():
        return []
    out = []
    for d in JOBS_DIR.iterdir():
        if not d.is_dir() or not _JOB_ID_RE.match(d.name):
            continue
        meta = _read_json(d / "meta.json")
        if meta is None:
            continue
        if status and meta.get("status") != status:
            continue
        if batch_id and meta.get("batch_id") != batch_id:
            continue
        out.append(meta)
    out.sort(key=lambda m: m.get("created_at", 0), reverse=True)
    return out[:limit]


# ── Housekeeping ─────────────────────────────────────────────────────────────
def _prune() -> None:
    """Drop jobs past the retention window, then trim back to MAX_JOBS."""
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

    if len(metas) > MAX_JOBS:
        metas.sort()
        for _, d in metas[: len(metas) - MAX_JOBS]:
            shutil.rmtree(d, ignore_errors=True)
