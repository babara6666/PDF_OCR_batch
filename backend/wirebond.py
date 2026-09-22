"""`/api/wirebond/*` — hands OCR'd wafer-information / netlist text to 圖衍析.

The 打線圖 (wire-bond diagram) feature itself lives in LLMCAD3 (圖衍析): the
LLM reading of the netlist, the history retrieval and the rule-based drawing
are all there, under its `/api/wirebond/*`. What this module adds is the entry
point from *this* side — a customer sends the wafer information and the
netlist as scans or PDFs, the OCR front half here turns them into markdown
exactly as it does for every other mode, and the steps after that are proxied
to 圖衍析 so the person never leaves the page.

Proxying (rather than calling 圖衍析 from the browser) keeps its `X-App-Token`
on the server and avoids a second CORS origin. Nothing here imports marker or
torch; with `LLMCAD_BASE_URL` unset every route answers 503 and the frontend
hides the tab.

    前端  POST /api/upload-batch              OCR（既有流程）
          GET  /api/wirebond/status           圖衍析連得到嗎、有哪些 LLM 可選
          POST /api/wirebond/understand       OCR 文字 → LLM 讀成 netlist
          POST /api/wirebond/search           在歷史 POD/SBT 中找相似
          POST /api/wirebond/draw             依規則出圖（DXF/DWG/PDF）
          GET  /api/wirebond/{job}/files/{k}  下載圖檔
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

logger = logging.getLogger("printlens.wirebond")

router = APIRouter(prefix="/api/wirebond", tags=["wirebond"])

# Where 圖衍析's backend answers. Empty = feature off. From inside Docker the
# host machine is `http://host.docker.internal:8000`.
LLMCAD_BASE_URL = os.getenv("LLMCAD_BASE_URL", "").strip().rstrip("/")
# Its APP_API_TOKEN, when that deployment has one set.
LLMCAD_APP_TOKEN = os.getenv("LLMCAD_APP_TOKEN", "").strip()
# The LLM step can take minutes on a shared GPU; the others are seconds.
LLMCAD_TIMEOUT = float(os.getenv("LLMCAD_TIMEOUT_SECONDS", "900"))

MAX_TEXT_CHARS = 200_000
_JOB_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_FILE_KINDS = {
    "pdf": "application/pdf",
    "dxf": "image/vnd.dxf",
    "dwg": "image/vnd.dwg",
    "png": "image/png",
    "png2": "image/png",
    "png3": "image/png",
    "netlist": "application/json",
    "layout": "application/json",
    "report": "application/json",
}


def enabled() -> bool:
    return bool(LLMCAD_BASE_URL)


def _headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    h = {"X-App-Token": LLMCAD_APP_TOKEN} if LLMCAD_APP_TOKEN else {}
    h.update({k: v for k, v in (extra or {}).items() if v})
    return h


async def _forward(method: str, path: str, *, json: Any = None,
                   headers: dict[str, str] | None = None, timeout: float | None = None) -> Any:
    """One call to 圖衍析; its errors come back with their own status and detail."""
    if not enabled():
        raise HTTPException(503, "打線圖功能未啟用：後端沒有設定 LLMCAD_BASE_URL。")
    try:
        async with httpx.AsyncClient(base_url=LLMCAD_BASE_URL, timeout=timeout or LLMCAD_TIMEOUT) as client:
            r = await client.request(method, path, json=json, headers=_headers(headers))
    except httpx.HTTPError as exc:
        logger.warning("圖衍析 unreachable at %s: %s", LLMCAD_BASE_URL, exc)
        raise HTTPException(502, f"連不到圖衍析（{LLMCAD_BASE_URL}）：{type(exc).__name__}")
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail") or r.text
        except ValueError:
            detail = r.text
        raise HTTPException(r.status_code, f"圖衍析：{detail}"[:2000])
    return r.json()


# ── Status ───────────────────────────────────────────────────────────────────
@router.get("/status")
async def status() -> dict:
    """Is 圖衍析 reachable, and which LLM engines can read the netlist.

    Never raises: the tab renders from this, so a dead 圖衍析 must come back as
    `reachable: false` rather than as an error banner before anything happened.
    """
    out: dict[str, Any] = {"enabled": enabled(), "reachable": False, "base_url": LLMCAD_BASE_URL,
                           "providers": {}, "llmcad": None}
    if not enabled():
        return out
    try:
        out["llmcad"] = await _forward("GET", "/api/wirebond/status", timeout=15)
        providers = await _forward("GET", "/api/providers", timeout=15)
    except HTTPException as exc:
        out["error"] = exc.detail
        return out
    out["reachable"] = True
    # Only engines the server can vouch for, or that take a browser-pasted key.
    out["providers"] = {
        name: {"models": info.get("models", []), "default_model": info.get("default_model"),
               "configured": bool(info.get("configured"))}
        for name, info in providers.items() if isinstance(info, dict)
    }
    return out


# ── Step 2: LLM understanding ────────────────────────────────────────────────
class DocumentIn(BaseModel):
    filename: str = Field("", max_length=400)
    markdown: str = ""


class UnderstandIn(BaseModel):
    provider: str = Field(..., max_length=32)
    model: str = Field(..., max_length=200)
    # The OCR'd documents; joined here so the LLM sees which text came from
    # which file (wafer information vs. pad list).
    documents: list[DocumentIn] = Field(default_factory=list, max_length=20)
    product_code: str = Field("", max_length=32)
    customer: str = Field("", max_length=64)
    package_code: str = Field("", max_length=64)
    extra_texts: list[str] = Field(default_factory=list, max_length=20)


def join_documents(docs: list[DocumentIn]) -> str:
    parts = []
    for i, d in enumerate(docs, 1):
        body = (d.markdown or "").strip()
        if body:
            parts.append(f"# Document {i}: {d.filename or 'untitled'}\n\n{body}")
    return "\n\n".join(parts)


@router.post("/understand")
async def understand(req: UnderstandIn,
                     api_key: str | None = Header(default=None, alias="X-Provider-Api-Key")) -> dict:
    text = join_documents(req.documents)
    if not text:
        raise HTTPException(400, "沒有可讀的文字：OCR 結果是空的。")
    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(413, f"文字太長（{len(text):,} 字元，上限 {MAX_TEXT_CHARS:,}）。")
    payload = {
        "provider": req.provider, "model": req.model, "text": text,
        "product_code": req.product_code or None, "customer": req.customer or None,
        "package_code": req.package_code or None,
        "extra_texts": [t[:200] for t in req.extra_texts if t.strip()],
    }
    return await _forward("POST", "/api/wirebond/understand", json=payload,
                          headers={"X-Provider-Api-Key": api_key or ""})


# ── Steps 3–4: retrieval and drawing ─────────────────────────────────────────
# The netlist round-trips through the browser between steps, so the person can
# see (and 圖衍析 re-validates) what is being searched for and drawn. The bodies
# are 圖衍析's own request models; forwarding them as-is keeps one source of
# truth for what a netlist is.
async def _json_body(request: Request, limit: int = 2_000_000) -> dict:
    raw = await request.body()
    if len(raw) > limit:
        raise HTTPException(413, "Request too large.")
    try:
        import json

        body = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Body must be JSON.")
    if not isinstance(body, dict):
        raise HTTPException(400, "Body must be a JSON object.")
    return body


@router.post("/search")
async def search(request: Request) -> dict:
    return await _forward("POST", "/api/wirebond/search", json=await _json_body(request), timeout=120)


@router.post("/draw")
async def draw(request: Request) -> dict:
    return await _forward("POST", "/api/wirebond/draw", json=await _json_body(request), timeout=300)


@router.get("/{job_id}/files/{kind}")
async def job_file(job_id: str, kind: str) -> Response:
    if not _JOB_ID.match(job_id):
        raise HTTPException(400, "Bad job id.")
    media = _FILE_KINDS.get(kind)
    if media is None:
        raise HTTPException(400, f"Unsupported artifact: {kind}")
    if not enabled():
        raise HTTPException(503, "打線圖功能未啟用。")
    try:
        async with httpx.AsyncClient(base_url=LLMCAD_BASE_URL, timeout=120) as client:
            r = await client.get(f"/api/wirebond/{job_id}/files/{kind}", headers=_headers())
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"連不到圖衍析：{type(exc).__name__}")
    if r.status_code >= 400:
        raise HTTPException(r.status_code, f"圖衍析：{r.text[:500]}")
    headers = {}
    if "content-disposition" in r.headers:
        headers["Content-Disposition"] = r.headers["content-disposition"]
    return Response(content=r.content, media_type=media, headers=headers)
