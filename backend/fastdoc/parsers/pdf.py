"""
Text-layer PDF parser — the fast path.

This reads the text objects a PDF already carries (via pdftext/pypdfium2,
both already in the Marker dependency tree) and infers structure from
geometry: font size for headings, horizontal gaps for table columns, leading
markers for lists. No layout model, no OCR, no GPU.

It is deliberately useless on scanned pages — those carry no text objects at
all. `probe()` exists to tell the two apart before any expensive work starts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from ..model import (
    Cell,
    Document,
    Heading,
    ListBlock,
    ListItem,
    PageBreak,
    Paragraph,
    Span,
    Table,
)

# A line is a heading if its font is this much larger than body text.
HEADING_SIZE_RATIO = 1.15
# Horizontal gap that separates table columns, as a multiple of font size.
COLUMN_GAP_RATIO = 2.0
# Two cells belong to the same column if their left edges are this close,
# as a multiple of font size.
COLUMN_ALIGN_RATIO = 1.2
# A block is a table only if at least this fraction of its lines are multi-cell.
TABLE_ROW_FRACTION = 0.6

_BULLET_RE = re.compile(r"^\s*([-•·▪◦⁃*o])\s+(?=\S)")
_ORDERED_RE = re.compile(r"^\s*\(?(\d{1,3}|[a-zA-Z])[.)]\s+(?=\S)")
# Characters that signal a broken text layer (unmapped glyphs).
_BAD_CHAR_RE = re.compile(r"[�\x00-\x08\x0e-\x1f]")


@dataclass
class _Run:
    """A horizontally contiguous piece of text on one line — a table cell."""

    text: str
    x0: float
    x1: float
    bold: bool
    size: float
    href: str = ""


@dataclass
class _Line:
    runs: list[_Run]
    x0: float
    y0: float
    size: float
    bold: bool

    @property
    def text(self) -> str:
        return "  ".join(r.text for r in self.runs).strip()


def _is_bold(font: dict) -> bool:
    name = (font.get("name") or "").lower()
    weight = font.get("weight") or 0
    flags = font.get("flags") or 0
    # PDF font descriptor bit 19 (0x40000) is ForceBold.
    return "bold" in name or "black" in name or weight >= 600 or bool(flags & 0x40000)


def _split_runs(spans: list[dict], gap: float) -> list[_Run]:
    """Group a line's spans into runs, splitting on wide horizontal gaps."""
    runs: list[_Run] = []
    for span in spans:
        text = span.get("text", "")
        if not text.strip():
            continue
        x0, _, x1, _ = span["bbox"]
        font = span.get("font") or {}
        size = float(font.get("size") or 0)
        bold = _is_bold(font)
        href = span.get("url") or ""
        if runs and (x0 - runs[-1].x1) <= gap:
            prev = runs[-1]
            joiner = "" if (x0 - prev.x1) < size * 0.15 else " "
            prev.text = prev.text.rstrip("\n") + joiner + text.strip("\n")
            prev.x1 = max(prev.x1, x1)
            prev.bold = prev.bold and bold
            prev.href = prev.href or href
        else:
            runs.append(_Run(text.strip("\n"), x0, x1, bold, size, href))
    for run in runs:
        run.text = re.sub(r"\s+", " ", run.text).strip()
    return [r for r in runs if r.text]


def _body_size(lines: list[_Line]) -> float:
    """Most common font size, weighted by how much text is set in it."""
    weights: dict[float, int] = {}
    for line in lines:
        key = round(line.size * 2) / 2
        weights[key] = weights.get(key, 0) + len(line.text)
    if not weights:
        return 10.0
    return max(weights.items(), key=lambda kv: kv[1])[0]


def _heading_levels(lines: list[_Line], body: float) -> dict[float, int]:
    """Map each above-body font size to a heading level, largest = h1."""
    sizes = sorted(
        {round(ln.size * 2) / 2 for ln in lines if ln.size > body * HEADING_SIZE_RATIO},
        reverse=True,
    )
    return {size: min(6, idx + 1) for idx, size in enumerate(sizes)}


