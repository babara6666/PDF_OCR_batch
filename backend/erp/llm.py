"""Maps a report's markdown to ERP rows using an LLM the deployment controls.

知識通 is an MCP *host*: it comes to the backend when a person asks it to. That
works, and it is still the best reader here — but it means a plant that cannot
reach it ends up with a queue of reports and no way to move them. This module
is the other direction: the backend calls a model itself, so the same job can
be mapped without anyone leaving the page.

Two adapters, both ported down from LLMCAD3's `backend/app/providers/`:

    ollama    POST {base}/api/chat          whatever is pulled on this machine
    gateway   POST {base}/chat/completions  the company's OpenAI-compatible proxy

Deliberately much smaller than what they came from. This is one text-in,
JSON-out call — no agent loop, no tool calling, no vision — so what survives
the port is the wiring, not the machinery. Two pieces of that wiring are not
optional:

  * Ollama is driven through the native `/api/chat` rather than its
    OpenAI-compatible `/v1`, because only the native endpoint accepts
    `think: false` and `options.num_ctx`. A Qwen3-family model left thinking
    will routinely spend the whole turn reasoning and return empty content;
    4096 tokens of default context will silently truncate a COA.
  * discovery never empties the picker. If Ollama is not running or the
    gateway is unreachable, the curated list is served exactly as before —
    a server that is down must not look like a server with no models.

Provider order defaults to `ollama,gateway`: local first, so a site with a
model on the machine never waits on the network. A provider that fails is
logged and the next is tried; when they all fail the job stays `pending` and
知識通 can still pick it up, which is the whole reason this is additive rather
than a replacement.

Be honest about the quality gap: an 8B–35B local model is a weaker reader than
知識通 on the thing that actually matters here — a supplier column name nobody
has seen before. The review gate in front of the export is what makes that
acceptable, not optimism.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any

import httpx

from . import schema

logger = logging.getLogger("printlens.erp.llm")

REFERENCE_DIR = Path(__file__).parent / "reference"

# Which engines to try, in order. Empty (the default) means the whole path is
# off and 知識通 over MCP is the only mapper, i.e. exactly today's behaviour.
PROVIDER_ORDER = [
    p.strip() for p in os.getenv("ERP_LLM_PROVIDERS", "").split(",") if p.strip()
]
# Pins one model across every provider. Normally left unset — each provider's
# own default is used, and the UI picks per request.
FORCED_MODEL = os.getenv("ERP_LLM_MODEL", "").strip()

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
# Ollama defaults num_ctx to 4096. A dual-mode COA is comfortably past that,
# and the overflow is dropped silently — the model simply never sees the end of
# the table.
OLLAMA_NUM_CTX = int(os.getenv("ERP_OLLAMA_NUM_CTX", "32768"))

GATEWAY_BASE_URL = os.getenv("GATEWAY_BASE_URL", "http://llmgateway.fst:4000/v1").rstrip("/")
GATEWAY_API_KEY = os.getenv("GATEWAY_API_KEY", "").strip()

# Reading a full COA is minutes of work for a local MoE model on CPU.
READ_TIMEOUT = float(os.getenv("ERP_LLM_TIMEOUT", "900"))
DISCOVERY_TIMEOUT = 3.0
DISCOVERY_TTL = 300

# Curated models: the top of each picker, the default, and the fallback shown
# when a server cannot be asked. Discovery is strictly additive to this.
PROVIDER_MODELS: dict[str, list[str]] = {
    # Verified against the agent loop in LLMCAD3. qwen3.6:35b-a3b is an MoE
    # with ~3B active, so it reads a report at a usable speed without a large
    # GPU; qwen3-vl:8b is the fallback for a smaller machine.
    "ollama": ["qwen3.6:35b-a3b", "qwen3-vl:8b"],
    # The company LiteLLM proxy fronts the frontier models, so this is the
    # closest thing to 知識通 that stays inside the network.
    "gateway": [
        "anthropic/claude-opus-5",
        "anthropic/claude-sonnet-5",
        "anthropic/claude-haiku-4-5",
        "Qwen3.6-35B-A3B-AWQ",
    ],
}


class MappingError(RuntimeError):
    """No configured provider could map the document."""


# ── Model discovery ──────────────────────────────────────────────────────────
_catalog_lock = threading.Lock()
_catalog: dict[str, dict] = {}


def _cache_get(provider: str) -> dict | None:
    with _catalog_lock:
        entry = _catalog.get(provider)
        if entry and time.time() - entry["fetched_at"] < DISCOVERY_TTL:
            return entry
        return None


def _cache_put(provider: str, models: list[str], error: str = "") -> dict:
    entry = {"models": models, "error": error, "fetched_at": time.time()}
    with _catalog_lock:
        _catalog[provider] = entry
    return entry


def _merge(curated: list[str], found: list[str]) -> list[str]:
    """Curated names first (they pin the default), then whatever else exists."""
    seen = set()
    out = [m for m in curated if m in found and not (m in seen or seen.add(m))]
    out += [m for m in found if m not in seen]
    return out or list(curated)


def _discover(provider: str) -> dict:
    """Ask a server what it serves. Never raises; falls back to the curated list."""
    cached = _cache_get(provider)
    if cached:
        return cached

    curated = PROVIDER_MODELS.get(provider, [])
    try:
        if provider == "ollama":
            r = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=DISCOVERY_TIMEOUT)
            r.raise_for_status()
            found = [m.get("name", "") for m in r.json().get("models", [])]
        elif provider == "gateway":
            headers = {"Authorization": f"Bearer {GATEWAY_API_KEY}"} if GATEWAY_API_KEY else {}
            r = httpx.get(
                f"{GATEWAY_BASE_URL}/models", headers=headers, timeout=DISCOVERY_TIMEOUT
            )
            r.raise_for_status()
            found = [m.get("id", "") for m in r.json().get("data", [])]
        else:
            return _cache_put(provider, curated, "unknown provider")
    except Exception as e:
        # A server that is down must not empty the dropdown.
        logger.info("ERP: %s model discovery failed (%s)", provider, e)
        return _cache_put(provider, curated, str(e))

    return _cache_put(provider, _merge(curated, [m for m in found if m]), "")


def available() -> dict:
    """What the UI needs to draw the engine picker. Cheap after the first call."""
    out: dict[str, Any] = {"order": PROVIDER_ORDER, "providers": {}}
    for provider in PROVIDER_MODELS:
        catalog = _discover(provider)
        models = catalog["models"]
        out["providers"][provider] = {
            "models": models,
            # Keep the curated default even when the server also serves newer
            # models, so nobody's default changes under them.
            "default_model": next(
                (m for m in PROVIDER_MODELS[provider] if m in models),
                models[0] if models else "",
            ),
            # Ollama is local and needs no key; the gateway does unless the
            # proxy is open inside the network.
            "configured": provider == "ollama" or bool(GATEWAY_API_KEY),
            "enabled": provider in PROVIDER_ORDER,
            "error": catalog["error"],
        }
    return out


# ── Prompt ───────────────────────────────────────────────────────────────────
def reference(name: str) -> str:
    """A bundled reference document, or "" when it is missing."""
    try:
        return (REFERENCE_DIR / name).read_text(encoding="utf-8")
    except OSError:
        return ""


# The same instructions the 知識通 skill carries, condensed. They are here
# rather than in a prompt file because they are the contract this module has
# with schema.normalise_rows(), which is what actually accepts the output.
SYSTEM_PROMPT = """\
你是進料檢驗報告（COA）的判讀員。使用者給你一份報告的 Markdown 原文，
你要判斷原表的哪一欄對應到哪一個 ERP 欄位，然後輸出 ERP 匯入用的列。

