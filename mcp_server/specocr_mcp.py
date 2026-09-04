#!/usr/bin/env python3
"""specocr_mcp — MCP server fronting the 規格析 backend for ERP import.

Same division of labour as llmcad_mcp: the connecting LLM (the MCP host —
知識通) **does the thinking**, and the company-deployed 規格析 backend only
stores and exports. There is no LLM anywhere in this stack.

    知識通 (MCP host)  ──reads MD, decides the mapping──►  specocr_mcp (this)
        (its own LLM)                                          │ HTTP
                                                               ▼
                                                    規格析 backend /api/erp/*
                                                    stores rows → xlsx/csv
                                                    → download URL returned

The problem being solved: every supplier's incoming-inspection report (COA)
labels the same seven things differently — 批號 / Lot No. / L/C NO. / 代工原料
卷號, 檢驗結果 / Test Value / 實測值 / AVERAGE / 实际值 — and a regex table has
been losing that fight for months. The host reads the markdown and maps by
meaning; `specocr://reference/erp-schema` gives it the target columns and the
163 supplier spellings already seen, as hints rather than as rules.

Configuration (environment variables)
-------------------------------------
    SPECOCR_BASE_URL         Where THIS server reaches the backend (internal).
                             Default http://localhost:8000
    SPECOCR_PUBLIC_BASE_URL  Base URL written into returned download links —
                             what the host's frontend / end users can reach.
                             Default: same as SPECOCR_BASE_URL.
    SPECOCR_API_KEY          Backend API key -> X-API-Key header. Required when
                             the backend has API_KEY set.
    SPECOCR_TIMEOUT          HTTP read timeout (seconds). Default 60.
    SPECOCR_MCP_HOST         Bind host for streamable-HTTP. Default 127.0.0.1.
    SPECOCR_MCP_PORT         Bind port. Default 8766.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Annotated, Any

import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import Field

# ── Configuration ────────────────────────────────────────────────────────────
# Load .env sitting next to this file, if python-dotenv is available. Real
# environment variables always win (override=False), so a container/systemd
# unit that sets them keeps control.
_ENV_FILE = Path(__file__).resolve().parent / ".env"
try:
    from dotenv import load_dotenv

    load_dotenv(_ENV_FILE, override=False)
except ImportError:  # optional dependency — env vars still work without it
    pass

BASE_URL = os.environ.get("SPECOCR_BASE_URL", "http://localhost:8000").rstrip("/")
PUBLIC_BASE_URL = (os.environ.get("SPECOCR_PUBLIC_BASE_URL") or BASE_URL).rstrip("/")
API_KEY = os.environ.get("SPECOCR_API_KEY") or None
HTTP_TIMEOUT = float(os.environ.get("SPECOCR_TIMEOUT", "60"))

HOST = os.environ.get("SPECOCR_MCP_HOST", "127.0.0.1")
PORT = int(os.environ.get("SPECOCR_MCP_PORT", "8766"))

_REF_DIR = Path(__file__).resolve().parent / "reference"

# A whole batch of markdown would blow the host's context. List/preview calls
# stay summaries; the host pulls one document at a time with erp_get_markdown.
MAX_MARKDOWN_CHARS = 120_000
# The cross-check copy is a second rendering of the same page, so it earns a
# smaller share of the host's context than the document itself.
MAX_ALT_MARKDOWN_CHARS = 60_000


def _transport_security() -> TransportSecuritySettings | None:
    """Host/Origin validation for the streamable-HTTP transport.

    The SDK defaults to DNS-rebinding protection that only trusts localhost
    Host headers — which rejects requests arriving via a tunnel/reverse proxy
    under a public hostname (HTTP 421). When this server is fronted by such a
    hop, set SPECOCR_MCP_PUBLIC=1 (access control then lives at the proxy +
    SPECOCR_API_KEY), or pin the exact host(s)/origin(s).
    """
    hosts = [h.strip() for h in os.environ.get("SPECOCR_MCP_ALLOWED_HOSTS", "").split(",") if h.strip()]
    origins = [o.strip() for o in os.environ.get("SPECOCR_MCP_ALLOWED_ORIGINS", "").split(",") if o.strip()]
    if hosts or origins:
        return TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=hosts or ["*"],
            allowed_origins=origins or ["*"],
        )
    if os.environ.get("SPECOCR_MCP_PUBLIC", "").lower() in ("1", "true", "yes"):
        return TransportSecuritySettings(enable_dns_rebinding_protection=False)
    return None


# MCP SDK 2.x: the server class is MCPServer (1.x called it FastMCP), and
# host/port/transport_security are arguments to run(), not to the constructor.
mcp = MCPServer("specocr_mcp")


# ── Shared helpers ───────────────────────────────────────────────────────────
def _headers(*, json_body: bool = False) -> dict[str, str]:
    h: dict[str, str] = {}
    if json_body:
        h["Content-Type"] = "application/json"
    if API_KEY:
        h["X-API-Key"] = API_KEY
    return h


def _explain_http_error(e: httpx.HTTPStatusError) -> str:
    code = e.response.status_code
    try:
        detail = e.response.json().get("detail", "")
    except Exception:
        detail = (e.response.text or "")[:200]
    if code == 401:
        return ("Error: backend rejected auth (401). Set SPECOCR_API_KEY to match "
                "the backend's API_KEY.")
    if code == 404:
        return f"Error: not found (404). {detail or 'The job id may have expired — call erp_list_jobs again.'}"
    return f"Error: backend returned HTTP {code}: {detail or e.response.reason_phrase}"


async def _request(method: str, path: str, **kw) -> Any:
    """One HTTP call to the backend, with the errors turned into text an LLM
    can act on rather than a traceback it will just repeat back to the user."""
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        r = await client.request(method, f"{BASE_URL}{path}", **kw)
        r.raise_for_status()
        return r


def _read_ref(name: str) -> str:
    return (_REF_DIR / name).read_text(encoding="utf-8")


def _job_line(j: dict) -> str:
    bits = [f"- `{j['job_id']}`  {j.get('filename', '?')}", f"[{j.get('status')}]"]
    if j.get("row_count"):
        bits.append(f"{j['row_count']} 列")
    # Only worth saying when it is not the built-in one: a non-default profile
    # means a different column set, not just different aliases.
    if (j.get("profile_id") or "default") != "default":
        bits.append(f"設定檔={j['profile_id']}")
    if j.get("batch_id"):
        bits.append(f"batch={j['batch_id']}")
    if j.get("error"):
        bits.append(f"⚠ {j['error']}")
    return "  ".join(bits)


def _unwrap(kwargs: Any) -> dict:
    """Flatten the `{"kwargs": {...}}` shape some MCP hosts send.

    知識通 nests the real arguments under a single `kwargs` key instead of
    passing them at the top level. A tool that declares a *required* parameter
    then fails schema validation before its body ever runs, which surfaces to
    the host as "job_id is missing" no matter how it formats the call — so
    every parameter here carries a default and the real values are recovered
    from this key. Some hosts send it as a JSON string rather than an object.

    Must stay above the tool definitions: `from __future__ import annotations`
    makes the annotations strings, and the SDK evaluates them at decoration
    time, so a name defined further down the file is simply not there yet.
    """
    if not kwargs:
        return {}
    if isinstance(kwargs, str):
        try:
            kwargs = json.loads(kwargs)
        except (ValueError, TypeError):
            return {}
    return kwargs if isinstance(kwargs, dict) else {}


# Declared on every tool for host compatibility; see _unwrap.
CompatKwargs = Annotated[
    dict | str | None,
    Field(
        description=(
            "相容用，正常情況請留空、直接傳上面的參數。"
            "某些 MCP host 會把真正的參數包在這個鍵底下，這裡會自動拆開。"
        )
    ),
]


# ── Tools ────────────────────────────────────────────────────────────────────
@mcp.tool(
    name="erp_list_jobs",
    description=(
        "列出等待整理成 ERP 匯入格式的檢驗報告。**每次任務都先呼叫這個**，"
        "拿到 job_id 才能往下做。預設只列 status=pending（還沒整理的）。"
        "回傳的是摘要，不含報告內容。"
    ),
)
async def erp_list_jobs(
    status: Annotated[
        str, Field(description="pending（待整理，預設）/ mapped（已整理）/ failed（OCR 失敗）/ all")
    ] = "pending",
    batch_id: Annotated[str, Field(description="只看某一批上傳的檔案，通常留空")] = "",
    limit: Annotated[int, Field(description="最多列幾筆", ge=1, le=200)] = 50,
    kwargs: CompatKwargs = None,
) -> str:
    if extra := _unwrap(kwargs):
        status = extra.get("status", status) or status
        batch_id = extra.get("batch_id", batch_id) or batch_id
        limit = int(extra.get("limit", limit) or limit)

    params: dict[str, Any] = {"limit": limit}
    if status and status != "all":
        params["status"] = status
    if batch_id:
        params["batch_id"] = batch_id
    try:
        r = await _request("GET", "/api/erp/jobs", params=params, headers=_headers())
    except httpx.HTTPStatusError as e:
        return _explain_http_error(e)
    except httpx.RequestError as e:
        return f"Error: cannot reach the 規格析 backend at {BASE_URL} ({e})."

    jobs = r.json().get("jobs", [])
    if not jobs:
        return f"目前沒有 status={status} 的報告。"
    head = f"{len(jobs)} 份報告（status={status}）：\n"
    return head + "\n".join(_job_line(j) for j in jobs)


def _clip(md: str, limit: int) -> str:
    if len(md) <= limit:
        return md
    return md[:limit] + f"\n\n[⚠ 內容過長已截斷於 {limit} 字，後段未顯示]"


@mcp.tool(
    name="erp_get_markdown",
    description=(
        "讀出某一份檢驗報告 OCR 後的 Markdown 原文。這是你要理解並轉成 ERP 欄位的來源。"
        "動手對應之前，先讀 `specocr://reference/erp-schema` 這個 resource——"
        "它定義了目標的 7 個欄位，以及各家供應商實際用過的欄名寫法。\n"
        "有些報告會附上第二份「文字層原文」——同一頁、同樣內容，只是換一個引擎輸出。"
        "版面以主檔為準，數字看不清楚時才拿它對照，兩份不一致就寫進 notes。"
    ),
)
async def erp_get_markdown(
    job_id: Annotated[str, Field(description="erp_list_jobs 給的 job_id")] = "",
    variant: Annotated[
        str,
        Field(
            description=(
                "both（預設，兩份都給）／ primary（只要版面還原版）／ "
                "alt（只要文字層原文）。內容太長時才需要指定單一份。"
            )
        ),
    ] = "both",
    kwargs: CompatKwargs = None,
) -> str:
    if extra := _unwrap(kwargs):
        job_id = job_id or extra.get("job_id", "") or ""
        variant = extra.get("variant", variant) or variant
    if not job_id.strip():
        return (
            "Error: 沒有收到 job_id。請先呼叫 erp_list_jobs 取得 job_id，"
            "再以 job_id 參數傳入（32 位十六進位字串）。"
        )

    try:
        r = await _request(
            "GET", f"/api/erp/jobs/{job_id}", params={"include_markdown": "true"},
            headers=_headers(),
        )
    except httpx.HTTPStatusError as e:
        return _explain_http_error(e)
    except httpx.RequestError as e:
        return f"Error: cannot reach the 規格析 backend at {BASE_URL} ({e})."

    d = r.json()
    md = d.get("markdown") or ""
    alt = d.get("alt_markdown") or ""
    if not md.strip() and not alt.strip():
        return (
            f"這份報告沒有可用內容（{d.get('error') or '空白'}）。"
            "請告訴使用者這個檔案需要重新掃描，不要自行編造欄位。"
        )

    # A job staged under a customer profile has its own column set, not just
    # extra aliases, so the `specocr://reference/erp-schema` resource — which
    # serves the built-in one — would be the wrong target to map onto. Carry
    # the right definition with the document rather than hoping it is asked for.
    profile = d.get("profile_id") or "default"
    profile_schema = ""
    if profile != "default":
        try:
            pr = await _request(
                "GET", "/api/erp/schema.md", params={"profile": profile},
                headers=_headers(),
            )
            profile_schema = (
                f"\n\n---\n\n# ⚠ 這份報告用的是「{profile}」設定檔\n\n"
                "**以下面這份欄位定義為準**，不要用 `specocr://reference/erp-schema` "
                "那份（那是預設客戶的，欄位可能完全不同）。\n\n"
                + pr.text
            )
        except (httpx.HTTPStatusError, httpx.RequestError):
            profile_schema = (
                f"\n\n⚠ 這份報告用的是「{profile}」設定檔，但取不到它的欄位定義。"
                "請先告訴使用者，不要照預設欄位硬填。"
            )

    engine = d.get("engine") or "?"
    alt_engine = d.get("alt_engine") or "fastdoc"
    # `engine` reads "dual" when both ran — that is the name of the mode, not
    # of the engine that produced this half. Name the half.
    primary_engine = "marker" if engine == "dual" else engine
    head = (
        f"# {d.get('filename')}\n"
        f"job_id: `{job_id}` ／ 狀態: {d.get('status')} ／ 引擎: {engine}\n"
    )

    if variant == "alt":
        if not alt.strip():
            return head + "\n這份報告沒有第二份文字層原文，請改用 variant=primary。"
        return head + profile_schema + f"\n---\n\n{_clip(alt, MAX_MARKDOWN_CHARS)}"

    body = f"\n---\n\n{_clip(md, MAX_MARKDOWN_CHARS)}"
    if variant == "primary" or not alt.strip():
        return head + profile_schema + body

    # Both engines ran. Say plainly what the second copy is for, or a reader
    # meeting the same table twice will treat it as two separate reports.
    return (
        head
        + profile_schema
        + "\n這份報告有兩種輸出，**是同一份文件、同樣的內容**，不是兩份報告：\n"
        + f"1. 版面還原版（{primary_engine}）— 表格結構比較準，**判斷哪一欄是什麼看這份**。\n"
        + f"2. 文字層原文（{alt_engine}）— 直接抄檔案內嵌的文字、沒有經過辨識，"
        + "**數字和批號以這份為準**。\n"
        + "用法：照 1 決定欄位歸屬，遇到看不清楚或可疑的值再去 2 找同一格對照。\n"
        + "兩份對不起來（例如同一格一個是 40.12、一個是 4012）就照 1 填，"
        + "並把差異寫進 notes 讓覆核的人看到——不要自己選一個猜。\n"
        + f"\n---\n\n## 1. 版面還原版（{primary_engine}）\n\n"
        + _clip(md, MAX_MARKDOWN_CHARS)
        + f"\n\n---\n\n## 2. 文字層原文（{alt_engine}）\n\n"
        + _clip(alt, MAX_ALT_MARKDOWN_CHARS)
    )


@mcp.tool(
    name="erp_submit_rows",
    description=(
        "把你整理好的 ERP 列回填給系統。rows 是陣列，每個元素一列，"
        "鍵用 supplier_lot / test_item / unit / spec / spec_max / spec_min / result"
        "（也接受中文欄位名）。回填後系統會產生 ERP 匯入檔的下載連結。\n"
        "同一個 job 可以重複呼叫來修正——後一次會整份覆蓋前一次。\n"
        "整份報告一列都認不出來時，回報無法解析並說明原因，**不要送出空列或猜測值**。"
    ),
)
async def erp_submit_rows(
    job_id: Annotated[str, Field(description="要回填的 job_id")] = "",
    rows: Annotated[
        list[dict] | str | None,
        Field(
            description=(
                "整理後的列。範例："
                '[{"supplier_lot":"24102102","test_item":"固成份","unit":"%",'
                '"spec":"40~42","spec_max":"","spec_min":"","result":"40.12"}]'
            )
        ),
    ] = None,
    notes: Annotated[
        str, Field(description="給覆核人員看的備註，例如不確定的地方、跳過的內容")
    ] = "",
    kwargs: CompatKwargs = None,
) -> str:
    if extra := _unwrap(kwargs):
        job_id = job_id or extra.get("job_id", "") or ""
        rows = rows or extra.get("rows")
        notes = notes or extra.get("notes", "") or ""
    # A host that nests arguments often stringifies the nested list too.
    if isinstance(rows, str):
        try:
            rows = json.loads(rows)
        except (ValueError, TypeError):
            return "Error: rows 不是有效的 JSON 陣列。"
    if not job_id.strip():
        return (
            "Error: 沒有收到 job_id。請先呼叫 erp_list_jobs 取得 job_id，"
            "再以 job_id 參數傳入（32 位十六進位字串）。"
        )
    if not isinstance(rows, list) or not rows:
        return "Error: rows 是空的。若這份報告真的無法解析，請直接告訴使用者原因，不要送出空陣列。"
    try:
        r = await _request(
            "PUT",
            f"/api/erp/jobs/{job_id}/rows",
            content=json.dumps(
                {"rows": rows, "mapped_by": "知識通", "notes": notes},
                ensure_ascii=False,
            ).encode("utf-8"),
            headers=_headers(json_body=True),
        )
    except httpx.HTTPStatusError as e:
        return _explain_http_error(e)
    except httpx.RequestError as e:
        return f"Error: cannot reach the 規格析 backend at {BASE_URL} ({e})."

    d = r.json()
    out = [
        f"✅ 已回填 {d.get('row_count')} 列 — {d.get('filename')}",
        f"下載 ERP 匯入檔：{PUBLIC_BASE_URL}/api/erp/jobs/{job_id}/export.xlsx",
    ]
    if d.get("warnings"):
        out.append("")
        out.append("系統回報的問題（請一併轉達使用者）：")
        out += [f"- {w}" for w in d["warnings"]]
    dropped = len(rows) - int(d.get("row_count") or 0)
    if dropped > 0:
        out.append(f"\n⚠ 你送了 {len(rows)} 列，系統只收下 {d.get('row_count')} 列。")
    return "\n".join(out)


@mcp.tool(
    name="erp_export_url",
    description=(
        "取得你整理結果的**預覽**下載連結。給一個 job_id 就出單檔；"
        "給多個（逗號分隔）就把整批合併成一個活頁簿（彙總表 + 每個檔一張分頁）。"
        "只有已回填過列的 job 才有內容。\n"
        "注意：這是預覽，**不是最終匯入檔**。真正要進 ERP 的檔案由使用者在規格析"
        "頁面上逐份對照原始 PDF 確認之後才下載得到——把連結給他的時候一併說明。"
    ),
)
async def erp_export_url(
    job_ids: Annotated[str, Field(description="一個或多個 job_id，逗號分隔")] = "",
    fmt: Annotated[str, Field(description="xlsx（預設）或 csv")] = "xlsx",
    kwargs: CompatKwargs = None,
) -> str:
    if extra := _unwrap(kwargs):
        job_ids = job_ids or extra.get("job_ids", "") or ""
        fmt = extra.get("fmt", fmt) or fmt
    # A list survives the trip from some hosts; a comma-joined string from others.
    if isinstance(job_ids, list):
        job_ids = ",".join(str(j) for j in job_ids)
    ids = [j.strip() for j in str(job_ids).split(",") if j.strip()]
    if not ids:
        return "Error: job_ids 是空的。"
    fmt = "csv" if fmt.lower() == "csv" else "xlsx"
    tail = "\n（這是覆核前的預覽。最終匯入檔請到規格析頁面逐份確認後下載。）"
    if len(ids) == 1 and fmt == "xlsx":
        return f"預覽：{PUBLIC_BASE_URL}/api/erp/jobs/{ids[0]}/export.xlsx" + tail
    joined = ",".join(ids)
    # only_reviewed defaults to true on the batch export — nothing is signed
    # off yet at this point in the flow, so a default link would download an
    # empty workbook. This one is explicitly the pre-review preview.
    return (
        f"預覽（{len(ids)} 份合併）："
        f"{PUBLIC_BASE_URL}/api/erp/export.{fmt}?job_ids={joined}&only_reviewed=false"
        + tail
    )


@mcp.tool(
    name="erp_backend_status",
    description="唯讀：確認 規格析 backend 連得到、schema 讀得到。連不上時先用這個診斷。",
)
async def erp_backend_status() -> str:
    try:
        r = await _request("GET", "/api/erp/schema", headers=_headers())
    except httpx.HTTPStatusError as e:
        return _explain_http_error(e)
    except httpx.RequestError as e:
        return (
            f"Error: cannot reach the 規格析 backend at {BASE_URL} ({e}). "
            "檢查 SPECOCR_BASE_URL 與後端是否啟動。"
        )
    d = r.json()
    cols = "、".join(c["name"] for c in d.get("columns", []))
    n_alias = sum(len(c.get("aliases") or []) for c in d.get("columns", []))
    return (
        f"OK — backend: {BASE_URL}（下載連結用 {PUBLIC_BASE_URL}）\n"
        f"schema v{d.get('version')}：{cols}\n"
        f"已收錄 {n_alias} 種供應商欄名寫法。"
    )


# ── Resources ────────────────────────────────────────────────────────────────
@mcp.resource("specocr://reference/erp-schema")
def erp_schema_reference() -> str:
    """目標的 7 個 ERP 欄位、各欄的判斷說明，以及各家供應商實際用過的欄名寫法。
    對應任何一份報告之前都先讀這個。"""
    # Served live from the backend's schema.yaml so adding a supplier alias
    # there takes effect here without touching this file. Falls back to the
    # bundled copy when the backend is down, so the host is never left with
    # no schema at all.
    try:
        r = httpx.get(
            f"{BASE_URL}/api/erp/schema.md", headers=_headers(), timeout=HTTP_TIMEOUT
        )
        r.raise_for_status()
        return r.text
    except Exception:
        return _read_ref("erp-schema.md")


@mcp.resource("specocr://reference/report-patterns")
def report_patterns_reference() -> str:
    """實際遇過的報告版型與踩過的坑：合併儲存格、多頁報告、掃描件雜訊、
    規格寫成區間 vs 拆成上下限、特殊版型怎麼處理。"""
    # Served live from backend/erp/reference/, which is also what the backend's
    # own local-LLM mapper reads — so the two readers cannot drift apart. Falls
    # back to the bundled copy when the backend is down, same as the schema
    # resource above.
    try:
        r = httpx.get(
            f"{BASE_URL}/api/erp/patterns.md", headers=_headers(), timeout=HTTP_TIMEOUT
        )
        r.raise_for_status()
        if r.text.strip():
            return r.text
    except Exception:
        pass
    return _read_ref("report-patterns.md")


# ── Prompt ───────────────────────────────────────────────────────────────────
@mcp.prompt(name="md_to_erp")
def md_to_erp_prompt(job_id: str = "") -> str:
    """Workflow: 檢驗報告 Markdown → ERP 匯入列."""
    base = (
        "你要把進料檢驗報告（COA）整理成 ERP 匯入格式。這是**閱讀理解**任務，"
        "不是寫程式：不要產生任何程式碼、regex 或解析腳本。\n\n"
        "1. 讀 `specocr://reference/erp-schema` — 目標的 7 個欄位與各家供應商的欄名寫法。\n"
        "2. 讀 `specocr://reference/report-patterns` — 實際踩過的版型陷阱。\n"
        "3. 呼叫 `erp_list_jobs` 看有哪些待整理的報告。\n"
        "4. 對每一份呼叫 `erp_get_markdown` 讀原文。\n"
        "5. 判斷原表的哪一欄對應到哪一個 ERP 欄位。欄名沒出現在別名清單裡是常態——"
        "照語意判斷，不要因為「不在清單」就放棄該欄。\n"
        "6. 值一律照抄：不換算單位、不改寫區間符號、不補零、不翻譯。\n"
        "7. 呼叫 `erp_submit_rows` 回填。不確定的地方寫進 notes，讓覆核的人看得到。\n"
        "8. 全部做完後呼叫 `erp_export_url`，把下載連結原樣給使用者——連結不可自行編造。\n\n"
        "認不出來就說認不出來。ERP 收到一列編造的檢驗數據，比收到一份「這份要人工處理」"
        "的清單糟糕得多。\n"
    )
    if job_id.strip():
        base += f"\n這次要處理的 job_id：`{job_id.strip()}`\n"
    return base


if __name__ == "__main__":
    mcp.run(
        transport="streamable-http",
        host=HOST,
        port=PORT,
        transport_security=_transport_security(),
    )
