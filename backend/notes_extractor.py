"""
Notes section extractor for engineering technical drawings.

Pipeline
--------
1. Render the first page of the PDF to a PIL Image.
2. Auto-detect page orientation (landscape vs. portrait).
3. Crop the 'Notes:' text region using orientation-specific template coordinates.
   The crop deliberately excludes stamps and mechanical drawings so those
   graphical elements never interfere with OCR.
4. Run Surya detection + recognition **directly** on the cropped image.
   (The full Marker pipeline is deliberately bypassed: its layout model
   classifies regions that contain stamps / technical drawings as 'Figure'
   blocks and skips OCR on them entirely, returning '![](...jpeg)' output.)

Template parameters (fraction of page size)
-------------------------------------------

  LANDSCAPE (width > height)
  ──────────────────────────
  ┌──────────────────────────────────────────────────────────────────┐
  │ Header rows                                          0 – 12 %   │
  ├────────────────────────┬─────────────────────────────────────────┤
  │                        │ X_MIN(~64%)                            │
  │   Technical drawings   │  Notes:       ← Y_MIN (~12%)           │
  │   (left ~64%)          │  1. Materials                          │
  │                        │  …                  ← Y_MAX (~50%)     │
  │                        │  [stamps excluded]                     │
  ├────────────────────────┴─────────────────────────────────────────┤
  │ Specification table                                 52 – 85 %   │
  └──────────────────────────────────────────────────────────────────┘

  PORTRAIT (height > width)  — same physical page, scanned sideways
  ──────────────────────────
  ┌───────────────────────────────────────────────────┐
  │ Company header  │  Drawing NO. row               │ 0 – 7 %
  ├─────────────────────────────────────────────────  │
  │ X_MIN(~15%)   X_MAX(~67%)  │ spec table cols     │
  │  Notes:    ← Y_MIN(~6%)    │                     │
  │  1. Materials              │                     │
  │  …          ← Y_MAX(~37%) │                     │
  │  ─────────────────────────────────────────────   │
  │  Technical drawing (screw diagram)  — excluded   │
  └───────────────────────────────────────────────────┘
"""

import base64
import io
import os
import re
from pathlib import Path
from typing import Tuple

import pypdfium2 as pdfium
from PIL import Image

# ---------------------------------------------------------------------------
# Template crop parameters — tune per orientation
# ---------------------------------------------------------------------------

# ── Landscape (width > height) ──────────────────────────────────────────────
LAND_X_MIN = 0.62  # Notes left  edge (slightly wider margin than ~64%)
LAND_X_MAX = 0.92  # Notes right edge (~92 % from left)
LAND_Y_MIN = 0.09  # Notes top  — raised from 0.12 to capture headers near the top
LAND_Y_MAX = 0.53  # Notes text bottom — lowered from 0.50 for drawings with more items

# ── Portrait (height > width) ───────────────────────────────────────────────
# Surya OCR (detection+recognition) is used directly, so mechanical drawings
# inside the crop (e.g. screw diagrams) will produce no text detections and
# are harmless — allowing wider Y bounds without OCR contamination.
PORT_X_MIN = 0.12  # Notes left  edge
PORT_X_MAX = 0.55  # Notes right edge — wide enough for long notes lines
PORT_Y_MIN = 0.05  # Notes top  — 0.02 was too high (captured Drawing NO. header row)
PORT_Y_MAX = 0.44  # Notes text bottom

# Render DPI for the crop image sent to OCR.
RENDER_DPI = 150

# If the crop still exceeds this pixel count on either axis, resize down.
MAX_CROP_PIXELS = 1200

# Minimum Surya detection confidence to keep a text-line bbox.
MIN_DET_CONFIDENCE = 0.5


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _render_page(pdf_path: str, page_idx: int, dpi: int) -> Image.Image:
    """Render one PDF page to a PIL Image at *dpi* resolution."""
    doc = pdfium.PdfDocument(str(pdf_path))
    try:
        page = doc[page_idx]
        return page.render(scale=float(dpi) / 72.0).to_pil()
    finally:
        doc.close()


def _detect_orientation(image: Image.Image) -> str:
    """Return 'landscape' if width > height, else 'portrait'."""
    w, h = image.size
    return "landscape" if w > h else "portrait"


def _crop_notes_region(
    page_image: Image.Image,
    x_min: float,
    x_max: float,
    y_min: float,
    y_max: float,
) -> Tuple[Image.Image, Tuple[int, int, int, int]]:
    """
    Crop the Notes text region from a rendered page image.
    Returns ``(cropped_image, (x0, y0, x1, y1))`` in pixels.
    """
    w, h = page_image.size
    x0 = int(w * x_min)
    y0 = int(h * y_min)
    x1 = int(w * x_max)
    y1 = int(h * y_max)
    return page_image.crop((x0, y0, x1, y1)), (x0, y0, x1, y1)


