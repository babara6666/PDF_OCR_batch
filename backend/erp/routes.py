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
    前端  POST /api/erp/map                       改用本機／公司 LLM 自己對應
          POST /api/erp/jobs/{id}/source          補上原始 PDF，供覆核時對照
          GET  /api/erp/jobs/{id}    輪詢、顯示、讓人覆核（可再 PUT 修正）
          GET  /api/erp/jobs/{id}/page/{n}.png    覆核畫面左邊的頁面影像
          POST /api/erp/jobs/{id}/review          人工確認過了
          GET  /api/erp/export.xlsx  匯出給 ERP（預設只收已確認的）
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field

from . import export, learn, llm, pages, schema, store

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
    # Whose column set and aliases these are read under. Stored on each job so
    # the export still works after the picker has moved to another customer.
    profile_id: str = Field(schema.DEFAULT_PROFILE, max_length=64)


class RowsIn(BaseModel):
    rows: list[dict]
    mapped_by: str = Field("知識通", max_length=80)
    notes: str = Field("", max_length=4000)


# ── Schema ───────────────────────────────────────────────────────────────────
_PROFILE_Q = Query(
    schema.DEFAULT_PROFILE, max_length=64, description="客戶設定檔 id，預設 default"
)


@router.get("/schema")
async def get_schema(profile: str = _PROFILE_Q):
    """The ERP column definition and the supplier alias list, as JSON."""
    return schema.load(profile)


@router.get("/schema.md", response_class=PlainTextResponse)
async def get_schema_markdown(profile: str = _PROFILE_Q):
    """Same thing rendered for an LLM to read — served as the MCP resource."""
    return schema.as_markdown(profile)


@router.get("/patterns.md", response_class=PlainTextResponse)
async def get_patterns_markdown():
    """The known report layouts and traps, served from the same copy the
    backend's own mapper reads — so the MCP resource and the local LLM cannot
    drift apart."""
    return llm.reference("report-patterns.md")


# ── Profiles ─────────────────────────────────────────────────────────────────
# One customer = one profile: their ERP template's columns plus what their
# suppliers call those things. `default` is the built-in 四維 one and is
# read-only here — it lives in the repo as backend/erp/schema.yaml.
class ProfileIn(BaseModel):
    name: str = Field("", max_length=200)
    version: int = 1
    columns: list[dict]
    rules: list[str] = []
    learned_from: list[str] = []


class SamplesIn(BaseModel):
    documents: list[DocumentIn]


class DraftIn(BaseModel):
    provider: str = Field("", max_length=40)
    model: str = Field("", max_length=120)


def _profile_or_404(profile: str) -> dict:
    try:
        return schema.load(profile)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e)) from None


@router.get("/profiles")
async def list_profiles():
    return {"success": True, "profiles": schema.list_profiles()}


@router.get("/profiles/{profile}")
async def get_profile(profile: str):
    return {"success": True, **_profile_or_404(profile)}


@router.put("/profiles/{profile}")
async def put_profile(profile: str, payload: ProfileIn):
    """Store a profile a human has looked at.

    Every path that produces one — importing an alias table, drafting from
    samples — ends here, and only here, so a learned column set gets the same
    validation as a hand-written one.
    """
    try:
        return {"success": True, **schema.save(profile, payload.model_dump())}
    except schema.ProfileError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@router.delete("/profiles/{profile}")
async def delete_profile(profile: str):
    try:
        schema.delete(profile)
    except schema.ProfileError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    return {"success": True}


@router.post("/profiles/{profile}/alias-table")
async def import_alias_table(
    profile: str,
    file: UploadFile = File(...),
    sheet: str = Query("", description="工作表名稱，留空用第一個"),
):
    """Read a customer's own alias table (their `key.xlsx`) into a draft.

    No model involved — the workbook's columns *are* the ERP fields and the
    cells under each *are* the supplier spellings, so this is a transcription.
    A model paraphrasing it would only be a way to get it wrong.

    Returns a draft rather than saving: `required` cannot be inferred from the
    sheet, and somebody has to say which columns make a row real.
    """
    data = await file.read()
    try:
        headers, rows = learn.read_sheet(data, sheet)
        columns = learn.columns_from_alias_table(headers, rows)
    except learn.SheetError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None

    logger.info(
        "ERP: alias table for %s → %d column(s), %d alias(es)",
        profile,
        len(columns),
        sum(len(c["aliases"]) for c in columns),
    )
    return {
        "success": True,
        "draft": {"name": profile, "columns": columns, "rules": []},
        "sheets": learn.sheet_names(data),
        "source": file.filename,
    }