def _cluster_columns(all_x: list[float], tol: float) -> list[float]:
    """Cluster cell left-edges into column positions."""
    cols: list[float] = []
    for x in sorted(all_x):
        if cols and x - cols[-1] <= tol:
            continue
        cols.append(x)
    return cols


def _as_table(lines: list[_Line], body_size: float) -> Optional[Table]:
    """Interpret a block as a table if its cells line up into columns."""
    if len(lines) < 2:
        return None
    multi = [ln for ln in lines if len(ln.runs) >= 2]
    if len(multi) / len(lines) < TABLE_ROW_FRACTION or len(multi) < 2:
        return None

    tol = max(2.0, body_size * COLUMN_ALIGN_RATIO)
    cols = _cluster_columns([r.x0 for ln in lines for r in ln.runs], tol)
    if len(cols) < 2:
        return None
    # Column count must actually explain the rows; a ragged block that happens
    # to have gaps produces far more clusters than any row has cells.
    if len(cols) > max(len(ln.runs) for ln in lines) + 1:
        return None

    rows: list[list[Cell]] = []
    for line in lines:
        cells = [Cell() for _ in cols]
        for run in line.runs:
            idx = min(
                range(len(cols)), key=lambda i: abs(cols[i] - run.x0)
            )
            spans = [Span(run.text, bold=run.bold, href=run.href or None)]
            if cells[idx].spans:
                cells[idx].spans.append(Span(" " + run.text))
            else:
                cells[idx].spans = spans
        rows.append(cells)

    header: list[Cell] = []
    first, rest = rows[0], rows[1:]
    first_bold = all(
        s.bold for c in first for s in c.spans
    ) and any(c.spans for c in first)
    if first_bold and rest:
        header, rows = first, rest
    return Table(header=header, rows=rows)


def _list_marker(text: str) -> Optional[tuple[bool, str]]:
    """Return (ordered, remaining_text) if the line opens a list item."""
    m = _BULLET_RE.match(text)
    if m:
        return False, text[m.end() :].strip()
    m = _ORDERED_RE.match(text)
    if m:
        return True, text[m.end() :].strip()
    return None


def _join_wrapped(parts: list[str]) -> str:
    """Join wrapped lines, healing end-of-line hyphenation."""
    out = ""
    for part in parts:
        if not out:
            out = part
        elif out.endswith("-") and not out.endswith("--"):
            out = out[:-1] + part
        else:
            out += " " + part
    return out


def _line_spans(line: _Line) -> list[Span]:
    return [
        Span(r.text if i == 0 else " " + r.text, bold=r.bold, href=r.href or None)
        for i, r in enumerate(line.runs)
    ]


def _emit_paragraphs(buffer: list[_Line], doc: Document) -> None:
    """Flush buffered body lines as paragraphs and lists."""
    i = 0
    while i < len(buffer):
        line = buffer[i]
        marker = _list_marker(line.text)
        if marker is None:
            para: list[str] = []
            while i < len(buffer) and _list_marker(buffer[i].text) is None:
                para.append(buffer[i].text)
                i += 1
            text = _join_wrapped(para)
            if text:
                doc.add(Paragraph([Span(text)]))
            continue

        ordered = marker[0]
        items: list[ListItem] = []
        while i < len(buffer):
            m = _list_marker(buffer[i].text)
            if m is None or m[0] != ordered:
                break
            item_lines = [m[1]]
            base_x = buffer[i].x0
            i += 1
            # Continuation lines are indented past the marker and carry none.
            while (
                i < len(buffer)
                and _list_marker(buffer[i].text) is None
                and buffer[i].x0 > base_x + 1
            ):
                item_lines.append(buffer[i].text)
                i += 1
            items.append(ListItem(blocks=[Paragraph([Span(_join_wrapped(item_lines))])]))
        if items:
            doc.add(ListBlock(ordered=ordered, items=items))


