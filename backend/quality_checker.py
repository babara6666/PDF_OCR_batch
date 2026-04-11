"""
Pre-OCR document quality checker for Full OCR mode.

Checks sharpness, brightness, and contrast before running expensive OCR.
Uses only Pillow + numpy + scipy (all already in the dependency tree).
"""

import numpy as np
from PIL import Image

# --- Thresholds (tune based on your document corpus) ---
# Gradient kurtosis: measures how "peaked" the edge distribution is.
# Sharp printed documents have concentrated, high-contrast edges → high kurtosis.
# Blurry/noisy scans have diffuse gradients → low kurtosis.
# Higher = sharper. Below threshold = poor quality.
SHARPNESS_THRESHOLD = 2.0   # kurtosis; below = blurry or noisy scan
MIN_BRIGHTNESS = 25.0       # Mean pixel value; below = too dark
MAX_BRIGHTNESS = 245.0      # Mean pixel value; above = overexposed
MIN_CONTRAST = 15.0         # Std dev of pixel values; below = low contrast

# PDF rendering DPI for quality check (lower than OCR DPI is fine)
PDF_CHECK_DPI = 100


def _gradient_kurtosis(gray: np.ndarray) -> float:
    """Kurtosis of the gradient magnitude distribution.

    Sharp documents have peaked distributions (few strong edges, flat background).
    Blurry/noisy scans have flatter distributions (gradients spread everywhere).
    Higher = sharper. Robust to content density differences between documents.
    """
    from scipy.ndimage import sobel, gaussian_filter
    from scipy.stats import kurtosis

    smoothed = gaussian_filter(gray, sigma=1.0)
    sx = sobel(smoothed, axis=0)
    sy = sobel(smoothed, axis=1)
    grad_mag = np.sqrt(sx ** 2 + sy ** 2).ravel()
    return float(kurtosis(grad_mag))


def _load_image(file_path: str, file_type: str) -> Image.Image:
    """Load image from file. For PDFs, render the first page."""
    if file_type == "pdf":
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(file_path)
        page = pdf[0]
        scale = PDF_CHECK_DPI / 72.0
        bitmap = page.render(scale=scale, rotation=0)
        img = bitmap.to_pil()
        pdf.close()
        return img
    else:
        return Image.open(file_path).convert("RGB")


def check_document_quality(
    file_path: str,
    file_type: str,
    sharpness_threshold: float = SHARPNESS_THRESHOLD,
    min_brightness: float = MIN_BRIGHTNESS,
    max_brightness: float = MAX_BRIGHTNESS,
    min_contrast: float = MIN_CONTRAST,
) -> dict:
    """
    Run pre-OCR quality checks on a document.

    Returns:
        {
            "passed": bool,
            "blur_score": float,    # Gradient kurtosis — higher = sharper
            "brightness": float,    # 0–255 mean pixel value
            "contrast": float,      # Std dev of pixel values
            "reason": str,          # Empty string if passed
        }
    """
    result = {
        "passed": True,
        "blur_score": 0.0,
        "brightness": 0.0,
        "contrast": 0.0,
        "reason": "",
    }

    try:
        img = _load_image(file_path, file_type)
        gray = np.array(img.convert("L"), dtype=np.float32)

        sharpness = _gradient_kurtosis(gray)
        brightness = float(np.mean(gray))
        contrast = float(np.std(gray))

        result["blur_score"] = round(sharpness, 2)
        result["brightness"] = round(brightness, 2)
        result["contrast"] = round(contrast, 2)

        reasons = []
        if sharpness < sharpness_threshold:
            reasons.append(f"poor sharpness (score={sharpness:.2f}, threshold={sharpness_threshold})")
        if brightness < min_brightness:
            reasons.append(f"image too dark (brightness={brightness:.1f})")
        if brightness > max_brightness:
            reasons.append(f"image overexposed (brightness={brightness:.1f})")
        if contrast < min_contrast:
            reasons.append(f"low contrast (contrast={contrast:.1f})")

        if reasons:
            result["passed"] = False
            result["reason"] = "Quality check failed: " + "; ".join(reasons)

    except Exception as e:
        # Quality check failure should not block processing — log and pass
        print(f"  ⚠ Quality check error (skipped): {e}")

    return result
