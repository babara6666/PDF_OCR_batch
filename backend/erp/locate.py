"""Where on the source page a value from the review table is printed.

A reviewer checking a mapped row reads a number in the table, then hunts for
it on the scan. This does the hunting: given the cell's text (and the rest of
its row as context), it returns boxes on the rendered page that the review pane
draws over the image.

Two ways to know where the text is, tried in order per page:

* **The PDF's own text layer.** Digital COAs carry one, and pdfium gives a box
  for every character, so a hit is exact — "15" inside "15 ~ 20 %" is framed
  as those two glyphs, not the whole cell.
* **OCR, for scans.** rapidocr (the same engine the spec-compare tool in
  PDF_DIFF uses to locate numbers it already knows) reads the rendered page
  once. It returns one box per text line; a hit inside a line is narrowed by
  character offset, which is approximate for proportional fonts but lands on
  the right token.

Recognition here is a *finder*, not a reader: the value is already known, and
asking "where is 15?" is a far easier question than "what does this say?".

The index is built lazily, once per page, and cached beside the rendered page
images (``pages/<n>.lines.json``). Nothing depends on it: a page that cannot
be indexed — no text layer and no OCR engine installed — simply yields no
hits, and the reviewer is back to reading the page themselves.

Coordinates are fractions of the page (0–1, top-left origin), so the front end
can place them over an image rendered at any width or zoom.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import unicodedata
from dataclasses import dataclass, field

from . import store

logger = logging.getLogger("printlens.erp.locate")

# Bump when the cached index format or how it is built changes; older caches
# are then rebuilt instead of misread.
INDEX_VERSION = 2

# Below this many printable characters a text layer is a stamp or a page
# number, not the report — the page is a scan and goes to OCR.
MIN_TEXT_CHARS = 20

# Rendered width the OCR reads. Small print on an A4 COA needs about this much;
# larger only makes recognition slower.
OCR_WIDTH = 2000

# A gap wider than this many line-heights between two characters on the same
# text line is a column boundary: the table's cells become separate segments,
# so a text match never runs from one cell into the next.
CELL_GAP = 1.2

# Numbers as COAs print them: 15, 15.0, 1,200, -5, 1.2E-3.
_NUMBER_RE = re.compile(r"[-+]?\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][-+]?\d+)?")

# Hits scoring below this are not offered at all.
MIN_SCORE = 0.6

_ocr_lock = threading.Lock()
_ocr_engine = None
_ocr_missing = False
_build_locks: dict[tuple[str, int], threading.Lock] = {}
_build_locks_guard = threading.Lock()


# ── Normalisation ────────────────────────────────────────────────────────────
def _norm_char(c: str) -> str:
    # NFKC folds full-width digits and ～ into their ASCII forms, which is how
    # half the scans print them; spaces carry no meaning in a cell and OCR
    # inserts or drops them at random.
    out = unicodedata.normalize("NFKC", c).lower()
    return "" if out.isspace() else out.replace(" ", "")


def normalise(text: str) -> tuple[str, list[int]]:
    """The comparison form of ``text``, and for each of its characters the
    index of the original character it came from."""
    chars: list[str] = []
    origin: list[int] = []
    for i, c in enumerate(text):
        for n in _norm_char(c):
            chars.append(n)
            origin.append(i)
    return "".join(chars), origin


def _number(token: str) -> float | None:
    try:
        return float(token.replace(",", ""))
    except ValueError:
        return None


# ── The index ────────────────────────────────────────────────────────────────
@dataclass
class Segment:
    """One run of text on a page: a table cell, or an OCR line."""

    text: str
    box: list[float]  # x0, y0, x1, y1 as page fractions
    chars: list[list[float]] | None = None  # per-character boxes, text layer only

    def span_box(self, start: int, end: int) -> list[float]:
        """The box of original characters ``start`` to ``end`` (exclusive)."""
        if self.chars:
            picked = self.chars[start:end]
            if picked:
                return _union(picked)
        n = max(1, len(self.text))
        x0, y0, x1, y1 = self.box
        if x1 - x0 < y1 - y0:
            # Written sideways: which end the string starts at is not known,
            # and a confident wrong guess is worse than the whole line.
            return list(self.box)
        w = x1 - x0
        pad = 0.04
        lo = max(0.0, start / n - pad)
        hi = min(1.0, end / n + pad)
        return [x0 + w * lo, y0, x0 + w * hi, y1]


@dataclass
class PageIndex:
    page: int
    source: str  # "text" | "ocr" | "none"
    segments: list[Segment] = field(default_factory=list)
    note: str = ""


def _union(boxes: list[list[float]]) -> list[float]:
    return [
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    ]


def _r(v: float) -> float:
    return round(float(v), 5)


def _text_layer(page) -> list[Segment]:
    """Segments from the PDF's own text, with a box per character.

    pdfium reports character boxes in unrotated page space, in points with a
    bottom-left origin. Cells are split there, where "the same line" and "a
    wide gap" mean what they look like; only then are the boxes turned into
    fractions of the page as it renders — after the crop box and the page's
    /Rotate — so they sit on the image the review pane shows.
    """
    textpage = page.get_textpage()
    try:
        n = textpage.count_chars()
        if n <= 0:
            return []
        text = textpage.get_text_range(0, n)
        l, b, r, t = page.get_cropbox()
        W, H = max(1e-6, r - l), max(1e-6, t - b)
        rot = page.get_rotation() % 360

        def to_frac(x0, y0, x1, y1):
            u0, u1 = (x0 - l) / W, (x1 - l) / W
            v0, v1 = 1 - (y1 - b) / H, 1 - (y0 - b) / H
            if rot == 90:
                u0, v0, u1, v1 = 1 - v1, u0, 1 - v0, u1
            elif rot == 180:
                u0, v0, u1, v1 = 1 - u1, 1 - v1, 1 - u0, 1 - v0
            elif rot == 270:
                u0, v0, u1, v1 = v0, 1 - u1, v1, 1 - u0
            return [_r(max(0, u0)), _r(max(0, v0)), _r(min(1, u1)), _r(min(1, v1))]

        segments: list[Segment] = []
        cur_text: list[str] = []
        cur_boxes: list[tuple] = []  # points: left, bottom, right, top

        def flush():
            s = "".join(cur_text)
            if s.strip():
                # Trim the whitespace ends, keeping text and boxes aligned.
                lead = len(s) - len(s.lstrip())
                trail = len(s.rstrip())
                boxes = [to_frac(*bx) for bx in cur_boxes[lead:trail]]
                real = [bx for bx, ch in zip(boxes, s[lead:trail]) if not ch.isspace()]
                segments.append(Segment(s[lead:trail], _union(real), boxes))
            cur_text.clear()
            cur_boxes.clear()

        # get_text_range can hold a few more code units than count_chars when a
        # character is outside the BMP; iterate by index and read each char's
        # own text so the two stay aligned.
        last = None
        for i in range(min(n, len(text))):
            ch = text[i]
            if ch in "\r\n":
                flush()
                last = None
                continue
            # Loose boxes span the font's full height, so "." and "-" get the
            # same vertical extent as the digits beside them — a tight box
            # for a period is a sliver that fails the same-line test below.
            box = textpage.get_charbox(i, loose=True)
            if ch.isspace():
                # pdfium gives generated spaces a zero box; keep the character
                # for offsets but borrow the previous glyph's box.
                if cur_text:
                    cur_text.append(ch)
                    cur_boxes.append(cur_boxes[-1])
                continue
            if last is not None:
                height = max(last[3] - last[1], box[3] - box[1], 1e-3)
                shorter = max(min(last[3] - last[1], box[3] - box[1]), 1e-3)
                same_line = min(last[3], box[3]) - max(last[1], box[1]) > 0.3 * shorter
                gap = box[0] - last[2]
                if not same_line or gap > CELL_GAP * height:
                    flush()
            cur_text.append(ch)
            cur_boxes.append(box)
            last = box
        flush()
        return segments
    finally:
        textpage.close()


def _get_ocr():
    """The OCR engine, loaded once. None when rapidocr is not installed."""
    global _ocr_engine, _ocr_missing
    if _ocr_engine is None and not _ocr_missing:
        try:
            from rapidocr_onnxruntime import RapidOCR

            _ocr_engine = RapidOCR()
        except Exception as e:  # not installed, or its models failed to load
            logger.warning("ERP locate: OCR unavailable (%s); scans cannot be searched", e)
            _ocr_missing = True
    return _ocr_engine


def _ocr_page(page) -> list[Segment] | None:
    """Segments from reading the rendered page. None when there is no OCR."""
    engine = _get_ocr()
    if engine is None:
        return None
    import numpy as np

    scale = OCR_WIDTH / max(1.0, float(page.get_width()))
    image = page.render(scale=scale).to_pil().convert("RGB")
    w, h = image.size
    with _ocr_lock:  # one onnx session, not built for concurrent callers
        result, _ = engine(np.array(image), use_det=True, use_cls=True, use_rec=True)

    segments = []
    for item in result or []:
        poly, text = item[0], str(item[1] or "").strip()
        if not text:
            continue
        p = np.asarray(poly, dtype=float)
        segments.append(
            Segment(
                text,
                [
                    _r(p[:, 0].min() / w),
                    _r(p[:, 1].min() / h),
                    _r(p[:, 0].max() / w),
                    _r(p[:, 1].max() / h),
                ],
            )
        )
    return segments


def _cache_path(job_id: str, page_no: int):
    return store.pages_dir(job_id) / f"{page_no}.lines.json"


def _load_cached(job_id: str, page_no: int) -> PageIndex | None:
    path = _cache_path(job_id, page_no)
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if d.get("v") != INDEX_VERSION:
        return None
    return PageIndex(
        page=page_no,
        source=d["source"],
        segments=[Segment(s["t"], s["b"], s.get("c")) for s in d["segments"]],
        note=d.get("note", ""),
    )


def _save_cached(job_id: str, idx: PageIndex) -> None:
    # An index built without OCR is not cached: installing the engine later
    # should make the scan searchable without anyone clearing a cache.
    if idx.source == "none":
        return
    path = _cache_path(job_id, idx.page)
    tmp = path.with_suffix(".tmp")
    payload = {
        "v": INDEX_VERSION,
        "source": idx.source,
        "note": idx.note,
        "segments": [
            {"t": s.text, "b": s.box, **({"c": s.chars} if s.chars else {})}
            for s in idx.segments
        ],
    }
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def page_index(job_id: str, page_no: int) -> PageIndex:
    """The searchable text of one page, built on first use and cached."""
    cached = _load_cached(job_id, page_no)
    if cached is not None:
        return cached

    with _build_locks_guard:
        lock = _build_locks.setdefault((job_id, page_no), threading.Lock())
    # Two clicks racing on a fresh scan must not OCR it twice.
    with lock:
        cached = _load_cached(job_id, page_no)
        if cached is not None:
            return cached

        path = store.source_path(job_id)
        if path is None:
            return PageIndex(page_no, "none", note="no stored PDF")

        import pypdfium2 as pdfium

        doc = pdfium.PdfDocument(str(path))
        try:
            if not 1 <= page_no <= len(doc):
                return PageIndex(page_no, "none", note="page out of range")
            page = doc[page_no - 1]
            segments = _text_layer(page)
            printable = sum(len(s.text.replace(" ", "")) for s in segments)
            if printable >= MIN_TEXT_CHARS:
                idx = PageIndex(page_no, "text", segments)
            else:
                ocr = _ocr_page(page)
                if ocr is None:
                    idx = PageIndex(page_no, "none", note="scan, and no OCR engine installed")
                else:
                    idx = PageIndex(page_no, "ocr", ocr)
        finally:
            doc.close()

        _save_cached(job_id, idx)
        logger.info(
            "ERP locate: indexed %s p%d from %s (%d segment(s))",
            job_id[:8], page_no, idx.source, len(idx.segments),
        )
        return idx


def job_index(job_id: str) -> list[PageIndex]:
    page_count = store.get_meta(job_id).get("page_count") or 0
    return [page_index(job_id, n) for n in range(1, page_count + 1)]


# ── Matching ─────────────────────────────────────────────────────────────────
@dataclass
class Hit:
    page: int
    box: list[float]
    text: str
    score: float
    context: bool = False  # the row's other cells are printed on the same line
    alone: bool = False  # the segment carries this value and nothing else

    def as_dict(self) -> dict:
        return {
            "page": self.page,
            "box": [_r(v) for v in self.box],
            "text": self.text,
            "score": round(self.score, 3),
            "context": self.context,
        }


def _numeric_spans(q_numbers: list[str], seg_norm: str) -> list[tuple[int, int, float]]:
    """Where a single-number query is written in a segment.

    Matched as whole numbers, never as a substring of one: "15" must not light
    up inside 150, 2015 or 1.5. The printed form scores above the same value
    written differently ("15" against "15.0").
    """
    (q,) = q_numbers
    qv = _number(q)
    out = []
    for m in _NUMBER_RE.finditer(seg_norm):
        tok = m.group()
        # A sign glued to a digit is usually a range dash ("17-19"), so the
        # comparison is by magnitude unless the query itself is signed.
        bare = tok.lstrip("+-") if not q.startswith(("-", "+")) else tok
        start = m.start() + (len(tok) - len(bare))
        if bare == q.lstrip("+") or bare.replace(",", "") == q.replace(",", ""):
            out.append((start, m.end(), 1.0))
        elif qv is not None and (v := _number(bare)) is not None and abs(v - qv) < 1e-9:
            out.append((start, m.end(), 0.9))
    return out


def _text_spans(q_norm: str, seg_norm: str) -> list[tuple[int, int, float]]:
    out = []
    start = seg_norm.find(q_norm)
    while start != -1:
        out.append((start, start + len(q_norm), 1.0))
        start = seg_norm.find(q_norm, start + 1)
    return out


def _fuzzy_span(q_norm: str, seg_norm: str) -> tuple[int, int, float] | None:
    """A near match for text a scan misread by a character or two."""
    # partial_ratio slides the shorter string along the longer one, so a
    # segment shorter than the query would be "found" inside it — a lone "."
    # scores 100 against "30.0~33.0".
    if len(q_norm) < 4 or len(seg_norm) < len(q_norm):
        return None
    try:
        from rapidfuzz import fuzz
    except ImportError:  # pragma: no cover - rapidfuzz ships with the backend
        return None
    al = fuzz.partial_ratio_alignment(q_norm, seg_norm, score_cutoff=85)
    if al is None:
        return None
    return al.dest_start, al.dest_end, 0.6 + 0.3 * (al.score - 85) / 15


def _row_band(seg: Segment, segments: list[Segment]) -> str:
    """Everything printed on the same horizontal line as ``seg``, normalised."""
    y0, y1 = seg.box[1], seg.box[3]
    h = max(1e-4, y1 - y0)
    parts = []
    for other in segments:
        if other is seg:
            continue
        cy = (other.box[1] + other.box[3]) / 2
        if y0 - 0.25 * h <= cy <= y1 + 0.25 * h:
            parts.append(normalise(other.text)[0])
    return "".join(parts)


def _context_on_row(band: str, context: list[str]) -> bool:
    for c in context:
        c_norm = normalise(c)[0]
        if len(c_norm) < 2:
            continue
        if c_norm in band:
            return True
        if len(c_norm) >= 4:
            try:
                from rapidfuzz import fuzz

                if fuzz.partial_ratio(c_norm, band) >= 80:
                    return True
            except ImportError:  # pragma: no cover
                pass
    return False


def find(pages: list[PageIndex], query: str, context: list[str] | None = None,
         limit: int = 20) -> list[Hit]:
    """Every place ``query`` is printed, best first.

    Ranked on three things in order: whether the row's other cells (the test
    item, the spec) are printed on the same line — which is what tells the
    "15" in the viscosity row from the "15" in the date, and outweighs "15"
    matching to the character where "15.0" is written — then how well the text
    matches, then whether the segment carries the value alone rather than
    quoting it inside a longer string.
    """
    q_norm, _ = normalise(query or "")
    if not q_norm:
        return []
    q_numbers = [m.group() for m in _NUMBER_RE.finditer(q_norm)]
    # A bare number is matched as a number; anything with words or several
    # numbers ("40~42%", "Colorless") as text.
    single_number = len(q_numbers) == 1 and q_numbers[0].lstrip("+") == q_norm.rstrip("%").lstrip("+")
    context = [c for c in (context or []) if c and normalise(c)[0] != q_norm]

    hits: list[Hit] = []
    for pg in pages:
        for seg in pg.segments:
            seg_norm, origin = normalise(seg.text)
            if not seg_norm:
                continue
            if single_number:
                spans = _numeric_spans([q_numbers[0]], seg_norm)
            else:
                spans = _text_spans(q_norm, seg_norm)
                if not spans and (f := _fuzzy_span(q_norm, seg_norm)):
                    spans = [f]
            if not spans:
                continue
            band = None
            for start, end, score in spans:
                if score < MIN_SCORE:
                    continue
                o_start = origin[start]
                o_end = origin[end - 1] + 1
                if band is None:
                    band = _row_band(seg, pg.segments)
                on_row = _context_on_row(band + seg_norm, context) if context else False
                hits.append(
                    Hit(
                        page=pg.page,
                        box=seg.span_box(o_start, o_end),
                        text=seg.text,
                        score=score,
                        context=on_row,
                        alone=len(seg_norm) - (end - start) <= 2,
                    )
                )

    hits.sort(key=lambda h: (h.context, h.score, h.alone), reverse=True)
    return hits[:limit]
