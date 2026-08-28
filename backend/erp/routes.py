"""`/api/erp/*` — the staging area between OCR and the ERP import file.

Deliberately **not** wired into the OCR pipeline. It takes markdown that is
already produced and stores it; the OCR endpoints keep their current stateless
shape, and this module imports neither marker nor torch. That also means the
same job can be fed from the browser, from `batch_upload.py`, or from anything
else that can already produce markdown.

The flow this serves:

    前端  POST /api/erp/jobs         把 OCR 好的 MD 存成 job（status=pending）
    知識通 GET  /api/erp/jobs?status=pending    （經 MCP）看有什麼要處理
          GET  /api/erp/jobs/{id}/markdown      讀原文
          PUT  /api/erp/jobs/{id}/rows          回填正規化後的列（status=mapped）
    前端  GET  /api/erp/jobs/{id}    輪詢、顯示、讓人覆核（可再 PUT 修正）
          GET  /api/erp/export.xlsx  匯出給 ERP
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field

from . import export, schema, store

logger = logging.getLogger("printlens.erp")

router = APIRouter(prefix="/api/erp", tags=["erp"])

# One document's markdown is already bounded by what OCR produces, but this
# endpoint accepts a body straight from a client, so cap it rather than let a
# single request fill the disk.
MAX_MARKDOWN_CHARS = 2_000_000
MAX_DOCS_PER_REQUEST = 200
MAX_ROWS_PER_JOB = 5_000


# ── Payloads ─────────────────────────────────────────────────────────────────
class DocumentIn(BaseModel):
    filename: str = Field(..., max_length=400)
    markdown: str = ""
    engine: str = Field("", max_length=40)
    error: str = Field("", max_length=2000)
    # Dual mode produces the same document twice. `markdown` stays the one the
    # UI shows; `alt_markdown` is the other engine's rendering, kept so the
    # mapper can cross-check a value it cannot read cleanly in one of them.
    alt_markdown: str = ""
    alt_engine: str = Field("", max_length=40)


class CreateJobsIn(BaseModel):
    documents: list[DocumentIn]
    # Groups the files that were uploaded together, so the UI and the export
    # can talk about "this batch" without the caller tracking ids by hand.
    batch_id: str = Field("", max_length=64)


class RowsIn(BaseModel):
    rows: list[dict]
    mapped_by: str = Field("知識通", max_length=80)
    notes: str = Field("", max_length=4000)


# ── Schema ───────────────────────────────────────────────────────────────────
@router.get("/schema")
async def get_schema():
    """The ERP column definition and the supplier alias list, as JSON."""
    return schema.load()


@router.get("/schema.md", response_class=PlainTextResponse)
async def get_schema_markdown():
    """Same thing rendered for an LLM to read — served as the MCP resource."""
    return schema.as_markdown()


# ── Jobs ─────────────────────────────────────────────────────────────────────
@router.post("/jobs", status_code=201)
async def create_jobs(payload: CreateJobsIn):
    """Stage OCR'd documents for mapping. Returns one job per document."""
    docs = payload.documents
    if not docs:
        raise HTTPException(status_code=400, detail="documents is empty")
    if len(docs) > MAX_DOCS_PER_REQUEST:
        raise HTTPException(
            status_code=400,
            detail=f"Too many documents (max {MAX_DOCS_PER_REQUEST} per request)",
        )

    created = []
    for doc in docs:
        if len(doc.markdown) > MAX_MARKDOWN_CHARS:
            raise HTTPException(
                status_code=413,
                detail=f"{doc.filename}: markdown over {MAX_MARKDOWN_CHARS} chars",
            )
        if len(doc.alt_markdown) > MAX_MARKDOWN_CHARS:
            raise HTTPException(
                status_code=413,
                detail=f"{doc.filename}: alt_markdown over {MAX_MARKDOWN_CHARS} chars",
            )
        # A document that failed OCR is still worth a job: the UI has to show
        # which files need a human, and the export lists them under 未匯入.
        error = doc.error or ("" if doc.markdown.strip() else "OCR 沒有產生任何內容")
        job_id = store.create_job(
            filename=doc.filename,
            markdown=doc.markdown,
            engine=doc.engine,
            error=error,
            batch_id=payload.batch_id,
            alt_markdown=doc.alt_markdown,
            alt_engine=doc.alt_engine,
        )
        created.append(store.get_meta(job_id))

    logger.info(
        "ERP: staged %d document(s) batch=%s", len(created), payload.batch_id or "-"
    )
    return {"success": True, "jobs": created}


