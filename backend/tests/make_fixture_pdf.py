"""
Minimal dependency-free writer for text-layer PDFs, used as test fixtures.

Marker/Surya fixtures are scans; fastdoc's fast path needs the opposite — a
PDF that *does* carry a text layer, with controllable font sizes so heading
inference and column detection can be exercised. reportlab is not in the
dependency tree and is not worth adding just for this, so we emit the handful
of PDF objects required for base-14 Helvetica text directly.

Usage:
    python make_fixture_pdf.py out.pdf
"""

from __future__ import annotations

import sys
from pathlib import Path

# (text, x, y, font_size, bold)
Line = tuple[str, float, float, float, bool]

PAGE_W, PAGE_H = 612, 792  # US Letter, in points


def _escape(text: str) -> str:
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _content_stream(lines: list[Line]) -> bytes:
    parts = ["BT"]
    for text, x, y, size, bold in lines:
        font = "/F2" if bold else "/F1"
        parts.append(f"1 0 0 1 {x:.2f} {y:.2f} Tm")
        parts.append(f"{font} {size:.2f} Tf")
        parts.append(f"({_escape(text)}) Tj")
    parts.append("ET")
    return "\n".join(parts).encode("latin-1")


def build_pdf(pages: list[list[Line]]) -> bytes:
    """Assemble a PDF from per-page lists of positioned text lines."""
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)  # 1-based object number

    font_regular = add(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    )
    font_bold = add(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
    )
    pages_obj = add(b"")  # placeholder, patched once page ids are known

    page_ids: list[int] = []
    for lines in pages:
        stream = _content_stream(lines)
        content_id = add(
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"
        )
        page_id = add(
            f"<< /Type /Page /Parent {pages_obj} 0 R "
            f"/MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            f"/Resources << /Font << /F1 {font_regular} 0 R /F2 {font_bold} 0 R >> >> "
            f"/Contents {content_id} 0 R >>".encode()
        )
        page_ids.append(page_id)

    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects[pages_obj - 1] = (
        f"<< /Type /Pages /Count {len(page_ids)} /Kids [{kids}] >>".encode()
    )
    catalog = add(f"<< /Type /Catalog /Pages {pages_obj} 0 R >>".encode())

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for num, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{num} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root {catalog} 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n"
    ).encode()
    return bytes(out)


def sample_pages() -> list[list[Line]]:
    """A report-shaped fixture: title, headings, body, a bullet list, a table."""
    y = PAGE_H - 72
    lines: list[Line] = []

    def row(text: str, size: float = 10, bold: bool = False, x: float = 72, drop: float = 0):
        nonlocal y
        y -= drop
        lines.append((text, x, y, size, bold))

    row("Quarterly Engineering Report", 22, True, drop=0)
    row("Prepared by the Manufacturing Systems group.", 10, drop=34)
    row("1. Overview", 15, True, drop=30)
    row("Throughput improved across all three lines this quarter, driven", 10, drop=24)
    row("mainly by the revised fixture-change procedure on line B.", 10, drop=14)
    row("Key outcomes:", 10, drop=22)
    row("- Cycle time down 12 percent", 10, x=86, drop=16)
    row("- Scrap rate down to 0.8 percent", 10, x=86, drop=14)
    row("- Two unplanned stoppages, both on line C", 10, x=86, drop=14)
    row("2. Measured results", 15, True, drop=28)

    # A three-column table: consistent x positions are what the column
    # detector keys on.
    cols = (72, 260, 430)
    table = [
        ("Line", "Cycle time (s)", "Scrap (%)"),
        ("A", "41.2", "0.6"),
        ("B", "38.7", "0.9"),
        ("C", "44.0", "1.1"),
    ]
    for i, (c1, c2, c3) in enumerate(table):
        y -= 24 if i == 0 else 16
        bold = i == 0
        lines.append((c1, cols[0], y, 10, bold))
        lines.append((c2, cols[1], y, 10, bold))
        lines.append((c3, cols[2], y, 10, bold))

    page2: list[Line] = []
    y2 = PAGE_H - 72
    page2.append(("3. Next steps", 15, True))
    page2 = [("3. Next steps", 72, y2, 15, True)]
    y2 -= 26
    for text in (
        "Roll the line B procedure out to lines A and C in the next cycle,",
        "and add the vibration sensor package to the line C spindle.",
    ):
        page2.append((text, 72, y2, 10, False))
        y2 -= 14

    return [lines, page2]


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "fixture_text.pdf")
    out.write_bytes(build_pdf(sample_pages()))
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
