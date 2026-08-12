"""
Unified document model — stage 2 output of the fastdoc pipeline.

Every parser (pdf, docx, xlsx, pptx, csv, ...) produces this same tree, and
the single GFM serializer in ``serialize.py`` renders all of them. That is the
core of the anydoc design: a table-escaping fix made once in the serializer is
automatically a fix for every input format.

Blocks nest (list items and blockquotes hold blocks); inline formatting is a
flat list of Spans, which is enough for GFM and keeps parsers simple.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Union


@dataclass
class Span:
    """A run of text with uniform inline formatting."""

    text: str
    bold: bool = False
    italic: bool = False
    code: bool = False
    href: Optional[str] = None


Inlines = list[Span]


def text_span(text: str) -> Inlines:
    """Convenience for the common single-unformatted-run case."""
    return [Span(text)]


def spans_to_text(spans: Inlines) -> str:
    """Raw text of an inline sequence, ignoring formatting."""
    return "".join(s.text for s in spans)


@dataclass
class Heading:
    level: int  # 1-6
    spans: Inlines


@dataclass
class Paragraph:
    spans: Inlines


@dataclass
class CodeBlock:
    text: str
    lang: str = ""


@dataclass
class ListItem:
    blocks: list["Block"] = field(default_factory=list)
    # None = plain item, True/False = GFM task-list checkbox
    checked: Optional[bool] = None


@dataclass
class ListBlock:
    ordered: bool = False
    items: list[ListItem] = field(default_factory=list)
    start: int = 1


@dataclass
class Cell:
    spans: Inlines = field(default_factory=list)
    colspan: int = 1
    rowspan: int = 1


@dataclass
class Table:
    header: list[Cell] = field(default_factory=list)
    rows: list[list[Cell]] = field(default_factory=list)
    caption: str = ""


@dataclass
class Image:
    alt: str = ""
    src: str = ""


@dataclass
class Blockquote:
    blocks: list["Block"] = field(default_factory=list)


@dataclass
class Rule:
    pass


@dataclass
class PageBreak:
    """Soft page boundary. Rendered as a comment, or dropped."""

    number: int = 0


@dataclass
class Footnote:
    label: str
    blocks: list["Block"] = field(default_factory=list)


Block = Union[
    Heading,
    Paragraph,
    CodeBlock,
    ListBlock,
    Table,
    Image,
    Blockquote,
    Rule,
    PageBreak,
    Footnote,
]


@dataclass
class Document:
    blocks: list[Block] = field(default_factory=list)
    meta: dict = field(default_factory=dict)
    # Non-fatal problems: a sheet that failed, a dropped embedded object, ...
    warnings: list[str] = field(default_factory=list)

    def add(self, block: Block) -> None:
        self.blocks.append(block)
