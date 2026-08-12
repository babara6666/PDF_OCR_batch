"""
Tests for the fastdoc pipeline.

The serializer tests are the important ones: every format renders through it,
so an escaping bug here is a bug in all of them at once.

    python -m pytest backend/tests/test_fastdoc.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import fastdoc  # noqa: E402
from fastdoc.detect import detect_bytes, detect_file  # noqa: E402
from fastdoc.model import (  # noqa: E402
    Blockquote,
    Cell,
    CodeBlock,
    Document,
    Heading,
    ListBlock,
    ListItem,
    Paragraph,
    Span,
    Table,
    text_span,
)
from fastdoc.parsers import pdf as pdf_parser  # noqa: E402
from fastdoc.serialize import escape_cell, escape_text, to_markdown  # noqa: E402

from make_fixture_pdf import build_pdf, sample_pages  # noqa: E402


@pytest.fixture(scope="module")
def text_pdf(tmp_path_factory) -> Path:
    path = tmp_path_factory.mktemp("fastdoc") / "text.pdf"
    path.write_bytes(build_pdf(sample_pages()))
    return path


# --------------------------------------------------------------------------
# serializer
# --------------------------------------------------------------------------


def test_escapes_emphasis_and_brackets():
    out = escape_text("a *b* [c] <d>")
    assert "\\*b\\*" in out
    assert "\\[c\\]" in out
    assert "&lt;d&gt;" in out


def test_leading_list_marker_escapes_punctuation_not_digits():
    # `\1.` is not a valid CommonMark escape; the dot must take the backslash.
    assert escape_text("1. Overview") == "1\\. Overview"
    assert escape_text("- item") == "\\- item"


def test_decimals_and_ranges_are_left_alone():
    assert escape_text("41.2") == "41.2"
    assert escape_text("-5 degrees") == "\\-5 degrees" or escape_text("-5 degrees") == "-5 degrees"
    assert escape_cell("41.2") == "41.2"


def test_intraword_underscore_survives():
    assert escape_text("file_name_here") == "file_name_here"
    assert escape_text("_emphasis_") == "\\_emphasis\\_"


def test_table_cell_escapes_pipes_and_newlines():
    out = escape_cell("a|b\nc")
    assert "\\|" in out
    assert "<br>" in out
    assert "\n" not in out


def test_table_renders_gfm_with_separator():
    table = Table(
        header=[Cell(text_span("A")), Cell(text_span("B"))],
        rows=[[Cell(text_span("1")), Cell(text_span("2"))]],
    )
    md = to_markdown(Document(blocks=[table]))
    lines = md.strip().split("\n")
    assert lines[0] == "| A | B |"
    assert lines[1] == "| --- | --- |"
    assert lines[2] == "| 1 | 2 |"


def test_colspan_expands_to_empty_columns():
    table = Table(
        header=[Cell(text_span("wide"), colspan=2), Cell(text_span("C"))],
        rows=[[Cell(text_span("1")), Cell(text_span("2")), Cell(text_span("3"))]],
    )
    md = to_markdown(Document(blocks=[table]))
    assert md.split("\n")[0] == "| wide |  | C |"


def test_headerless_table_promotes_first_row():
    table = Table(rows=[[Cell(text_span("x"))], [Cell(text_span("y"))]])
    md = to_markdown(Document(blocks=[table]))
    assert md.split("\n")[0] == "| x |"
    assert "| y |" in md


def test_ragged_rows_are_padded_to_full_width():
    table = Table(
        header=[Cell(text_span("A")), Cell(text_span("B"))],
        rows=[[Cell(text_span("1"))]],
    )
    md = to_markdown(Document(blocks=[table]))
    assert md.strip().split("\n")[-1] == "| 1 |  |"


def test_heading_drops_redundant_bold():
    md = to_markdown(Document(blocks=[Heading(2, [Span("Title", bold=True)])]))
    assert md.strip() == "## Title"


def test_emphasis_keeps_whitespace_outside_markers():
    # The trailing space belongs outside the markers: `**bold ** tail` would
    # not parse as emphasis at all.
    md = to_markdown(Document(blocks=[Paragraph([Span("bold ", bold=True), Span("tail")])]))
    assert md.strip() == "**bold** tail"


def test_code_span_widens_fence_around_backticks():
    md = to_markdown(Document(blocks=[Paragraph([Span("a`b", code=True)])]))
    assert "``a`b``" in md


def test_code_block_fence_outgrows_content():
    md = to_markdown(Document(blocks=[CodeBlock("```\ninner\n```", lang="py")])).strip()
    assert md.startswith("````py")
    assert md.endswith("````")


def test_nested_list_indents_under_parent():
    inner = ListBlock(items=[ListItem(blocks=[Paragraph(text_span("child"))])])
    outer = ListBlock(
        items=[ListItem(blocks=[Paragraph(text_span("parent")), inner])]
    )
    md = to_markdown(Document(blocks=[outer]))
    assert "- parent" in md
    assert "\n  - child" in md


def test_ordered_list_numbers_from_start():
    block = ListBlock(
        ordered=True,
        start=3,
        items=[ListItem(blocks=[Paragraph(text_span(t))]) for t in ("a", "b")],
    )
    md = to_markdown(Document(blocks=[block]))
    assert "3. a" in md and "4. b" in md


def test_task_list_checkbox():
    block = ListBlock(
        items=[ListItem(blocks=[Paragraph(text_span("done"))], checked=True)]
    )
    assert "- [x] done" in to_markdown(Document(blocks=[block]))


def test_blockquote_prefixes_every_line():
    md = to_markdown(
        Document(blocks=[Blockquote(blocks=[Paragraph(text_span("a")), Paragraph(text_span("b"))])])
    )
    assert "> a" in md and "> b" in md


def test_link_encodes_parentheses_in_href():
    md = to_markdown(
        Document(blocks=[Paragraph([Span("x", href="http://e.com/a(b)")])])
    )
    assert "%28b%29" in md


def test_empty_document_renders_empty():
    assert to_markdown(Document()) == ""


# --------------------------------------------------------------------------
# detection
# --------------------------------------------------------------------------


def test_detects_pdf_by_header_not_extension(text_pdf, tmp_path):
    disguised = tmp_path / "actually_a_pdf.png"
    disguised.write_bytes(text_pdf.read_bytes())
    assert detect_file(disguised) == "pdf"


def test_detects_image_and_rtf_signatures():
    assert detect_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32) == "png"
    assert detect_bytes(b"\xff\xd8\xff\xe0" + b"\x00" * 32) == "jpeg"
    assert detect_bytes(rb"{\rtf1\ansi") == "rtf"


def test_detects_csv_by_consistent_delimiter():
    assert detect_bytes(b"a,b,c\n1,2,3\n4,5,6\n") == "csv"
    assert detect_bytes(b"just some prose\nwith no delimiters\n") == "txt"


def test_empty_input_is_not_a_format():
    assert detect_bytes(b"") == "empty"


# --------------------------------------------------------------------------
# pdf fast path
# --------------------------------------------------------------------------


def test_text_pdf_converts_with_structure(text_pdf):
    result = fastdoc.convert(text_pdf)
    assert result.ok and not result.needs_ocr
    md = result.markdown
    assert "# Quarterly Engineering Report" in md
    assert "## 1. Overview" in md
    assert "- Cycle time down 12 percent" in md
    # The three-column block must come out as a table, not run-together text.
    assert "| Line | Cycle time (s) | Scrap (%) |" in md
    assert "| A | 41.2 | 0.6 |" in md


def test_wrapped_lines_join_into_one_paragraph(text_pdf):
    md = fastdoc.convert(text_pdf).markdown
    assert "this quarter, driven mainly by the revised" in md


def test_probe_flags_a_pdf_with_no_text_layer(tmp_path):
    blank = tmp_path / "blank.pdf"
    blank.write_bytes(build_pdf([[]]))
    result = fastdoc.triage(blank)
    assert result.needs_ocr
    assert "text" in result.reason


def test_convert_refuses_scanned_pdf_unless_forced(tmp_path):
    blank = tmp_path / "blank.pdf"
    blank.write_bytes(build_pdf([[]]))
    assert not fastdoc.convert(blank).ok
    assert fastdoc.convert(blank, force=True).ok


def test_probe_reports_usable_text_layer(text_pdf):
    probe = pdf_parser.probe(pdf_parser.read_pages(text_pdf))
    assert not probe.needs_ocr
    assert probe.pages == 2
    assert probe.text_page_ratio == 1.0


def test_images_are_routed_to_ocr(tmp_path):
    png = tmp_path / "scan.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
    result = fastdoc.triage(png)
    assert result.needs_ocr and result.format == "png"


def test_page_breaks_are_opt_in(text_pdf):
    assert "<!-- page 2 -->" not in fastdoc.convert(text_pdf).markdown
    assert "<!-- page 2 -->" in fastdoc.convert(text_pdf, page_breaks=True).markdown


# --------------------------------------------------------------------------
# office formats
# --------------------------------------------------------------------------


def test_csv_becomes_a_table(tmp_path):
    csv_path = tmp_path / "data.csv"
    csv_path.write_text("name,qty\nbolt,12\nnut,30\n", encoding="utf-8")
    result = fastdoc.convert(csv_path)
    assert result.ok
    assert "| name | qty |" in result.markdown
    assert "| bolt | 12 |" in result.markdown


def test_csv_cell_containing_a_pipe_stays_in_its_column(tmp_path):
    csv_path = tmp_path / "piped.csv"
    csv_path.write_text('a,b\n"x|y",2\n', encoding="utf-8")
    md = fastdoc.convert(csv_path).markdown
    row = [ln for ln in md.split("\n") if "x" in ln][0]
    assert row.count("|") == 3 + 1  # 3 delimiters plus the escaped one


def test_docx_headings_lists_and_tables(tmp_path):
    docx = pytest.importorskip("docx")
    path = tmp_path / "doc.docx"
    document = docx.Document()
    document.add_heading("Report", level=1)
    document.add_paragraph("Body text.")
    document.add_paragraph("first", style="List Bullet")
    document.add_paragraph("second", style="List Bullet")
    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "h1"
    table.cell(0, 1).text = "h2"
    table.cell(1, 0).text = "v1"
    table.cell(1, 1).text = "v2"
    document.save(str(path))

    assert detect_file(path) == "docx"
    md = fastdoc.convert(path).markdown
    assert "# Report" in md
    assert "Body text." in md
    assert "- first" in md and "- second" in md
    assert "| h1 | h2 |" in md and "| v1 | v2 |" in md


def test_xlsx_sheet_becomes_heading_plus_table(tmp_path):
    openpyxl = pytest.importorskip("openpyxl")
    path = tmp_path / "book.xlsx"
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Runs"
    sheet.append(["line", "cycle"])
    sheet.append(["A", 41.2])
    workbook.save(str(path))

    assert detect_file(path) == "xlsx"
    md = fastdoc.convert(path).markdown
    assert "## Runs" in md
    assert "| line | cycle |" in md
    assert "| A | 41.2 |" in md


def test_pptx_slide_title_and_bullets(tmp_path):
    pptx = pytest.importorskip("pptx")
    path = tmp_path / "deck.pptx"
    prs = pptx.Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "Agenda"
    body = slide.placeholders[1].text_frame
    body.text = "point one"
    body.add_paragraph().text = "point two"
    prs.save(str(path))

    assert detect_file(path) == "pptx"
    md = fastdoc.convert(path).markdown
    assert "## Agenda" in md
    assert "point one" in md and "point two" in md


def test_unsupported_format_reports_cleanly(tmp_path):
    path = tmp_path / "thing.bin"
    path.write_bytes(b"\x7fELF\x02\x01\x01" + b"\x00" * 64)
    result = fastdoc.convert(path)
    assert not result.ok and result.error
