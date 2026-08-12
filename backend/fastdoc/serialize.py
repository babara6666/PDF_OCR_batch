"""
Stage 3 of the pipeline: the single GitHub-Flavored Markdown serializer.

Every format renders through this one module, so escaping and table rules stay
consistent no matter what went in. Nothing here knows about PDFs or docx.
"""

from __future__ import annotations

import re
from dataclasses import replace

from .model import (
    Blockquote,
    Cell,
    CodeBlock,
    Document,
    Footnote,
    Heading,
    Image,
    Inlines,
    ListBlock,
    PageBreak,
    Paragraph,
    Rule,
    Table,
)

# Tokens that open a block construct when they lead a line. The trailing
# lookahead keeps ordinary content unescaped: `1.` starts a list but `41.2`
# is just a number, and `-5` is not a bullet.
_LINE_START_RE = re.compile(r"^([ \t]*)(#{1,6}|[-+]|\d{1,9}[.)]|={2,})(?=[ \t]|$)", re.M)
# `_` only creates emphasis at word boundaries in GFM; escaping it mid-word
# (file_name_here) would just add noise.
_UNDERSCORE_RE = re.compile(r"(?<!\w)_|_(?!\w)")


def _escape_line_start(match: re.Match) -> str:
    """Neutralise a leading block marker.

    CommonMark only honours backslash escapes before ASCII punctuation, so a
    list marker is defused by escaping its `.`/`)` — `1\\.` — never its digits.
    """
    lead, token = match.group(1), match.group(2)
    if token[0].isdigit():
        return f"{lead}{token[:-1]}\\{token[-1]}"
    return f"{lead}\\{token}"


def escape_text(text: str, defuse_line_start: bool = True) -> str:
    """Escape Markdown-significant characters in body text.

    ``defuse_line_start`` is off inside headings and table cells, where a
    leading `-` or `1.` cannot open a block and escaping it is pure noise.
    """
    if not text:
        return ""
    out = text.replace("\\", "\\\\")
    out = out.replace("`", "\\`")
    out = out.replace("*", "\\*")
    out = _UNDERSCORE_RE.sub("\\_", out)
    out = out.replace("[", "\\[").replace("]", "\\]")
    # Bare `<` can open raw HTML; `&` can open an entity.
    out = out.replace("<", "&lt;").replace(">", "&gt;")
    if defuse_line_start:
        out = _LINE_START_RE.sub(_escape_line_start, out)
    return out


def escape_cell(text: str) -> str:
    """Escape for inside a table cell: pipes break the row, newlines break the table."""
    out = escape_text(text, defuse_line_start=False)
    out = out.replace("|", "\\|")
    out = re.sub(r"\r?\n", "<br>", out)
    return out


def _code_span(text: str) -> str:
    """Wrap in enough backticks to contain any backtick run inside."""
    longest = max((len(m) for m in re.findall(r"`+", text)), default=0)
    fence = "`" * (longest + 1)
    pad = " " if text.startswith("`") or text.endswith("`") else ""
    return f"{fence}{pad}{text}{pad}{fence}"


def _emphasize(body: str, marker: str) -> str:
    """Apply an emphasis marker, keeping surrounding whitespace outside it.

    GFM will not parse `** text **`, so leading/trailing spaces must be moved
    out of the delimiters.
    """
    stripped = body.strip()
    if not stripped:
        return body
    lead = body[: len(body) - len(body.lstrip())]
    trail = body[len(body.rstrip()) :]
    return f"{lead}{marker}{stripped}{marker}{trail}"


def _unbold(spans: Inlines) -> Inlines:
    """Drop bold runs where the container already renders bold.

    Headings and table header cells are bold by definition; keeping the source
    `**` inside them only adds noise a parser has to strip again.
    """
    return [replace(s, bold=False) for s in spans]


def render_inlines(
    spans: Inlines, in_table: bool = False, defuse_line_start: bool = True
) -> str:
    if in_table:
        esc = escape_cell
    else:
        esc = lambda t: escape_text(t, defuse_line_start)  # noqa: E731
    parts: list[str] = []
    for span in spans:
        if not span.text:
            continue
        if span.code:
            body = _code_span(span.text)
            if in_table:
                body = body.replace("|", "\\|")
        else:
            body = esc(span.text)
            if span.bold and span.italic:
                body = _emphasize(body, "***")
            elif span.bold:
                body = _emphasize(body, "**")
            elif span.italic:
                body = _emphasize(body, "*")
        if span.href:
            href = span.href.replace("(", "%28").replace(")", "%29").replace(" ", "%20")
            body = f"[{body}]({href})"
        parts.append(body)
    return "".join(parts).strip()


