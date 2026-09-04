"""The ERP column definition, per customer, and the normaliser for mapped rows.

A *profile* is one customer's answer to two questions: which columns their ERP
import template expects, and what their suppliers call those things. Both vary
— the seven columns here are 四維's template, not a standard — so a profile
owns the column set itself, not only the aliases.

    backend/erp/schema.yaml        the built-in `default` profile
    <ERP_PROFILES_DIR>/<id>.yaml   one file per customer, same shape

Everything reads through `load(profile)`, which re-reads a file whenever its
mtime changes: an operator adding a supplier's column name, or a learned
profile being saved from the browser, takes effect without a restart. The
alias list is expected to grow every time a new supplier shows up.

An unknown profile falls back to `default` rather than raising. A job outlives
the profile it was mapped under — someone deletes a profile, and last week's
export must still produce a file.
"""
from __future__ import annotations

import logging
import os
import re
import threading
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("printlens.erp.schema")

DEFAULT_PROFILE = "default"

SCHEMA_PATH = Path(__file__).parent / "schema.yaml"
PROFILES_DIR = Path(
    os.getenv("ERP_PROFILES_DIR", str(Path(__file__).parent / "profiles"))
)

# Profile ids become filenames and travel in URLs, so keep them boring.
_PROFILE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
# Column keys become JSON keys and Python dict keys in the export.
_COLUMN_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")

_lock = threading.Lock()
_cache: dict[str, tuple[float, dict]] = {}


class ProfileError(ValueError):
    """The profile is malformed and would break the export if stored."""


def valid_id(profile: str) -> bool:
    return bool(_PROFILE_ID_RE.match(profile or ""))


def path_for(profile: str) -> Path:
    if profile == DEFAULT_PROFILE:
        return SCHEMA_PATH
    if not valid_id(profile):
        raise ProfileError(f"不合法的設定檔名稱：{profile!r}")
    return PROFILES_DIR / f"{profile}.yaml"


def load(profile: str = DEFAULT_PROFILE) -> dict:
    """The parsed profile, reloaded on change, falling back to `default`."""
    profile = profile or DEFAULT_PROFILE
    try:
        path = path_for(profile)
    except ProfileError:
        path = SCHEMA_PATH
        profile = DEFAULT_PROFILE

    with _lock:
        try:
            mtime = path.stat().st_mtime
        except OSError:
            if profile != DEFAULT_PROFILE:
                # Deleted out from under a job that still names it.
                logger.info("ERP: profile %r is gone, using default", profile)
                return load(DEFAULT_PROFILE)
            mtime = 0.0

        cached = _cache.get(profile)
        if cached and cached[0] == mtime:
            return cached[1]
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        _cache[profile] = (mtime, data)
        return data


def columns(profile: str = DEFAULT_PROFILE) -> list[dict]:
    return load(profile)["columns"]


def keys(profile: str = DEFAULT_PROFILE) -> list[str]:
    return [c["key"] for c in columns(profile)]


def headers(profile: str = DEFAULT_PROFILE) -> list[str]:
    """Column names, in ERP import order."""
    return [c["name"] for c in columns(profile)]


def required_keys(profile: str = DEFAULT_PROFILE) -> list[str]:
    return [c["key"] for c in columns(profile) if c.get("required")]


def normalise_rows(rows: Any, profile: str = DEFAULT_PROFILE) -> tuple[list[dict], list[str]]:
    """Coerce posted rows into the profile's shape.

    Returns `(rows, warnings)`. This is deliberately forgiving: the rows come
    from an LLM, so it accepts either the English keys or the display column
    names, drops anything outside the profile, and stringifies values (a lot
    number like 24102102 must not become the float 24102102.0 in Excel). What
    it does *not* do is invent values — a row missing every required field is
    dropped and reported, because a blank row silently imported into ERP is
    worse than a visible complaint.
    """
    warnings: list[str] = []
    if not isinstance(rows, list):
        return [], ["rows 必須是陣列"]

    cols = columns(profile)
    by_key = {c["key"]: c["key"] for c in cols}
    by_name = {c["name"]: c["key"] for c in cols}
    req = required_keys(profile)

    out: list[dict] = []
    unknown: set[str] = set()

    for i, raw in enumerate(rows, 1):
        if not isinstance(raw, dict):
            warnings.append(f"第 {i} 列不是物件，已略過")
            continue
        row = {k: "" for k in by_key}
        for k, v in raw.items():
            key = by_key.get(k) or by_name.get(str(k).strip())
            if key is None:
                unknown.add(str(k))
                continue
            row[key] = "" if v is None else str(v).strip()
        if not any(row[k] for k in req):
            warnings.append(f"第 {i} 列沒有任何必填欄位（{'／'.join(req)}），已略過")
            continue
        out.append(row)

    if unknown:
        warnings.append("以下欄位不在 schema 中，已忽略：" + "、".join(sorted(unknown)))
    return out, warnings


