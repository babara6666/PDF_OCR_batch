"""
Stage 1 of the pipeline: content-based format detection.

Extensions lie — a `.pdf` that is really a scanned TIFF, or a `.xls` that is
actually CSV, are both common in document corpora. Detection here reads the
bytes: PDF header, RTF open group, ZIP central-directory mimetypes, OLE
compound-file signature, image magic numbers.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Optional

# How many bytes are enough to identify every signature below.
SNIFF_SIZE = 8192

_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

_IMAGE_MAGIC = [
    (b"\xff\xd8\xff", "jpeg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
    (b"BM", "bmp"),
    (b"II*\x00", "tiff"),
    (b"MM\x00*", "tiff"),
]

# OPC part that identifies each OOXML flavour.
_OOXML_MARKERS = [
    ("word/document.xml", "docx"),
    ("xl/workbook.xml", "xlsx"),
    ("ppt/presentation.xml", "pptx"),
]

# ODF stores its type as a plain-text `mimetype` entry.
_ODF_MIMETYPES = {
    "application/vnd.oasis.opendocument.text": "odt",
    "application/vnd.oasis.opendocument.spreadsheet": "ods",
    "application/vnd.oasis.opendocument.presentation": "odp",
}

# OLE storage streams that identify legacy Office binaries.
_OLE_STREAMS = [
    ("WordDocument", "doc"),
    ("Workbook", "xls"),
    ("Book", "xls"),
    ("PowerPoint Document", "ppt"),
]

# Formats fastdoc can convert without any ML model.
TEXT_FORMATS = {"pdf", "docx", "xlsx", "pptx", "csv", "txt", "md"}
IMAGE_FORMATS = {"jpeg", "png", "gif", "bmp", "tiff", "webp"}


def _zip_format(data: bytes, path: Optional[Path]) -> str:
    """Identify a ZIP container: OOXML, ODF, or EPUB."""
    try:
        source = str(path) if path else io.BytesIO(data)
        with zipfile.ZipFile(source) as zf:
            names = set(zf.namelist())
            for marker, fmt in _OOXML_MARKERS:
                if marker in names:
                    return fmt
            if "mimetype" in names:
                mime = zf.read("mimetype").decode("ascii", "ignore").strip()
                if mime in _ODF_MIMETYPES:
                    return _ODF_MIMETYPES[mime]
                if mime == "application/epub+zip":
                    return "epub"
            if "META-INF/container.xml" in names:
                return "epub"
    except (zipfile.BadZipFile, OSError, KeyError):
        pass
    return "zip"


def _ole_format(path: Optional[Path]) -> str:
    """Identify a legacy OLE compound file by its storage stream names."""
    try:
        import olefile  # type: ignore
    except ImportError:
        return "ole"
    if path is None:
        return "ole"
    try:
        with olefile.OleFileIO(str(path)) as ole:
            entries = {"/".join(e) for e in ole.listdir()}
            for stream, fmt in _OLE_STREAMS:
                if stream in entries:
                    return fmt
    except Exception:
        pass
    return "ole"


# Control bytes that never appear in real text (tab/LF/CR excluded).
_CONTROL_BYTES = bytes(range(0x00, 0x09)) + bytes(range(0x0B, 0x0D)) + bytes(
    range(0x0E, 0x20)
)


def _looks_binary(head: bytes) -> bool:
    """Binary payloads decode as UTF-8 by accident — NUL is a valid code point.

    Counting control bytes catches what the decode check misses.
    """
    if b"\x00" in head:
        return True
    control = sum(head.count(bytes([b])) for b in _CONTROL_BYTES)
    return control / max(1, len(head)) > 0.05


def _looks_like_csv(head: bytes) -> bool:
    try:
        text = head.decode("utf-8-sig")
    except UnicodeDecodeError:
        return False
    lines = [ln for ln in text.splitlines()[:10] if ln.strip()]
    if len(lines) < 2:
        return False
    for delim in (",", ";", "\t"):
        counts = [ln.count(delim) for ln in lines]
        if counts[0] >= 1 and len(set(counts)) == 1:
            return True
    return False


def detect_bytes(data: bytes, path: Optional[Path] = None) -> str:
    """Identify a format from its leading bytes. Returns a short format tag."""
    head = data[:SNIFF_SIZE]
    if not head:
        return "empty"

    # PDF header may be preceded by junk in the wild; search the first block.
    if head.startswith(b"%PDF-") or b"%PDF-" in head[:1024]:
        return "pdf"
    if head.startswith(b"{\\rtf"):
        return "rtf"
    if head.startswith(b"PK\x03\x04"):
        return _zip_format(data, path)
    if head.startswith(_OLE_MAGIC):
        return _ole_format(path)
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    for magic, fmt in _IMAGE_MAGIC:
        if head.startswith(magic):
            return fmt
    if _looks_binary(head):
        return "unknown"
    if _looks_like_csv(head):
        return "csv"
    try:
        head.decode("utf-8-sig")
        return "txt"
    except UnicodeDecodeError:
        return "unknown"


def detect_file(path: str | Path) -> str:
    p = Path(path)
    with open(p, "rb") as f:
        head = f.read(SNIFF_SIZE)
    return detect_bytes(head, path=p)