def _expand_row(cells: list[Cell], width: int) -> list[str]:
    """Flatten a row to `width` rendered strings, expanding colspans.

    GFM has no colspan, so a merged cell renders its text in the first column
    and leaves the spanned columns empty rather than silently dropping them.
    """
    out: list[str] = []
    for cell in cells:
        out.append(render_inlines(cell.spans, in_table=True))
        out.extend([""] * max(0, cell.colspan - 1))
    if len(out) < width:
        out.extend([""] * (width - len(out)))
    return out[:width]


def _row_width(cells: list[Cell]) -> int:
    return sum(max(1, c.colspan) for c in cells)


def render_table(table: Table) -> str:
    width = max(
        [_row_width(table.header)] + [_row_width(r) for r in table.rows] or [0]
    )
    if width == 0:
        return ""

    header = table.header
    body = table.rows
    if not header:
        # GFM requires a header row; promote the first body row when the
        # source had none, otherwise emit an empty header.
        if body:
            header, body = [Cell(spans=c.spans, colspan=c.colspan) for c in body[0]], body[1:]
        else:
            header = [Cell() for _ in range(width)]

    header = [replace(c, spans=_unbold(c.spans)) for c in header]
    lines = [
        "| " + " | ".join(_expand_row(header, width)) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    for row in body:
        lines.append("| " + " | ".join(_expand_row(row, width)) + " |")

    out = "\n".join(lines)
    if table.caption:
        out = f"{escape_text(table.caption)}\n\n{out}"
    return out


def render_list(block: ListBlock, indent: str = "") -> str:
    chunks: list[str] = []
    for idx, item in enumerate(block.items):
        marker = f"{block.start + idx}. " if block.ordered else "- "
        if item.checked is not None:
            marker += "[x] " if item.checked else "[ ] "
        pad = " " * len(marker)

        rendered = [
            r for r in (render_block(b, indent=indent + pad) for b in item.blocks) if r
        ]
        if not rendered:
            chunks.append(indent + marker.rstrip())
            continue

        first, *rest = rendered
        # The first block sits on the marker line: strip the indent the child
        # already applied and re-attach it after the marker.
        first_lines = first.split("\n")
        head = indent + marker + first_lines[0][len(indent + pad) :]
        tail = first_lines[1:]
        piece = "\n".join([head] + tail)
        for extra in rest:
            piece += "\n\n" + extra
        chunks.append(piece)
    return "\n".join(chunks) if not _has_multiblock(block) else "\n\n".join(chunks)


def _has_multiblock(block: ListBlock) -> bool:
    """Loose list: any item holding more than one block needs blank separators."""
    return any(len(i.blocks) > 1 for i in block.items)


def render_block(block, indent: str = "") -> str:
    def _indent(text: str) -> str:
        if not indent:
            return text
        return "\n".join(indent + ln if ln else ln for ln in text.split("\n"))

    if isinstance(block, Heading):
        text = render_inlines(_unbold(block.spans), defuse_line_start=False)
        if not text:
            return ""
        level = min(6, max(1, block.level))
        return _indent(f"{'#' * level} {text}")

    if isinstance(block, Paragraph):
        text = render_inlines(block.spans)
        return _indent(text) if text else ""

    if isinstance(block, CodeBlock):
        longest = max((len(m) for m in re.findall(r"^`{3,}", block.text, re.M)), default=2)
        fence = "`" * max(3, longest + 1)
        return _indent(f"{fence}{block.lang}\n{block.text.rstrip()}\n{fence}")

    if isinstance(block, ListBlock):
        return render_list(block, indent=indent)

    if isinstance(block, Table):
        return _indent(render_table(block))

    if isinstance(block, Image):
        alt = escape_text(block.alt or "")
        src = block.src or ""
        return _indent(f"![{alt}]({src})" if src else (f"![{alt}]()" if alt else ""))

    if isinstance(block, Blockquote):
        inner = "\n\n".join(r for r in (render_block(b) for b in block.blocks) if r)
        quoted = "\n".join(f"> {ln}" if ln else ">" for ln in inner.split("\n"))
        return _indent(quoted)

    if isinstance(block, Rule):
        return _indent("---")

    if isinstance(block, PageBreak):
        return _indent(f"<!-- page {block.number} -->") if block.number else ""

    if isinstance(block, Footnote):
        inner = "\n\n".join(r for r in (render_block(b) for b in block.blocks) if r)
        first, *rest = inner.split("\n") or [""]
        body = "\n".join([first] + ["    " + ln for ln in rest])
        return _indent(f"[^{block.label}]: {body}")

    return ""


def to_markdown(doc: Document) -> str:
    """Render a Document to GitHub-Flavored Markdown."""
    parts = [r for r in (render_block(b) for b in doc.blocks) if r]
    out = "\n\n".join(parts)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip() + "\n" if out.strip() else ""