def as_markdown(profile: str = DEFAULT_PROFILE) -> str:
    """The profile rendered for an LLM to read — the MCP resource body."""
    d = load(profile)
    cols = d["columns"]
    lines = [
        "# ERP 匯入欄位定義",
        "",
        f"schema version: {d.get('version')}",
        "",
        f"輸出**一定**是這 {len(cols)} 欄，順序不可變，鍵名用 `key`：",
        "",
        "| key | 欄位名稱 | 必填 |",
        "| --- | --- | --- |",
    ]
    for c in cols:
        lines.append(
            f"| `{c['key']}` | {c['name']} | {'是' if c.get('required') else '否'} |"
        )

    lines += ["", "## 各欄說明與供應商別名", ""]
    for c in cols:
        lines.append(f"### `{c['key']}` — {c['name']}")
        lines.append("")
        lines.append(c.get("description", "").strip())
        lines.append("")
        aliases = c.get("aliases") or []
        lines.append(
            f"實際看過的欄名寫法（{len(aliases)} 種，**僅供提示**，"
            "沒列到的欄名一樣照語意判斷）："
        )
        lines.append("")
        lines.append("`" + "` / `".join(aliases) + "`" if aliases else "（無）")
        lines.append("")

    lines += ["## 規則", ""]
    for r in d.get("rules", []):
        lines.append(f"- {r}")
    return "\n".join(lines) + "\n"


# ── Managing profiles ────────────────────────────────────────────────────────
def summarise(profile: str) -> dict:
    d = load(profile)
    cols = d.get("columns", [])
    return {
        "id": profile,
        "name": d.get("name") or ("預設（四維）" if profile == DEFAULT_PROFILE else profile),
        "version": d.get("version"),
        "builtin": profile == DEFAULT_PROFILE,
        "column_count": len(cols),
        "alias_count": sum(len(c.get("aliases") or []) for c in cols),
        "learned_from": d.get("learned_from") or [],
    }


def list_profiles() -> list[dict]:
    """Every profile, the built-in one first."""
    out = [summarise(DEFAULT_PROFILE)]
    if PROFILES_DIR.exists():
        for p in sorted(PROFILES_DIR.glob("*.yaml")):
            if valid_id(p.stem):
                try:
                    out.append(summarise(p.stem))
                except Exception as e:  # a hand-edited file that no longer parses
                    logger.warning("ERP: profile %s is unreadable (%s)", p.stem, e)
    return out


def validate(data: Any) -> dict:
    """Check a profile hard enough that storing it cannot break the export.

    Everything downstream — the workbook headers, the row normaliser, the
    prompt — trusts `columns`. A profile arrives here from an LLM draft that a
    human then edited, so neither end of that is a reason to trust it.
    """
    if not isinstance(data, dict):
        raise ProfileError("設定檔必須是物件")
    cols = data.get("columns")
    if not isinstance(cols, list) or not cols:
        raise ProfileError("設定檔至少要有一個欄位")

    seen: set[str] = set()
    clean_cols = []
    for i, c in enumerate(cols, 1):
        if not isinstance(c, dict):
            raise ProfileError(f"第 {i} 個欄位不是物件")
        key, name = str(c.get("key", "")).strip(), str(c.get("name", "")).strip()
        if not _COLUMN_KEY_RE.match(key):
            raise ProfileError(f"第 {i} 個欄位的 key 不合法：{key!r}（小寫英數與底線）")
        if not name:
            raise ProfileError(f"欄位 `{key}` 沒有欄位名稱")
        if key in seen:
            raise ProfileError(f"欄位 key 重複：{key}")
        seen.add(key)
        aliases = c.get("aliases") or []
        if not isinstance(aliases, list):
            raise ProfileError(f"欄位 `{key}` 的 aliases 必須是陣列")
        clean_cols.append(
            {
                "key": key,
                "name": name,
                "required": bool(c.get("required")),
                "description": str(c.get("description") or "").strip(),
                # Deduped but order-preserving: the list is a prompt hint, and
                # the same alias twice is just tokens.
                "aliases": list(dict.fromkeys(str(a).strip() for a in aliases if str(a).strip())),
            }
        )

    if not any(c["required"] for c in clean_cols):
        # Without one, normalise_rows keeps every row an LLM emits, including
        # the empty ones it emits when it cannot read the table.
        raise ProfileError("至少要有一個必填欄位，否則空白列會被照單全收")

    rules = data.get("rules") or []
    if not isinstance(rules, list):
        raise ProfileError("rules 必須是陣列")

    return {
        "version": data.get("version") or 1,
        "name": str(data.get("name") or "").strip(),
        "columns": clean_cols,
        "rules": [str(r).strip() for r in rules if str(r).strip()],
        "learned_from": [str(s) for s in (data.get("learned_from") or [])],
    }


def save(profile: str, data: Any) -> dict:
    """Validate and write a profile. Returns its summary."""
    if profile == DEFAULT_PROFILE:
        raise ProfileError("預設設定檔不能從這裡覆寫，請改 backend/erp/schema.yaml")
    path = path_for(profile)
    clean = validate(data)
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    # Atomic: a half-written profile makes every export under it fail.
    tmp = path.with_suffix(".yaml.tmp")
    tmp.write_text(
        yaml.safe_dump(clean, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )
    tmp.replace(path)
    with _lock:
        _cache.pop(profile, None)
    logger.info("ERP: saved profile %s (%d column(s))", profile, len(clean["columns"]))
    return summarise(profile)


def delete(profile: str) -> None:
    if profile == DEFAULT_PROFILE:
        raise ProfileError("預設設定檔不能刪除")
    path_for(profile).unlink(missing_ok=True)
    with _lock:
        _cache.pop(profile, None)
