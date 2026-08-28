# specocr_mcp — MCP server for 規格析 ERP 匯入

A thin **MCP server** that lets an LLM platform (the MCP *host* — 知識通) read
OCR'd incoming-inspection reports and write them back as ERP import rows. The
**host LLM does the thinking**; the **company-deployed 規格析 backend only
stores and exports**, and this server returns **download URLs**.

```
知識通 (MCP host) ──reads MD, decides the mapping──►  specocr_mcp (this)
   (its own LLM)     erp_get_markdown / erp_submit_rows      │ HTTP
                                                             ▼
                                                規格析 backend /api/erp/*
                                                stores rows → xlsx/csv
                                                → download URLs returned
```

**No LLM anywhere in this stack** — the host is the brain; the backend is a
pure storage + export service. Keep this server in its **own environment**,
separate from the backend (the backend pins an older starlette via FastAPI +
marker; the MCP SDK needs a newer one).

## What problem this solves

Every supplier's COA labels the same seven things differently:

| ERP 欄位 | 供應商實際寫過的 |
|---|---|
| 供應商批號 | 批號 / Lot No. / BATCH NO / L/C NO. / 代工原料卷號 / 訂單號碼 / 批号 … |
| 檢驗結果 | Test Value / 實測值 / 分 析 結 果 / AVERAGE / 实际值 / Batch Avg … |

The previous approach was a hand-maintained alias table (`key.xlsx`, 163 entries
and growing) matched by string equality. Three rounds of manual review across 38
reports still showed 特殊規格 / 未抓到 / 辨識錯誤 on roughly half of them — a new
supplier means a new alias, forever.

Here the alias list becomes a **hint** rather than a rule: `specocr://reference/
erp-schema` hands 知識通 the target columns, what each one means, and every
spelling seen so far, and the host maps by meaning. An unseen column name is
then a normal case, not a failure.

## Exposes

| Kind | Name | Purpose |
|------|------|---------|
| tool | `erp_list_jobs(status, batch_id, limit)` | Reports waiting to be mapped. Call first — everything else needs a `job_id`. |
| tool | `erp_get_markdown(job_id, variant)` | The OCR'd markdown of one report — both engines' renderings when dual mode ran. `variant`: `both` (default) / `primary` / `alt`. |
| tool | `erp_submit_rows(job_id, rows, notes)` | Write the mapped rows back → returns the ERP import file's URL. Idempotent; call again to correct. |
| tool | `erp_export_url(job_ids, fmt)` | Download URL for one job or a merged batch (xlsx/csv). |
| tool | `erp_backend_status()` | Read-only: is the backend reachable, which schema is loaded. |
| resource | `specocr://reference/erp-schema` | The 7 ERP columns, per-column judgement rules, and the supplier alias list. Served **live** from the backend's `schema.yaml`. |
| resource | `specocr://reference/report-patterns` | Layout traps seen in real reports: merged cells, multi-page, scan noise, 規格 as a range vs split limits, 簡體 reports. |
| prompt | `md_to_erp` | Workflow: report markdown → ERP rows → download link. |

## Dual mode: two renderings, one document

When the uploaded file carries a text layer, 規格析 runs both engines and keeps
both outputs on the job:

| | What it is | What it is good for |
|---|---|---|
| `markdown` | Marker's layout reconstruction | Table structure — which column a value belongs to |
| `alt_markdown` | fastdoc's copy of the embedded text layer | Exact characters — no OCR guessing on digits |

They are **the same content**, so `erp_get_markdown` hands over both under one
heading that says so explicitly. A reader given the same table twice with no
explanation will otherwise map it as two reports and double every row.

The pairing is worth the extra tokens because the two failure modes are
complementary: Marker can turn `24102102` into `2410Z1O2` but gets the columns
right; fastdoc never misreads a glyph it copied but flattens the table. Mapping
structure from one and digits from the other removes most of the 辨識錯誤 column
in the review log.

Scans have no text layer, so most reports still arrive with a single rendering —
that is the normal case, not a degraded one.

## The 知識通 side

Registering the MCP URL is only half of it — 知識通 also needs to know *when* and
*how* to use these tools. Upload `reference/zhishitong-skill-erp-import.md` as a
skill there, the same way LLMCAD3's 2D-placement skill is set up. Without it the
host has the tools but no workflow, and results vary run to run.

## Setup

```bash
conda create -n printlens-mcp python=3.11 -y
uv pip install --python <env>/python.exe -r requirements.txt
cp .env.example .env      # then edit
```

| Variable | Meaning |
|----------|---------|
| `SPECOCR_BASE_URL` | where this server reaches the backend (internal) |
| `SPECOCR_PUBLIC_BASE_URL` | base URL written into returned download links (user-reachable) |
| `SPECOCR_API_KEY` | must match the backend's `API_KEY` when set |
| `SPECOCR_MCP_HOST` / `SPECOCR_MCP_PORT` | this server's bind address (default `127.0.0.1:8766`) |
| `SPECOCR_MCP_ALLOWED_HOSTS` / `_ORIGINS` | hostnames to accept when fronted by a tunnel/proxy (see below) |
| `SPECOCR_MCP_PUBLIC` | `1` disables DNS-rebinding protection entirely |