def _limit_size(image: Image.Image, max_pixels: int = MAX_CROP_PIXELS) -> Image.Image:
    """
    Proportionally downscale *image* if either dimension exceeds *max_pixels*.
    Prevents GPU memory issues when the crop is unusually large.
    """
    w, h = image.size
    if w <= max_pixels and h <= max_pixels:
        return image
    scale = min(max_pixels / w, max_pixels / h)
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))
    resample = getattr(Image, "Resampling", Image).LANCZOS
    return image.resize((new_w, new_h), resample)


def _ocr_image_surya(
    crop_image: Image.Image,
    models: dict,
    max_col_frac=None,  # float | None
) -> str:
    """
    Run Surya detection + recognition directly on *crop_image*.

    This deliberately bypasses the full Marker pipeline.  Marker's layout
    model classifies any region that contains stamps or technical drawings as
    a 'Figure' block and skips OCR on it — returning '![](...jpeg)' instead
    of text.  By calling detection + recognition directly we avoid that
    mis-classification entirely.

    Parameters
    ----------
    max_col_frac : optional spatial filter (0–1).  Detected bboxes whose
                   **centre-X** exceeds this fraction of the crop width are
                   discarded before recognition.  Use ~0.70 for portrait crops
                   to exclude spec-table columns that occupy the right portion
                   of the crop without narrowing the crop itself (which would
                   cut Notes lines short on the right).

    Steps
    -----
    1. Call ``detection_model`` to locate text-line bounding boxes.
    2. Filter by confidence AND optional centre-X spatial guard.
    3. Call ``recognition_model`` with the remaining polygons.
    4. Collect and return the recognised text lines joined by newline.
    """
    from surya.common.surya.schema import TaskNames

    det_model = models.get("detection_model")
    rec_model = models.get("recognition_model")

    if det_model is None or rec_model is None:
        raise RuntimeError(
            "'detection_model' or 'recognition_model' missing from models dict. "
            "Make sure create_model_dict() was called before extract_notes_from_pdf()."
        )

    # ── Step 1: detect text lines ──────────────────────────────────────────
    det_results = det_model(images=[crop_image], batch_size=4)
    det_result = det_results[0]

    crop_w = crop_image.size[0]

    # ── Step 2: filter by confidence + optional spatial guard ──────────────
    # Spatial guard: bboxes whose centre-X is in the right (1-max_col_frac)
    # portion of the crop are spec-table columns → skip them.
    polygons = []
    skipped_spatial = 0
    for bbox in det_result.bboxes:
        if bbox.confidence < MIN_DET_CONFIDENCE:
            continue
        if max_col_frac is not None:
            xs = [p[0] for p in bbox.polygon]
            centre_x = sum(xs) / len(xs)
            if centre_x > max_col_frac * crop_w:
                skipped_spatial += 1
                continue
        polygons.append([[int(p[0]), int(p[1])] for p in bbox.polygon])

    # Sort polygons top-to-bottom by their topmost Y coordinate so that the
    # recognition output follows the visual reading order (Notes: → 1 → 2 → …).
    # Surya's own sort_lines can mis-order lines in complex portrait layouts,
    # so we sort here and pass sort_lines=False to preserve our order.
    polygons.sort(key=lambda poly: (min(p[1] for p in poly), min(p[0] for p in poly)))

    spatial_note = (
        f", {skipped_spatial} dropped (centre_x>{max_col_frac:.0%})"
        if max_col_frac is not None
        else ""
    )
    print(
        f"[Notes] Surya detected {len(det_result.bboxes)} boxes → "
        f"{len(polygons)} kept (conf≥{MIN_DET_CONFIDENCE}{spatial_note})"
    )

    if not polygons:
        return ""

    # ── Step 3: recognise text in each detected region ─────────────────────
    rec_results = rec_model(
        images=[crop_image],
        task_names=[TaskNames.ocr_with_boxes],
        polygons=[polygons],
        input_text=[[""] * len(polygons)],
        recognition_batch_size=16,
        sort_lines=False,  # polygons are pre-sorted top-to-bottom; preserve order
        math_mode=True,
        drop_repeated_text=False,
        max_sliding_window=2148,
        max_tokens=2048,
    )

    # ── Step 4: collect non-empty text lines ───────────────────────────────
    lines = []
    if rec_results and rec_results[0].text_lines:
        for line in rec_results[0].text_lines:
            text = line.text.strip()
            if text:
                lines.append(text)

    return "\n".join(lines)