@router.get("/profiles/{profile}/samples")
async def list_samples(profile: str):
    """The (report, answer) pairs staged for learning this profile."""
    return {
        "success": True,
        "samples": store.list_jobs(
            kind=store.KIND_SAMPLE, profile_id=profile, limit=200
        ),
    }


@router.post("/profiles/{profile}/samples", status_code=201)
async def add_samples(profile: str, payload: SamplesIn):
    """Stage OCR'd reports as learning material for a profile.

    Same shape as `POST /jobs` and the same store behind it — a sample needs
    everything a report needs — but `kind=sample` keeps them out of the review
    queue and out of every export.
    """
    if not payload.documents:
        raise HTTPException(status_code=400, detail="documents is empty")
    created = []
    for doc in payload.documents:
        if len(doc.markdown) > MAX_MARKDOWN_CHARS:
            raise HTTPException(status_code=413, detail=f"{doc.filename}: markdown too long")
        job_id = store.create_job(
            filename=doc.filename,
            markdown=doc.markdown,
            engine=doc.engine,
            error=doc.error,
            alt_markdown=doc.alt_markdown,
            alt_engine=doc.alt_engine,
            profile_id=profile,
            kind=store.KIND_SAMPLE,
        )
        created.append(store.get_meta(job_id))
    return {"success": True, "samples": created}


@router.post("/jobs/{job_id}/expected")
async def put_expected(
    job_id: str,
    file: UploadFile = File(...),
    sheet: str = Query("", description="工作表名稱，留空用第一個"),
):
    """Attach the workbook a customer already filled in for this report.

    This is the half a PDF cannot supply. The report says what the supplier
    called things; this says what the customer decided those things were. The
    sheet is read verbatim — headers and cells, no interpretation — because
    interpreting it is exactly the job being learned.
    """
    try:
        store.get_meta(job_id)
    except store.JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found") from None

    data = await file.read()
    try:
        headers, rows = learn.read_sheet(data, sheet)
    except learn.SheetError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None

    expected = learn.rows_as_dicts(headers, rows)
    meta = store.set_expected_rows(job_id, expected)
    logger.info("ERP: %s answered by %s (%d row(s))", meta.get("filename"), file.filename, len(expected))
    return {"success": True, **meta, "headers": headers, "expected_rows": expected[:50]}


@router.post("/profiles/{profile}/draft")
async def draft_profile(profile: str, payload: DraftIn):
    """Generalise the staged samples into a column set, with an LLM.

    Returns a draft; nothing is saved. The draft is folded onto whatever the
    profile already has (`learn.merge_columns`), so it can only ever propose
    columns and aliases — never delete or reorder what is there.
    """
    samples = [
        {
            "filename": s.get("filename", ""),
            "markdown": store.get_markdown(s["job_id"]),
            "expected_rows": store.get_expected_rows(s["job_id"]),
        }
        for s in store.list_jobs(kind=store.KIND_SAMPLE, profile_id=profile, limit=50)
    ]
    if not samples:
        raise HTTPException(status_code=400, detail="這個設定檔還沒有樣本")
    if not any(s["expected_rows"] for s in samples):
        raise HTTPException(
            status_code=400,
            detail="所有樣本都沒有對照答案。請至少為一份報告上傳客戶已經填好的匯入 xlsx，"
            "否則只有 PDF 沒辦法知道哪一欄該對到哪裡。",
        )

    try:
        base = schema.load(profile).get("columns", [])
    except Exception:
        base = []
    try:
        columns, notes, drafted_by = await llm.draft_profile(
            samples=samples,
            base_columns=base,
            provider=payload.provider,
            model=payload.model,
        )
    except llm.MappingError as e:
        raise HTTPException(status_code=502, detail=str(e)) from None

    merged = learn.merge_columns(base, columns)
    return {
        "success": True,
        "draft": {
            "name": schema.load(profile).get("name") or profile,
            "columns": merged,
            "rules": schema.load(profile).get("rules", []),
            "learned_from": [s["filename"] for s in samples],
        },
        "notes": notes,
        "drafted_by": drafted_by,
        "sample_count": len(samples),
    }


