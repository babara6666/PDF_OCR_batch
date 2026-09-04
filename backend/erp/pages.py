"""Renders a job's stored PDF to page images for the review pane.

**Why images rather than the PDF itself.** The app ships a hardened policy —
`frame-ancestors 'none'` plus `object-src 'none'`, set in both
`backend/main.py` and `nginx.conf` — so an `<iframe>`, `<embed>` or `<object>`
holding a PDF is blocked by the browser even same-origin. `img-src 'self'` is
already open, so a rendered page reaches an `<img>` without weakening a header
a security audit deliberately set. It also suits the job: most of these COAs
are scans, i.e. already images, and a page-at-a-time view is what a reviewer
comparing a table row against the source actually needs.

Rendering goes through pypdfium2, the same binding `backend/notes_extractor.py`
already uses. Pages are written to the job's `pages/` directory on first
request and served from there afterwards — a reviewer scrolls back over the
same page many times, and re-rasterising it each time is pure waste.
"""
from __future__ import annotations

import logging

from . import store

logger = logging.getLogger("printlens.erp.pages")

# Rendered width in pixels. 1400 is enough to read the small print on a
# typical A4 COA at 100% zoom without making the PNG heavier than the scan it
# came from; the front end asks for a larger one when the user zooms in.
DEFAULT_WIDTH = 1400
MIN_WIDTH = 400
MAX_WIDTH = 3000


class PageError(RuntimeError):
    """The PDF could not be read or the page does not exist."""


def count_pages(data: bytes) -> int:
    """Pages in a PDF held in memory. 0 when it cannot be opened at all.

    Called on upload, so it must not raise: a PDF this refuses to parse is
    still worth storing — the markdown beside it is what the mapper reads, and
    the review pane simply falls back to that.
    """
    try:
        import pypdfium2 as pdfium

        doc = pdfium.PdfDocument(data)
        try:
            return len(doc)
        finally:
            doc.close()
    except Exception as e:  # a corrupt or encrypted file is a normal case here
        logger.info("ERP: cannot count pages (%s)", e)
        return 0


def render(job_id: str, page_no: int, width: int = DEFAULT_WIDTH) -> bytes:
    """PNG bytes for a 1-indexed page, rendered once and then cached.

    The width is part of the cache name so the zoomed-in copy does not
    overwrite the one the page list is showing.
    """
    width = max(MIN_WIDTH, min(MAX_WIDTH, int(width)))
    if page_no < 1:
        raise PageError(f"page {page_no} is out of range")

    cached = store.pages_dir(job_id) / f"{page_no}@{width}.png"
    if cached.exists():
        return cached.read_bytes()

    path = store.source_path(job_id)
    if path is None:
        raise PageError("this job has no stored PDF")

    try:
        import pypdfium2 as pdfium

        doc = pdfium.PdfDocument(str(path))
        try:
            if page_no > len(doc):
                raise PageError(f"page {page_no} is out of range (1–{len(doc)})")
            page = doc[page_no - 1]
            # get_width() is in points; scale is relative to that 72-dpi space,
            # so this lands the render on the requested pixel width whatever
            # the page size is — A4, Letter and the odd A3 fold-out alike.
            scale = width / max(1.0, float(page.get_width()))
            image = page.render(scale=scale).to_pil()
        finally:
            doc.close()
    except PageError:
        raise
    except Exception as e:
        raise PageError(f"cannot render this PDF ({e})") from e

    image.convert("RGB").save(cached, format="PNG", optimize=True)
    return cached.read_bytes()