`.env` next to `specocr_mcp.py` is loaded on startup (via `python-dotenv`). Real
environment variables take precedence, so a container or systemd unit that sets
them stays in control.

> The backend needs **no** LLM/provider config for this path.

## Run

```bash
conda run -n printlens-mcp python specocr_mcp.py
# streamable-HTTP at http://<host>:<port>/mcp  — register this URL in 知識通
```

Port 8766 by default, so it can run alongside `llmcad_mcp` (8765) on the same box.

## Connecting 知識通

The host reaches this server over the public internet, and end users click the
download links in their browser — so **two** URLs have to be reachable, and they
are not the same one:

1. **This server** — expose `http://127.0.0.1:8766/mcp` and register the public
   `https://…/mcp` URL in 知識通.
2. **The backend** — set `SPECOCR_PUBLIC_BASE_URL` to a public URL for the
   backend, otherwise every returned link says `localhost:8000` and is dead for
   anyone but you.

Then pin the hostname, or the SDK's DNS-rebinding protection rejects the host's
requests with **HTTP 421**:

```bash
SPECOCR_MCP_ALLOWED_HOSTS=your-tunnel.trycloudflare.com
SPECOCR_MCP_ALLOWED_ORIGINS=https://your-tunnel.trycloudflare.com
```

Quick tunnels (`cloudflared tunnel --url …`) hand out a **new hostname every
restart** — refresh `SPECOCR_PUBLIC_BASE_URL`, `SPECOCR_MCP_ALLOWED_HOSTS` and
the URL registered in 知識通 each time, and restart this server so it re-reads
them.

Finally, flip `ERP_ENABLED` to `true` in `frontend/src/config.js` and rebuild the
frontend. It ships off, because with no MCP host connected every report sits in
「等待中」 with no way to progress.

## Maintaining the schema

`backend/erp/schema.yaml` is the single source of truth. Add a supplier's column
spelling under the right column's `aliases` and it takes effect immediately —
the backend re-reads the file on change, and this server serves it live. No
restart, no redeploy.

Refresh the offline fallback copy after editing:

```bash
python -c "import sys;sys.path.insert(0,'backend');from erp import schema;open('mcp_server/reference/erp-schema.md','w',encoding='utf-8').write(schema.as_markdown())"
```

## Smoke test

```bash
# backend reachable?
conda run -n printlens-mcp python -c "import asyncio, specocr_mcp as m; print(asyncio.run(m.erp_backend_status()))"
```

Full MCP handshake against a running server:

```bash
conda run -n printlens-mcp python - <<'PY'
import asyncio
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

async def main():
    async with streamable_http_client("http://127.0.0.1:8766/mcp") as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            print([t.name for t in (await s.list_tools()).tools])
            out = await s.call_tool("erp_backend_status", {})
            print(out.content[0].text)

asyncio.run(main())
PY
```

## Host argument shapes

知識通 does not pass tool arguments at the top level — it nests them under a
single `kwargs` key (sometimes as a JSON string rather than an object). A tool
that declares a **required** parameter therefore fails schema validation before
its body runs, and the host sees `job_id is missing` however it formats the
call. Tools whose parameters all have defaults appear to "work" while silently
ignoring everything passed — which is worse, because nothing looks broken.

So every parameter here has a default, every tool takes a `kwargs` compatibility
argument, and `_unwrap()` flattens it. `llmcad_mcp` does the same thing for the
same reason. Two constraints if you add a tool:

- `_unwrap` / `CompatKwargs` must stay **above** the tool definitions —
  `from __future__ import annotations` makes annotations strings and the SDK
  evaluates them at decoration time, so a name defined further down is not there
  yet (`InvalidSignature: Unable to evaluate type annotations`).
- Validate required-in-spirit arguments **in the body** and return a readable
  error, since the schema can no longer enforce them.

## MCP SDK version

Written against **MCP SDK 2.x**, where `FastMCP` was renamed to `MCPServer` and
`host` / `port` / `transport_security` moved from the constructor to `run()`.
`llmcad_mcp` in the LLMCAD3 repo is still 1.x code — the two are not
interchangeable, which is another reason they get separate environments.

## Security

Reports contain customer inspection data. Keep both this server and the backend
behind the internal network / reverse proxy, bind to `127.0.0.1`, and see
`../security-audit-report.md`.

⚠️ **`SPECOCR_API_KEY` is not a complete answer for a public deployment.** The
backend enforces `API_KEY` on *every* `/api/*` route including the export
endpoints, so turning it on also makes the returned links require the header —
they stop working in a browser. Put access control at a reverse proxy in front
of the backend instead, and leave the export routes readable.

Staged jobs are pruned after `ERP_JOBS_RETENTION_DAYS` (default 14) and capped
at `ERP_JOBS_MAX` (default 2000), so inspection data does not accumulate on disk
indefinitely.