@router.post("/jobs/{job_id}/teach", status_code=201)
async def teach_from_review(job_id: str):
    """Turn a report a human just signed off into a learning sample.

    The corrections a reviewer makes are the same evidence the samples carry —
    this document, and the answer a person settled on for it — and today they
    evaporate the moment the job is pruned. One button keeps them.
    """
    try:
        meta = store.get_meta(job_id)
    except store.JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found") from None
    rows = store.get_rows(job_id)
    if not rows:
        raise HTTPException(status_code=400, detail="這份報告還沒有任何列可以學")

    profile = meta.get("profile_id") or schema.DEFAULT_PROFILE
    names = {c["key"]: c["name"] for c in schema.columns(profile)}
    sample_id = store.create_job(
        filename=meta.get("filename", ""),
        markdown=store.get_markdown(job_id),
        alt_markdown=store.get_alt_markdown(job_id),
        engine=meta.get("engine", ""),
        alt_engine=meta.get("alt_engine", ""),
        profile_id=profile,
        kind=store.KIND_SAMPLE,
        # Stored under the display names, the same shape a customer's workbook
        # arrives in, so the draft prompt sees one kind of answer table.
        expected_rows=[{names.get(k, k): v for k, v in row.items()} for row in rows],
    )
    logger.info("ERP: %s kept as a sample for profile %s", meta.get("filename"), profile)
    return {"success": True, **store.get_meta(sample_id)}


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
            profile_id=payload.profile_id,
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
        meta = store.get_meta(job_id)
    except store.JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found") from None

    if len(payload.rows) > MAX_ROWS_PER_JOB:
        raise HTTPException(
            status_code=413, detail=f"Too many rows (max {MAX_ROWS_PER_JOB})"
        )

    rows, warnings = schema.normalise_rows(
        payload.rows, meta.get("profile_id") or schema.DEFAULT_PROFILE
    )
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


# ── Source PDF & page images ─────────────────────────────────────────────────
@router.post("/jobs/{job_id}/source", status_code=201)
async def put_source(job_id: str, file: UploadFile = File(...)):
    """Attach the original PDF to a job, so the reviewer can see the page.

    Uploaded separately from the markdown rather than inside `POST /jobs`,
    because the two have very different sizes and lifetimes: staging must
    happen the moment OCR returns, while the PDF is a several-megabyte trickle
    behind it that nothing downstream waits on.
    """
    try:
        store.get_meta(job_id)
    except store.JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found") from None

    data = await file.read()
    if len(data) > store.SOURCE_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"PDF 超過 {store.SOURCE_MAX_BYTES // (1024 * 1024)} MB 上限",
        )
    # The extension is not evidence — check the magic bytes, the same way
    # fastdoc.detect does. A leading BOM or junk before %PDF is common enough
    # that readers tolerate it, so look in the first block rather than at 0.
    if b"%PDF" not in data[:1024]:
        raise HTTPException(status_code=400, detail="這不是 PDF 檔")

    meta = store.save_source(job_id, data, pages.count_pages(data))
    logger.info(
        "ERP: stored source PDF for %s (%d page(s), %d KB)",
        meta.get("filename"),
        meta.get("page_count", 0),
        len(data) // 1024,
    )
    return {"success": True, **meta}


@router.get("/jobs/{job_id}/page/{page_no}.png")
async def get_page(
    job_id: str,
    page_no: int,
    w: int = Query(pages.DEFAULT_WIDTH, ge=pages.MIN_WIDTH, le=pages.MAX_WIDTH),
):
    """One rendered page of the source PDF.

    An image rather than the PDF itself: the app's CSP sets `object-src 'none'`
    and `frame-ancestors 'none'`, so an embedded PDF viewer is blocked even
    same-origin. See erp/pages.py.
    """
    try:
        store.get_meta(job_id)
    except store.JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found") from None
    try:
        data = pages.render(job_id, page_no, w)
    except pages.PageError as e:
        raise HTTPException(status_code=404, detail=str(e)) from None
    # Private: these are customer inspection reports, so no shared cache may
    # hold them, but the reviewer's own browser should not refetch every scroll.
    return Response(
        content=data,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )


# ── Review sign-off ──────────────────────────────────────────────────────────
@router.post("/jobs/{job_id}/review")
async def mark_reviewed(job_id: str, reviewed_by: str = Query("人工覆核", max_length=80)):
    """Record that a human checked this job's rows against the source."""
    try:
        meta = store.set_reviewed(job_id, True, reviewed_by=reviewed_by)
    except store.JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found") from None
    logger.info("ERP: %s reviewed %s", reviewed_by, meta.get("filename"))
    return {"success": True, **meta}


@router.delete("/jobs/{job_id}/review")
async def clear_reviewed(job_id: str):
    """Take the sign-off back — the rows changed, or it was ticked in error."""
    try:
        meta = store.set_reviewed(job_id, False)
    except store.JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found") from None
    return {"success": True, **meta}


# ── Backend-driven mapping (local / company LLM) ─────────────────────────────
@router.get("/llm")
async def get_llm_providers():
    """Which mapping engines this deployment can drive, and their models.

    A sync-ish call that touches the network at most once per TTL and never
    raises — a gateway nobody can reach still returns the curated list, so the
    picker is never empty.
    """
    return {"success": True, "enabled": llm.enabled(), **llm.available()}