這是**閱讀理解**任務。不要寫程式、regex 或解析腳本，直接讀懂內容作答。

核心原則：
- 別名清單是提示不是規則。欄名沒出現在清單裡是常態，照語意判斷即可。
- 一列 = 一個檢驗項目。報告上半部的表頭（產品名、日期、檢驗人員、單號）不是檢驗列。
- 批號從表頭取出放進第一列的 supplier_lot，其餘列留空；報告本身逐列列出不同批號時才逐列填。
- 規格欄空白但結果欄有值 → 這一列照樣要輸出。
- 值一律照抄：不換算單位、不把「~」改成「-」、不補零、不翻譯。
- 分不出上下限就整串放 spec，寧可留空 spec_max / spec_min 也不要猜。
- 掃描件的 OCR 雜訊（不成字的內容）不要當成檢驗項目輸出。
- 認不出來就說認不出來，寫進 notes。**絕對不要編造檢驗數據**——
  這些是進料允收的依據，錯一個數字就是放行了不該放行的料。

只輸出 JSON，形狀為：
{"rows": [{"supplier_lot": "", "test_item": "", "unit": "", "spec": "",
           "spec_max": "", "spec_min": "", "result": ""}], "notes": ""}
notes 寫下你不確定的地方，給覆核的人看。一列都認不出來時 rows 給空陣列並在 notes 說明原因。
"""

# Ollama takes a JSON schema in `format`; the gateway only has json_object
# mode, so the shape is stated in the prompt for both and enforced here for
# the one that can enforce it. Built per profile, because the columns are the
# customer's, not a constant.
def _response_schema(profile: str) -> dict:
    return {
        "type": "object",
        "properties": {
            "rows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {k: {"type": "string"} for k in schema.keys(profile)},
                },
            },
            "notes": {"type": "string"},
        },
        "required": ["rows"],
    }


def _user_prompt(filename: str, markdown: str, alt_markdown: str, profile: str) -> str:
    parts = [
        schema.as_markdown(profile),
        "",
        reference("report-patterns.md"),
        "",
        "---",
        "",
        f"# 要判讀的報告：{filename}",
    ]
    if alt_markdown.strip():
        # Same wording as the MCP tool uses, for the same reason: a reader
        # meeting the same table twice will otherwise treat it as two reports
        # and emit every row twice.
        parts += [
            "",
            "這份報告有兩種輸出，**是同一份文件、同樣的內容**，不是兩份報告：",
            "1. 版面還原版 — 表格結構比較準，判斷哪一欄是什麼看這份。",
            "2. 文字層原文 — 直接抄檔案內嵌的文字、沒有經過辨識，數字和批號以這份為準。",
            "照 1 決定欄位歸屬與列的切分；值看不清楚時去 2 對照。"
            "兩份對不起來就照 1 填，並把差異寫進 notes。**不要把兩份的列加起來輸出。**",
            "",
            "## 1. 版面還原版",
            "",
            markdown,
            "",
            "## 2. 文字層原文",
            "",
            alt_markdown,
        ]
    else:
        parts += ["", markdown]
    return "\n".join(parts)


# ── Adapters ─────────────────────────────────────────────────────────────────
def _parse(content: str, key: str) -> tuple[list, str]:
    """Pull `key`'s array and the notes out of whatever the model returned.

    Tolerant on purpose: a model told to emit JSON still sometimes wraps it in
    a fence or a sentence. Anything genuinely unparseable raises, so the caller
    can move on to the next provider rather than record an empty mapping.

    The adapters return raw text and this does the reading, because the two
    tasks here want different arrays out of the same envelope — `rows` when
    mapping a report, `columns` when drafting a profile.
    """
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise MappingError("模型沒有回傳 JSON")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise MappingError(f"模型回傳的 JSON 解析失敗：{e}") from e

    items = data.get(key)
    if not isinstance(items, list):
        raise MappingError(f"模型回傳的 JSON 沒有 {key} 陣列")
    return items, str(data.get("notes") or "")


async def _run_ollama(model: str, system: str, user: str, fmt: dict | None = None) -> str:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        # See the module docstring: thinking left on burns the turn.
        "think": False,
        "options": {"num_ctx": OLLAMA_NUM_CTX, "temperature": 0.0},
    }
    if fmt:
        # Only the native endpoint takes a JSON schema here, which is half the
        # reason this does not go through Ollama's /v1.
        payload["format"] = fmt
    timeout = httpx.Timeout(connect=10.0, read=READ_TIMEOUT, write=60.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
        r.raise_for_status()
        return (r.json().get("message") or {}).get("content") or ""


async def _run_gateway(model: str, system: str, user: str, fmt: dict | None = None) -> str:
    headers = {"Content-Type": "application/json"}
    if GATEWAY_API_KEY:
        headers["Authorization"] = f"Bearer {GATEWAY_API_KEY}"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0,
        # The proxy speaks OpenAI, which has json_object mode but not a schema,
        # so the shape is carried by the prompt and checked by _parse.
        "response_format": {"type": "json_object"},
    }
    timeout = httpx.Timeout(connect=10.0, read=READ_TIMEOUT, write=60.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(
            f"{GATEWAY_BASE_URL}/chat/completions", json=payload, headers=headers
        )
        r.raise_for_status()
        choices = r.json().get("choices") or []
        if not choices:
            raise MappingError("gateway 沒有回傳任何內容")
        return choices[0].get("message", {}).get("content") or ""


_RUNNERS = {"ollama": _run_ollama, "gateway": _run_gateway}


# ── Entry point ──────────────────────────────────────────────────────────────
def enabled() -> bool:
    return bool(PROVIDER_ORDER)


def default_model(provider: str) -> str:
    return FORCED_MODEL or available()["providers"].get(provider, {}).get("default_model", "")


async def map_document(
    *,
    filename: str,
    markdown: str,
    alt_markdown: str = "",
    profile: str = schema.DEFAULT_PROFILE,
    provider: str = "",
    model: str = "",
) -> tuple[list[dict], str, str]:
    """Read one report and return `(rows, notes, mapped_by)`.

    `provider` empty means "walk ERP_LLM_PROVIDERS in order". Rows come back
    exactly as the model wrote them — normalising and dropping is
    `schema.normalise_rows`'s job, and it already knows how to be forgiving
    about what an LLM returns.
    """
    if not markdown.strip() and not alt_markdown.strip():
        raise MappingError("這份報告沒有可判讀的內容")

    order = [provider] if provider else PROVIDER_ORDER
    if not order:
        raise MappingError(
            "沒有設定任何本機或公司 LLM（ERP_LLM_PROVIDERS 是空的）。"
            "這份報告仍可由知識通經 MCP 處理。"
        )

    user = _user_prompt(filename, markdown, alt_markdown, profile)
    failures: list[str] = []

    for name in order:
        runner = _RUNNERS.get(name)
        if runner is None:
            failures.append(f"{name}：不認識這個 provider")
            continue
        chosen = model or FORCED_MODEL or default_model(name)
        if not chosen:
            failures.append(f"{name}：沒有可用的模型")
            continue
        started = time.time()
        try:
            rows, notes = _parse(
                await runner(chosen, SYSTEM_PROMPT, user, _response_schema(profile)),
                "rows",
            )
        except Exception as e:
            logger.warning("ERP: %s/%s failed on %s — %s", name, chosen, filename, e)
            failures.append(f"{name}/{chosen}：{e}")
            continue
        logger.info(
            "ERP: %s/%s mapped %s → %d row(s) in %.1fs",
            name, chosen, filename, len(rows), time.time() - started,
        )
        return rows, notes, f"{name}／{chosen}"

    raise MappingError("；".join(failures) or "沒有可用的 LLM")


# ── Learning a customer's profile ────────────────────────────────────────────
DRAFT_SYSTEM_PROMPT = """\
你在幫一個新客戶建立「進料檢驗報告 → ERP 欄位」的對應設定檔。

