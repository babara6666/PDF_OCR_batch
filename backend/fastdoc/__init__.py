"""
fastdoc — a no-model document-to-Markdown fast path, modelled on
firecrawl/anydoc's three-stage design:

    1. detect     content-based format identification (never the extension)
    2. parse      one parser per format family into a shared document model
    3. serialize  a single GFM writer for every format

anydoc itself does no OCR, so this is not a replacement for the Marker
pipeline — it is the cheap path in front of it. `router.triage()` tells the
two apart: files that already carry a text layer convert here in
milliseconds, scans go to OCR.
"""

from .detect import detect_bytes, detect_file
from .model import Document
from .router import Result, convert, triage
from .serialize import to_markdown

__all__ = [
    "Document",
    "Result",
    "convert",
    "detect_bytes",
    "detect_file",
    "to_markdown",
    "triage",
]

__version__ = "0.1.0"