@router.get("/jobs")
async def list_jobs(
    status: str | None = Query(None, description="pending | mapped | failed"),
    batch_id: str = Query("", max_length=64),
    limit: int = Query(200, ge=1, le=1000),
):
    jobs = store.list_jobs(status=status, batch_id=batch_id, limit=limit)
    return {"success": True, "count": len(jobs), "jobs": jobs}


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: str,
    include_markdown: bool = Query(True),
):
    try:
        meta = store.get_meta(job_id)
    except store.JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found") from None
    payload = {"success": True, **meta, "rows": store.get_rows(job_id)}
    if include_markdown:
        payload["markdown"] = store.get_markdown(job_id)
        payload["alt_markdown"] = store.get_alt_markdown(job_id)
    return payload


@router.get("/jobs/{job_id}/markdown", response_class=PlainTextResponse)
async def get_job_markdown(
    job_id: str,
    variant: str = Query(
        "primary", description="primary | alt — alt is the second engine's rendering"
    ),
):
    try:
        if variant == "alt":
            return store.get_alt_markdown(job_id)
        return store.get_markdown(job_id)
    except store.JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found") from None


@router.put("/jobs/{job_id}/rows")
async def put_rows(job_id: str, payload: RowsIn):
    """Record the mapped rows. Idempotent — call again to correct them.

    This is the endpoint 知識通 writes to, and the one the review table writes
    to when a human fixes a cell.
    """
    try:
        store.get_meta(job_id)
    except store.JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found") from None

    if len(payload.rows) > MAX_ROWS_PER_JOB:
        raise HTTPException(
            status_code=413, detail=f"Too many rows (max {MAX_ROWS_PER_JOB})"
        )

    rows, warnings = schema.normalise_rows(payload.rows)
    meta = store.set_rows(
        job_id, rows, mapped_by=payload.mapped_by, notes=payload.notes
    )
    logger.info(
        "ERP: %s mapped %d row(s) for %s%s",
        payload.mapped_by,
        len(rows),
        meta.get("filename"),
        f" ({len(warnings)} warning(s))" if warnings else "",
    )
    return {"success": True, **meta, "rows": rows, "warnings": warnings}


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    try:
        store.get_meta(job_id)
    except store.JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found") from None
    store.delete_job(job_id)
    return {"success": True}


# ── Export ───────────────────────────────────────────────────────────────────
_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _attachment(data: bytes, filename: str, mime: str) -> Response:
    # RFC 5987: the plain filename must stay ASCII or some clients mangle the
    # header, and these filenames are Chinese.
    from urllib.parse import quote

    return Response(
        content=data,
        media_type=mime,
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"export\"; "
                f"filename*=UTF-8''{quote(filename)}"
            )
        },
    )


def _split_ids(job_ids: str) -> list[str]:
    ids = [j.strip() for j in job_ids.split(",") if j.strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="job_ids is empty")
    if len(ids) > MAX_DOCS_PER_REQUEST:
        raise HTTPException(status_code=400, detail="Too many job_ids")
    return ids


@router.get("/jobs/{job_id}/export.xlsx")
async def export_job(job_id: str):
    try:
        data, name = export.job_xlsx(job_id)
    except store.JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found") from None
    return _attachment(data, name, _XLSX_MIME)


@router.get("/export.xlsx")
async def export_batch(job_ids: str = Query(..., description="Comma-separated job ids")):
    data, name = export.batch_xlsx(_split_ids(job_ids))
    return _attachment(data, name, _XLSX_MIME)


@router.get("/export.csv")
async def export_batch_csv(
    job_ids: str = Query(..., description="Comma-separated job ids"),
):
    data, name = export.batch_csv(_split_ids(job_ids))
    return _attachment(data, name, "text/csv; charset=utf-8")