async def _map_one(job_id: str, provider: str, model: str) -> dict:
    """Read one job with an LLM and store the rows it returns.

    On failure the job is left `pending` rather than `failed`: nothing is
    wrong with the document, only with this attempt, and 知識通 can still take
    it. The reason is recorded on the job so the UI can say what happened.
    """
    meta = store.get_meta(job_id)
    profile = meta.get("profile_id") or schema.DEFAULT_PROFILE
    store.set_mapping_state(job_id, "running")
    try:
        rows, notes, mapped_by = await llm.map_document(
            filename=meta.get("filename", ""),
            markdown=store.get_markdown(job_id),
            alt_markdown=store.get_alt_markdown(job_id),
            profile=profile,
            provider=provider,
            model=model,
        )
    except Exception as e:
        logger.warning("ERP: mapping %s failed — %s", meta.get("filename"), e)
        return store.set_mapping_state(job_id, "error", error=str(e))

    normalised, warnings = schema.normalise_rows(rows, profile)
    if warnings:
        notes = "\n".join([notes, *(f"⚠ {w}" for w in warnings)]).strip()
    store.set_rows(job_id, normalised, mapped_by=mapped_by, notes=notes)
    return store.set_mapping_state(job_id, "idle")


class MapIn(BaseModel):
    # Empty means "walk ERP_LLM_PROVIDERS in order", which is the normal case.
    provider: str = Field("", max_length=40)
    model: str = Field("", max_length=120)


@router.post("/jobs/{job_id}/map")
async def map_job(job_id: str, payload: MapIn | None = None):
    """Map one report now, and wait for it. Used for a single retry."""
    try:
        store.get_meta(job_id)
    except store.JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found") from None
    p = payload or MapIn()
    meta = await _map_one(job_id, p.provider, p.model)
    if meta.get("mapping_state") == "error":
        raise HTTPException(status_code=502, detail=meta.get("mapping_error", ""))
    return {"success": True, **meta, "rows": store.get_rows(job_id)}


class MapBatchIn(MapIn):
    job_ids: list[str] = []
    batch_id: str = Field("", max_length=64)


@router.post("/map", status_code=202)
async def map_batch(payload: MapBatchIn, background: BackgroundTasks):
    """Map every pending report in the background and return immediately.

    Sequential rather than concurrent: one local model serves one request at a
    time anyway, and firing a whole batch at a gateway is how a shared proxy
    starts rate-limiting everyone else in the building. The UI's existing 5s
    poll picks the results up as they land, so nothing new is needed to report
    progress.
    """
    ids = payload.job_ids or [
        j["job_id"]
        for j in store.list_jobs(status=store.STATUS_PENDING, batch_id=payload.batch_id)
    ]
    if not ids:
        raise HTTPException(status_code=400, detail="沒有待處理的報告")
    if len(ids) > MAX_DOCS_PER_REQUEST:
        raise HTTPException(status_code=400, detail="Too many job_ids")

    async def run() -> None:
        for job_id in ids:
            try:
                await _map_one(job_id, payload.provider, payload.model)
            except store.JobNotFound:
                continue  # discarded while the batch was running

    # Marked running up front so the queue does not sit there looking idle
    # while the first document is being read.
    for job_id in ids:
        try:
            store.set_mapping_state(job_id, "running")
        except store.JobNotFound:
            continue

    background.add_task(run)
    logger.info("ERP: mapping %d document(s) with %s", len(ids), payload.provider or "auto")
    return {"success": True, "count": len(ids), "job_ids": ids}


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
    """One file's workbook.

    Deliberately not gated on the review flag: this is the link 知識通 hands
    back the moment it submits rows, i.e. a preview of what it read, and it is
    one file rather than the day's import. The batch export below is the one
    that feeds ERP, and that is where the sign-off is enforced.
    """
    try:
        data, name = export.job_xlsx(job_id)
    except store.JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found") from None
    return _attachment(data, name, _XLSX_MIME)


_ONLY_REVIEWED = Query(
    True, description="只匯出人工確認過的報告（預設）。未確認的會列在「未匯入」分頁。"
)


@router.get("/export.xlsx")
async def export_batch(
    job_ids: str = Query(..., description="Comma-separated job ids"),
    only_reviewed: bool = _ONLY_REVIEWED,
):
    data, name = export.batch_xlsx(_split_ids(job_ids), only_reviewed=only_reviewed)
    return _attachment(data, name, _XLSX_MIME)


@router.get("/export.csv")
async def export_batch_csv(
    job_ids: str = Query(..., description="Comma-separated job ids"),
    only_reviewed: bool = _ONLY_REVIEWED,
):
    data, name = export.batch_csv(_split_ids(job_ids), only_reviewed=only_reviewed)
    return _attachment(data, name, "text/csv; charset=utf-8")