你會拿到幾份樣本。每一份是**一份報告的原文**，加上**這個客戶自己人工整理出來的
正確答案**（他們每天在做的那張表）。你的工作是回頭解釋那個答案：

對答案裡的每一個 ERP 欄位，找出報告原文中是哪一欄提供了那個值，
把該欄在原文裡的**實際寫法**收進 aliases。

這是歸納，不是創作：
- aliases 只能寫**報告原文裡真的出現過的欄名字串**，照抄，含空格、冒號、大小寫。
- 同一個 ERP 欄位在不同供應商的報告裡寫法不同是常態，全部收進同一個欄位的 aliases。
- 對不起來的欄位就跳過，寫進 notes。**不要編造沒看過的欄名**——
  編出來的別名會變成之後每一份報告的錯誤提示，比少收一個嚴重得多。
- 沒有附答案的樣本只能拿來看欄名，不要為它推論對應關係。
- 欄位的 name 用客戶答案表的表頭原文，順序照答案表的順序，那是他們 ERP 認的東西。
- required 一律給 false，由人決定。

只輸出 JSON：
{"columns": [{"key": "英文小寫底線", "name": "客戶表頭原文", "required": false,
              "description": "這一欄是什麼，一句話", "aliases": ["原文欄名", ...]}],
 "notes": "你不確定或對不起來的地方"}