def parse_pages(pages: list[dict], page_breaks: bool = True) -> Document:
    """Turn pdftext's page dictionaries into the unified document model."""
    doc = Document(meta={"pages": len(pages)})

    all_lines: list[_Line] = []
    per_block: list[tuple[int, list[_Line]]] = []
    for page in pages:
        for block in page.get("blocks", []):
            block_lines: list[_Line] = []
            for raw in block.get("lines", []):
                spans = raw.get("spans", [])
                sizes = [
                    float((s.get("font") or {}).get("size") or 0)
                    for s in spans
                    if s.get("text", "").strip()
                ]
                if not sizes:
                    continue
                size = max(sizes)
                runs = _split_runs(spans, gap=max(6.0, size * COLUMN_GAP_RATIO))
                if not runs:
                    continue
                block_lines.append(
                    _Line(
                        runs=runs,
                        x0=min(r.x0 for r in runs),
                        y0=raw["bbox"][1],
                        size=size,
                        bold=all(r.bold for r in runs),
                    )
                )
            if block_lines:
                per_block.append((page.get("page", 0), block_lines))
                all_lines.extend(block_lines)

    if not all_lines:
        return doc

    body = _body_size(all_lines)
    levels = _heading_levels(all_lines, body)

    current_page = per_block[0][0]
    for page_no, lines in per_block:
        if page_breaks and page_no != current_page:
            doc.add(PageBreak(number=page_no + 1))
            current_page = page_no

        table = _as_table(lines, body)
        if table is not None:
            doc.add(table)
            continue

        buffer: list[_Line] = []
        for line in lines:
            key = round(line.size * 2) / 2
            level = levels.get(key)
            if level is None and line.bold and len(lines) == 1 and len(line.text) < 80:
                # A short, bold, standalone line at body size is a run-in heading.
                level = min(6, len(levels) + 1)
            if level is None:
                buffer.append(line)
                continue
            _emit_paragraphs(buffer, doc)
            buffer = []
            doc.add(Heading(level=level, spans=_line_spans(line)))
        _emit_paragraphs(buffer, doc)

    return doc


@dataclass
class PdfProbe:
    """Cheap verdict on whether a PDF needs the OCR pipeline."""

    pages: int
    chars: int
    chars_per_page: float
    pages_with_text: int
    text_page_ratio: float
    bad_char_ratio: float
    needs_ocr: bool
    reason: str


def probe(
    pages: list[dict],
    min_chars_per_page: float = 100.0,
    min_page_ratio: float = 0.5,
    max_bad_char_ratio: float = 0.10,
) -> PdfProbe:
    """Decide whether a PDF's text layer is good enough to skip OCR."""
    total_chars = 0
    bad_chars = 0
    with_text = 0
    for page in pages:
        page_chars = 0
        for block in page.get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    stripped = text.strip()
                    page_chars += len(stripped)
                    bad_chars += len(_BAD_CHAR_RE.findall(stripped))
        total_chars += page_chars
        if page_chars >= 20:
            with_text += 1

    n = max(1, len(pages))
    per_page = total_chars / n
    ratio = with_text / n
    bad_ratio = (bad_chars / total_chars) if total_chars else 0.0

    reasons = []
    if per_page < min_chars_per_page:
        reasons.append(f"sparse text layer ({per_page:.0f} chars/page)")
    if ratio < min_page_ratio:
        reasons.append(f"only {with_text}/{n} pages carry text")
    if bad_ratio > max_bad_char_ratio:
        reasons.append(f"broken glyph mapping ({bad_ratio:.0%} unmapped)")

    return PdfProbe(
        pages=len(pages),
        chars=total_chars,
        chars_per_page=round(per_page, 1),
        pages_with_text=with_text,
        text_page_ratio=round(ratio, 3),
        bad_char_ratio=round(bad_ratio, 4),
        needs_ocr=bool(reasons),
        reason="; ".join(reasons),
    )


def read_pages(path: str | Path, page_range: Optional[list[int]] = None) -> list[dict]:
    from pdftext.extraction import dictionary_output

    kwargs = {"page_range": page_range} if page_range is not None else {}
    return dictionary_output(str(path), **kwargs)


def parse(path: str | Path, page_breaks: bool = True) -> Document:
    return parse_pages(read_pages(path), page_breaks=page_breaks)
