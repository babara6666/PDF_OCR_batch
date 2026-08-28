"""Loads schema.yaml and normalises whatever 知識通 posts back.

schema.yaml is the single source of truth for the ERP column set. It is read
once at import and re-read whenever the file's mtime changes, so an operator
can add a supplier's column alias and see it take effect without a restart —
the alias list is expected to grow every time a new supplier shows up.
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import yaml

SCHEMA_PATH = Path(__file__).parent / "schema.yaml"

_lock = threading.Lock()
_cache: dict[str, Any] = {}
_mtime: float = 0.0


def load() -> dict:
    """The parsed schema, reloaded on change."""
    global _cache, _mtime
    with _lock:
        try:
            mtime = SCHEMA_PATH.stat().st_mtime
        except OSError:
            mtime = 0.0
        if not _cache or mtime != _mtime:
            _cache = yaml.safe_load(SCHEMA_PATH.read_text(encoding="utf-8"))
            _mtime = mtime
        return _cache


def columns() -> list[dict]:
    return load()["columns"]


def keys() -> list[str]:
    return [c["key"] for c in columns()]


def headers() -> list[str]:
    """Chinese column names, in ERP import order."""
    return [c["name"] for c in columns()]


def required_keys() -> list[str]:
    return [c["key"] for c in columns() if c.get("required")]


def normalise_rows(rows: Any) -> tuple[list[dict], list[str]]:
    """Coerce posted rows into the schema's shape.

    Returns `(rows, warnings)`. This is deliberately forgiving: the rows come
    from an LLM, so it accepts either the English keys or the Chinese column
    names, drops anything outside the schema, and stringifies values (a lot
    number like 24102102 must not become the float 24102102.0 in Excel). What
    it does *not* do is invent values — a row missing every required field is
    dropped and reported, because a blank row silently imported into ERP is
    worse than a visible complaint.
    """
    warnings: list[str] = []
    if not isinstance(rows, list):
        return [], ["rows 必須是陣列"]

    cols = columns()
    by_key = {c["key"]: c["key"] for c in cols}
    by_name = {c["name"]: c["key"] for c in cols}
    req = required_keys()

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


def as_markdown() -> str:
    """The schema rendered for an LLM to read — the MCP resource body."""
    d = load()
    lines = [
        "# ERP 匯入欄位定義",
        "",
        f"schema version: {d.get('version')}",
        "",
        "輸出**一定**是這 7 欄，順序不可變，鍵名用 `key`：",
        "",
        "| key | 欄位名稱 | 必填 |",
        "| --- | --- | --- |",
    ]
    for c in d["columns"]:
        lines.append(
            f"| `{c['key']}` | {c['name']} | {'是' if c.get('required') else '否'} |"
        )

    lines += ["", "## 各欄說明與供應商別名", ""]
    for c in d["columns"]:
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