"""


_DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "columns": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "aliases": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["key", "name"],
            },
        },
        "notes": {"type": "string"},
    },
    "required": ["columns"],
}


async def draft_profile(
    *,
    samples: list[dict],
    base_columns: list[dict] | None = None,
    provider: str = "",
    model: str = "",
) -> tuple[list[dict], str, str]:
    """Generalise `(report, answer)` pairs into profile columns.

    Returns `(columns, notes, drafted_by)`. The result is a draft: nothing here
    is saved, and `learn.merge_columns` folds it onto whatever the profile
    already had so a bad draft can only propose, never delete.
    """
    from . import learn

    if not samples:
        raise MappingError("沒有樣本可以學習")

    order = [provider] if provider else PROVIDER_ORDER
    if not order:
        raise MappingError(
            "沒有設定任何本機或公司 LLM（ERP_LLM_PROVIDERS 是空的）。"
            "改用知識通，或直接匯入客戶的別名對照表（key.xlsx）。"
        )

    parts = []
    if base_columns:
        parts += [
            "目前已有的欄位定義（請沿用 key 與順序，只補 aliases）：",
            "",
            json.dumps(
                [{"key": c["key"], "name": c["name"]} for c in base_columns],
                ensure_ascii=False,
            ),
            "",
        ]
    parts += ["以下是樣本：", "", learn.samples_for_draft(samples)]
    user = "\n".join(parts)

    failures: list[str] = []
    for name in order:
        runner = _RUNNERS.get(name)
        chosen = model or FORCED_MODEL or default_model(name)
        if runner is None or not chosen:
            failures.append(f"{name}：沒有可用的模型")
            continue
        try:
            columns, notes = _parse(
                await runner(chosen, DRAFT_SYSTEM_PROMPT, user, _DRAFT_SCHEMA),
                "columns",
            )
        except Exception as e:
            logger.warning("ERP: profile draft via %s/%s failed — %s", name, chosen, e)
            failures.append(f"{name}/{chosen}：{e}")
            continue
        logger.info("ERP: %s/%s drafted %d column(s)", name, chosen, len(columns))
        return columns, notes, f"{name}／{chosen}"

    raise MappingError("；".join(failures) or "沒有可用的 LLM")