def _to_b64(image: Image.Image) -> str:
    """Encode a PIL Image as a base64 PNG string."""
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _clean_notes_text(text: str) -> str:
    """
    Re-order OCR lines into Notes-friendly reading order.

    Order target:
      1) "Notes:" header
      2) numbered items (1,2,3...) in numeric order
      3) remaining lines (e.g. Chinese translations)

    Also drops obvious non-notes noise such as Drawing NO. rows
    and tiny garbled fragments.
    """
    if not text:
        return ""

    raw_lines = [line.strip() for line in text.splitlines() if line.strip()]

    # 1) Basic cleanup: remove tiny noise and leaked non-notes headers.
    cleaned = []
    for line in raw_lines:
        line = re.sub(r"\s+", " ", line).strip()
        if len(line) < 3:
            continue
        if re.search(r"Drawing\s*N(?:O|o)\.?", line):
            continue
        if re.fullmatch(r"[\W_]+", line):
            continue
        cleaned.append(line)

    # 2) De-duplicate near-identical OCR lines.
    deduped = []
    seen = set()
    for line in cleaned:
        key = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "", line).lower()
        if len(key) < 2:
            continue
        if key in seen:
            continue
        seen.add(key)
        deduped.append(line)

    # 3) Classify lines.
    notes_header = []
    numbered = {}
    english_rest = []
    translation_rest = []

    for line in deduped:
        if re.search(r"\bNotes\s*:", line, re.IGNORECASE):
            notes_header.append("Notes:")
            continue

        # Accept OCR variants: "1.Material", "1) Material", "1 Material"
        # but reject fractions like "5/16: C10B21".
        m = re.match(r"^\s*(\d{1,2})(?!\s*/\s*\d)\s*[\.):]?\s*(.+?)\s*$", line)
        if m:
            idx = int(m.group(1))
            body = m.group(2).strip()
            if body:
                numbered.setdefault(idx, f"{idx}. {body}")
            continue

        # Materials continuation lines (e.g. "5/16: C10B21")
        if re.match(r"^\s*#?\d+\s*/\s*\d+\s*:\s*.+$", line, re.IGNORECASE):
            if 1 in numbered and re.search(r"material", numbered[1], re.IGNORECASE):
                numbered[1] = f"{numbered[1]}\n{line}"
            else:
                english_rest.append(line)
            continue

        if re.match(r"^\s*[（(].+[)）]\s*$", line):
            translation_rest.append(line)
        else:
            english_rest.append(line)

    # 4) If OCR dropped a leading number, try to fill missing indices with
    #    note-like unnumbered English lines.
    if numbered and english_rest:
        note_like = []
        non_note_like = []
        for line in english_rest:
            if re.search(
                r"material|hardness|thread|hydrogen|impact|bending|according|test|head",
                line,
                re.IGNORECASE,
            ):
                note_like.append(line)
            else:
                non_note_like.append(line)

        if note_like:
            used = set(numbered.keys())
            max_scan = max(used) + len(note_like) + 3
            missing = [i for i in range(1, max_scan + 1) if i not in used]
            for line in note_like:
                idx = missing.pop(0) if missing else (max(numbered.keys()) + 1)
                numbered[idx] = f"{idx}. {line}"

        english_rest = non_note_like

    # 5) Attach known Chinese translations to matching English numbered lines.
    attached = {}
    unmatched_translation = []
    map_rules = [
        (("材質",), ("material",)),
        (("表面硬度",), ("surface hardness",)),
        (("心部硬度", "芯部硬度"), ("core hardness",)),
        (("敲擊", "撞擊", "衝擊", "冲击"), ("impact", "head toughness")),
        (("彎", "弯"), ("bending",)),
        (("氫脆", "氢脆"), ("hydrogen", "embrittlement")),
        (("螺紋", "螺纹"), ("thread",)),
    ]

    for line in translation_rest:
        target_idx = None
        for zh_tokens, en_tokens in map_rules:
            if not any(token in line for token in zh_tokens):
                continue
            for idx, eng_line in numbered.items():
                low = eng_line.lower()
                if any(token in low for token in en_tokens):
                    target_idx = idx
                    break
            if target_idx is not None:
                break

        if target_idx is None:
            unmatched_translation.append(line)
        else:
            attached.setdefault(target_idx, []).append(line)

    # 6) Build final order.
    ordered = []
    if notes_header:
        ordered.append("Notes:")

    for idx in sorted(numbered):
        ordered.append(numbered[idx])
        ordered.extend(attached.get(idx, []))

    ordered.extend(english_rest)
    ordered.extend(unmatched_translation)

    return "\n".join(ordered)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def extract_notes_from_pdf(
    pdf_path: str,
    models: dict,
    page_idx: int = 0,
    dpi: int = RENDER_DPI,
    include_crop_image: bool = True,
) -> dict:
    """
    Extract the Notes section from a scanned engineering drawing PDF.

    Steps
    -----
    1. Render the PDF page to a PIL Image at *dpi* resolution.
    2. Auto-detect page orientation (landscape / portrait).
    3. Select the appropriate template crop coordinates.
    4. Crop the Notes text region and resize if needed (GPU memory guard).
    5. Run Surya detection + recognition directly (bypasses Marker layout).
    6. Return the recognised text and an optional base64 PNG of the crop.

    Parameters
    ----------
    pdf_path          : path to the PDF or image file
    models            : pre-loaded model dict from ``create_model_dict()``
    page_idx          : 0-based page index (Notes is usually on page 0)
    dpi               : render resolution (default: RENDER_DPI = 150)
    include_crop_image: if True, include a base64 PNG of the Notes crop

    Returns
    -------
    dict with:
        success        (bool)
        notes_text     (str | None)   — OCR'd text of the Notes section
        crop_bbox      ([x0,y0,x1,y1] in pixels at *dpi* | None)
        orientation    (str)          — "landscape" or "portrait"
        error          (str | None)
        crop_image_b64 (base64 PNG | None)
    """
    # ------------------------------------------------------------------
    # Step 1 — Render the page
    # ------------------------------------------------------------------
    try:
        page_image = _render_page(pdf_path, page_idx, dpi)
    except Exception as exc:
        return {
            "success": False,
            "notes_text": None,
            "crop_bbox": None,
            "orientation": None,
            "error": f"Failed to render page {page_idx}: {exc}",
            "crop_image_b64": None,
        }

    img_w, img_h = page_image.size
    print(f"[Notes] Page rendered: {img_w}×{img_h} px  (dpi={dpi})")

    # ------------------------------------------------------------------
    # Step 2 — Detect orientation & pick crop parameters
    # ------------------------------------------------------------------
    orientation = _detect_orientation(page_image)
    if orientation == "landscape":
        x_min, x_max, y_min, y_max = LAND_X_MIN, LAND_X_MAX, LAND_Y_MIN, LAND_Y_MAX
    else:
        x_min, x_max, y_min, y_max = PORT_X_MIN, PORT_X_MAX, PORT_Y_MIN, PORT_Y_MAX

    print(
        f"[Notes] Orientation: {orientation}  crop=({x_min},{y_min})→({x_max},{y_max})"
    )

    # ------------------------------------------------------------------
    # Step 3 — Crop the Notes text region
    # ------------------------------------------------------------------
    crop, bbox = _crop_notes_region(page_image, x_min, x_max, y_min, y_max)
    print(f"[Notes] Crop bbox: {bbox}  size: {crop.size[0]}×{crop.size[1]} px")

    # ------------------------------------------------------------------
    # Step 4 — Limit crop size to protect GPU VRAM
    # ------------------------------------------------------------------
    crop = _limit_size(crop)
    print(f"[Notes] After size limit: {crop.size[0]}×{crop.size[1]} px")

    # ------------------------------------------------------------------
    # Step 5 — Build crop preview image (always, before OCR)
    #           so it is available even when OCR fails.
    # ------------------------------------------------------------------
    crop_b64 = None
    if include_crop_image:
        try:
            crop_b64 = _to_b64(crop)
            print(f"[Notes] Crop image encoded: {len(crop_b64)} chars")
        except Exception as enc_exc:
            print(f"[Notes] Warning: failed to encode crop image: {enc_exc}")

    # ------------------------------------------------------------------
    # Step 6 — OCR via Surya (detection + recognition, no layout model)
    #
    # Portrait pages use a spatial filter: detected text-line bboxes
    # whose centre-X lies in the rightmost 30 % of the crop are dropped.
    # Those positions correspond to spec-table column headers that sit
    # next to (or just inside) the Notes box border.  Landscape pages
    # don't need this because the spec table is below, not to the right.
    # ------------------------------------------------------------------
    # Portrait: filter out bboxes in the rightmost 20% of the crop (table cols).
    # 0.80 (vs the previous 0.70) gives more room for the last Notes items
    # (e.g. "Ref. to IFI…") which sit near the right side of the Notes box.
    max_col_frac = 0.80 if orientation == "portrait" else None

    try:
        notes_text = _ocr_image_surya(crop, models, max_col_frac=max_col_frac)
    except Exception as exc:
        return {
            "success": False,
            "notes_text": None,
            "crop_bbox": list(bbox),
            "orientation": orientation,
            "error": f"OCR failed: {exc}",
            "crop_image_b64": crop_b64,
        }

    notes_text = _clean_notes_text(notes_text)
    print(f"[Notes] OCR done — {len(notes_text)} chars")

    # ------------------------------------------------------------------
    # Step 7 — Return results
    # ------------------------------------------------------------------
    return {
        "success": True,
        "notes_text": notes_text,
        "crop_bbox": list(bbox),
        "orientation": orientation,
        "error": None,
        "crop_image_b64": crop_b64,
    }
