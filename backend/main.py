"""
FastAPI Backend for PDF/Image OCR using Marker
Provides CAD_OCR-compatible API interface
"""

import os
import uuid
from typing import List
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
import torch
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import filetype

# Load environment variables
load_dotenv()

# Marker imports — must come after load_dotenv() so env vars are set first
from marker.converters.pdf import PdfConverter  # noqa: E402
from marker.models import create_model_dict  # noqa: E402
from marker.output import text_from_rendered  # noqa: E402

from quality_checker import check_document_quality  # noqa: E402
from yolo_detector import YOLONotesDetector  # noqa: E402

import fastdoc  # noqa: E402
from fastdoc.detect import detect_bytes  # noqa: E402
from fastdoc.router import SUPPORTED as FASTDOC_FORMATS  # noqa: E402

# Configuration
API_TITLE = "PDF/Image OCR Service (Marker + YOLO Notes)"
API_VERSION = "1.2.0"
API_DESCRIPTION = (
    "PDF and Image to Markdown conversion using Marker, "
    "with YOLO-based Notes region detection"
)

# Default YOLO Notes model path — override via env var YOLO_MODEL_PATH.
# Lives at <project_root>/models/notes_best.pt (backend/ is one level down).
DEFAULT_YOLO_MODEL = Path(__file__).parent.parent / "models" / "notes_best.pt"

# CORS Origins - read from env or use defaults
CORS_ORIGINS_ENV = os.getenv("CORS_ORIGINS", "")
if CORS_ORIGINS_ENV:
    CORS_ORIGINS = [origin.strip() for origin in CORS_ORIGINS_ENV.split(",")]
else:
    CORS_ORIGINS = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ]

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
PER_FILE_TIMEOUT = 600  # 10 minutes max per file

# Supported file types
ALLOWED_EXTENSIONS = {
    # PDF
    ".pdf",
    # Images
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".tiff",
    ".tif",
}

# Magic-bytes MIME prefixes accepted for each category
ALLOWED_MIMES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/tiff",
}

# Fast path (fastdoc): PDFs that already carry a text layer, and structured
# office formats, convert with no model at all. Marker still handles every
# scan. Off by default so existing behaviour is unchanged until you opt in.
FASTDOC_ROUTING = os.getenv("FASTDOC_ROUTING", "0").strip().lower() in {"1", "true", "yes", "on"}

# Extensions the fast-path endpoints accept. Wider than ALLOWED_EXTENSIONS
# because these formats need no OCR — but the real check is on content.
FASTDOC_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".pptx", ".csv", ".txt"}

# Maximum number of files allowed in a single batch request (0 = unlimited).
# Bounded by default to prevent unbounded work per request; override via env.
MAX_BATCH_FILES = int(os.getenv("MAX_BATCH_FILES", "50"))

# Global state
app_data = {}


class OCRResponse(BaseModel):
    success: bool
    filename: str = ""
    markdown_content: str = ""
    file_size: int = 0
    processing_time: float = 0.0
    file_type: str = ""
    error: str = ""
    blur_score: float = 0.0
    brightness: float = 0.0
    contrast: float = 0.0
    # Which pipeline produced the markdown: "marker" (OCR) or "fastdoc".
    engine: str = "marker"


def get_file_extension(filename: str) -> str:
    """Get lowercase file extension"""
    return Path(filename).suffix.lower()


def unique_upload_path(filename: str) -> Path:
    """
    Build a collision-free on-disk path for an upload.

    Uses a random UUID as the on-disk name (keeping only the validated
    extension) so concurrent requests uploading files with the same name
    cannot overwrite each other's data or delete a file mid-processing.
    The user's original filename is still returned to the client for display.
    """
    return UPLOAD_DIR / f"{uuid.uuid4().hex}{get_file_extension(filename)}"


def is_allowed_file(filename: str) -> bool:
    """Check if file extension is allowed"""
    return get_file_extension(filename) in ALLOWED_EXTENSIONS


def validate_file_content(content: bytes) -> bool:
    """Validate file by magic bytes, not just extension."""
    kind = filetype.guess(content)
    if kind is None:
        return False
    return kind.mime in ALLOWED_MIMES


def get_file_type(filename: str) -> str:
    """Get file type category"""
    ext = get_file_extension(filename)
    if ext == ".pdf":
        return "pdf"
    return "image"


def try_fast_path(file_path: Path):
    """Convert without a model, or return None to fall through to Marker.

    Returns a `fastdoc.Result` only when the file genuinely carried its own
    text. Scans, images, and anything the fast path chokes on return None so
    the OCR pipeline stays the default — this can only save work, never
    silently degrade output.
    """
    if not FASTDOC_ROUTING:
        return None
    try:
        result = fastdoc.convert(str(file_path))
    except Exception as exc:
        print(f"  ⚠ Fast path error, falling back to OCR: {exc}")
        return None
    if not result.ok:
        print(f"  → OCR required: {result.reason or result.error}")
        return None
    print(
        f"  ⚡ Fast path [{result.format}] in {result.elapsed_ms:.0f}ms — no GPU used"
    )
    return result


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add basic security headers to every response."""

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-XSS-Protection"] = "0"  # Modern browsers use CSP instead
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - load models on startup"""
    print("\n" + "=" * 60)
    print(f"🚀 Starting {API_TITLE}")
    print("=" * 60)

    # Detect device
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cuda":
        print(f"✓ CUDA available - Using GPU: {torch.cuda.get_device_name(0)}")
    else:
        print("⚠ CUDA not available - Using CPU")

    # Load models
    try:
        print("\n📦 Loading Marker models...")
        print("This may take a few minutes on first run (downloading ~2-3GB)...")
        app_data["models"] = create_model_dict()
        app_data["device"] = device
        print("✓ Models loaded successfully\n")
    except Exception as e:
        print(f"⚠ Warning: Failed to load models: {e}")
        print("Models will be loaded on first request\n")

    # Load YOLO Notes detector (optional — degrade gracefully to template crop)
    yolo_model_path = Path(os.getenv("YOLO_MODEL_PATH", str(DEFAULT_YOLO_MODEL)))
    detector = YOLONotesDetector()
    if yolo_model_path.exists():
        try:
            detector.load(yolo_model_path)
            print(f"✓ YOLO Notes detector loaded: {yolo_model_path.name}\n")
        except Exception as yolo_err:
            print(f"⚠ Warning: Failed to load YOLO model: {yolo_err}")
            print("  Notes extraction will use template-based cropping.\n")
    else:
        print(
            f"⚠ YOLO model not found at {yolo_model_path}\n"
            "  Notes extraction will use template-based cropping "
            "(set YOLO_MODEL_PATH to enable YOLO detection).\n"
        )
    app_data["yolo_detector"] = detector

    yield

    # Cleanup
    print("\n🛑 Shutting down...")
    if "models" in app_data:
        del app_data["models"]
    app_data.pop("yolo_detector", None)
    if device == "cuda":
        torch.cuda.empty_cache()


app = FastAPI(
    title=API_TITLE,
    version=API_VERSION,
    description=API_DESCRIPTION,
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Accept"],
)

# Security headers
app.add_middleware(SecurityHeadersMiddleware)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"Unhandled exception on {request.url.path}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": "Internal server error"},
    )


@app.get("/")
async def root():
    detector: YOLONotesDetector = app_data.get("yolo_detector")
    return {
        "name": API_TITLE,
        "version": API_VERSION,
        "supported_formats": list(ALLOWED_EXTENSIONS),
        "fastdoc_formats": sorted(FASTDOC_EXTENSIONS),
        "fastdoc_routing": FASTDOC_ROUTING,
        "yolo_notes_detector": bool(detector and detector.is_loaded),
        "endpoints": {
            "upload": "/api/upload",
            "upload_batch": "/api/upload-batch",
            "convert_fast": "/api/convert-fast",
            "triage_batch": "/api/triage-batch",
            "extract_notes": "/api/extract-notes",
            "extract_notes_batch": "/api/extract-notes-batch",
            "yolo_status": "/api/yolo-status",
            "health": "/api/health",
        },
    }


@app.get("/api/health")
async def health_check():
    detector: YOLONotesDetector = app_data.get("yolo_detector")
    return {
        "status": "healthy",
        "model_loaded": "models" in app_data,
        "device": app_data.get("device", "unknown"),
        "yolo_notes_detector": bool(detector and detector.is_loaded),
        "fastdoc_routing": FASTDOC_ROUTING,
        "supported_formats": list(ALLOWED_EXTENSIONS),
    }


@app.get("/api/yolo-status")
async def yolo_status():
    """Report whether the YOLO Notes detector is active (else template fallback)."""
    detector: YOLONotesDetector = app_data.get("yolo_detector")
    yolo_model_path = Path(os.getenv("YOLO_MODEL_PATH", str(DEFAULT_YOLO_MODEL)))
    loaded = bool(detector and detector.is_loaded)
    return {
        "loaded": loaded,
        "model_path": str(yolo_model_path),
        "model_exists": yolo_model_path.exists(),
        "message": (
            "YOLO model active — Notes region detected automatically."
            if loaded
            else "YOLO model not loaded — using template-based fallback."
        ),
    }


@app.post("/api/upload", response_model=OCRResponse)
async def upload_and_process_file(
    file: UploadFile = File(..., description="PDF or Image file to process"),
):
    """Upload PDF or Image and convert to Markdown using Marker"""
    file_path = None
    start_time = time.time()

    try:
        # Validate file type
        if not is_allowed_file(file.filename):
            allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
            raise HTTPException(
                status_code=400, detail=f"Unsupported file type. Allowed: {allowed}"
            )

        file_type = get_file_type(file.filename)

        # Read file content
        content = await file.read()
        file_size = len(content)

        if file_size > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 50MB)")

        # Validate file content by magic bytes
        if not validate_file_content(content):
            raise HTTPException(
                status_code=400, detail="File content does not match a supported type"
            )

        # Sanitize filename to prevent path traversal
        file_path = unique_upload_path(file.filename)
        with open(file_path, "wb") as f:
            f.write(content)

        print(f"\n{'=' * 60}")
        print(
            f"Processing [{file_type.upper()}]: {file.filename} ({file_size / 1024:.1f} KB)"
        )
        print(f"{'=' * 60}")

        # Fast path first: a PDF with its own text layer needs neither the
        # image quality check (there is no image to score) nor the GPU.
        fast = try_fast_path(file_path)
        if fast is not None:
            processing_time = time.time() - start_time
            print(f"✓ Processing complete in {processing_time:.2f}s (fastdoc)\n")
            return OCRResponse(
                success=True,
                filename=file.filename,
                markdown_content=fast.markdown,
                file_size=file_size,
                processing_time=processing_time,
                file_type=file_type,
                engine="fastdoc",
            )

        # Pre-OCR quality check
        quality = check_document_quality(str(file_path), file_type)
        print(f"  Quality — blur={quality['blur_score']} brightness={quality['brightness']} contrast={quality['contrast']}")
        if not quality["passed"]:
            print(f"  ✗ {quality['reason']}")
            raise HTTPException(status_code=422, detail=quality["reason"])

        # Ensure models are loaded
        if "models" not in app_data:
            print("Loading models...")
            app_data["models"] = create_model_dict()

        # Create converter and process
        # PdfConverter auto-detects file type and uses appropriate provider
        converter = PdfConverter(artifact_dict=app_data["models"])
        rendered = converter(str(file_path))
        markdown_text, _, _ = text_from_rendered(rendered)

        processing_time = time.time() - start_time

        print(f"✓ Processing complete in {processing_time:.2f}s\n")

        return OCRResponse(
            success=True,
            filename=file.filename,
            markdown_content=markdown_text,
            file_size=file_size,
            processing_time=processing_time,
            file_type=file_type,
            blur_score=quality["blur_score"],
            brightness=quality["brightness"],
            contrast=quality["contrast"],
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"✗ Error: {e}")
        raise HTTPException(status_code=500, detail="Processing failed")
    finally:
        # Cleanup
        if file_path and file_path.exists():
            try:
                os.remove(file_path)
            except Exception:
                pass


@app.post("/api/check-quality-batch")
async def check_quality_batch(
    files: List[UploadFile] = File(..., description="Files to quality-check before OCR"),
    min_sharpness:   float = Query(2.0,   description="Minimum gradient kurtosis (sharpness)"),
    min_brightness:  float = Query(25.0,  description="Minimum mean pixel brightness (0-255)"),
    max_brightness:  float = Query(245.0, description="Maximum mean pixel brightness (0-255)"),
    min_contrast:    float = Query(15.0,  description="Minimum std-dev of pixel values (contrast)"),
):
    """Run pre-OCR quality checks on multiple files without performing OCR."""
    if MAX_BATCH_FILES > 0 and len(files) > MAX_BATCH_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files. Maximum {MAX_BATCH_FILES} files per request.",
        )

    results = []
    for file in files:
        file_path = None
        try:
            if not is_allowed_file(file.filename):
                results.append({
                    "filename": file.filename,
                    "file_size": 0,
                    "passed": False,
                    "blur_score": 0.0,
                    "brightness": 0.0,
                    "contrast": 0.0,
                    "reason": "Unsupported file type",
                })
                continue

            content = await file.read()
            file_size = len(content)

            if file_size > MAX_FILE_SIZE:
                results.append({
                    "filename": file.filename,
                    "file_size": file_size,
                    "passed": False,
                    "blur_score": 0.0,
                    "brightness": 0.0,
                    "contrast": 0.0,
                    "reason": "File too large (max 50MB)",
                })
                continue

            if not validate_file_content(content):
                results.append({
                    "filename": file.filename,
                    "file_size": file_size,
                    "passed": False,
                    "blur_score": 0.0,
                    "brightness": 0.0,
                    "contrast": 0.0,
                    "reason": "File content does not match a supported type",
                })
                continue

            file_type = get_file_type(file.filename)
            file_path = unique_upload_path(file.filename)
            with open(file_path, "wb") as f:
                f.write(content)

            quality = check_document_quality(
                str(file_path), file_type,
                sharpness_threshold=min_sharpness,
                min_brightness=min_brightness,
                max_brightness=max_brightness,
                min_contrast=min_contrast,
            )
            results.append({
                "filename": file.filename,
                "file_size": file_size,
                **quality,
            })
        except Exception as e:
            print(f"  ✗ Quality check error for {getattr(file, 'filename', 'unknown')}: {e}")
            results.append({
                "filename": getattr(file, "filename", "unknown"),
                "file_size": 0,
                "passed": False,
                "blur_score": 0.0,
                "brightness": 0.0,
                "contrast": 0.0,
                "reason": "Quality check failed",
            })
        finally:
            if file_path and file_path.exists():
                try:
                    os.remove(file_path)
                except Exception:
                    pass

    passed = sum(1 for r in results if r["passed"])
    print(f"Quality check: {passed}/{len(results)} passed")
    return {"results": results, "total": len(results), "passed": passed}


@app.post("/api/upload-batch")
async def upload_and_process_batch(
    files: List[UploadFile] = File(
        ..., description="Multiple PDF or Image files to process"
    ),
    force: bool = Query(False, description="Skip quality-check blocking and process regardless"),
):
    """Upload multiple PDF/Image files and convert each to Markdown sequentially"""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    if MAX_BATCH_FILES > 0 and len(files) > MAX_BATCH_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files. Maximum {MAX_BATCH_FILES} files per request.",
        )

    results = []
    total = len(files)
    print(f"\n{'=' * 60}")
    print(f"📦 Batch processing: {total} file(s)")
    print(f"{'=' * 60}")

    # Ensure models are loaded once
    if "models" not in app_data:
        print("Loading models...")
        app_data["models"] = create_model_dict()

    for idx, file in enumerate(files, 1):
        file_path = None
        start_time = time.time()
        try:
            # Validate
            if not is_allowed_file(file.filename):
                allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
                results.append(
                    {
                        "success": False,
                        "filename": file.filename,
                        "error": f"Unsupported file type. Allowed: {allowed}",
                    }
                )
                continue

            content = await file.read()
            file_size = len(content)

            if file_size > MAX_FILE_SIZE:
                results.append(
                    {
                        "success": False,
                        "filename": file.filename,
                        "error": "File too large (max 50MB)",
                    }
                )
                continue

            if not validate_file_content(content):
                results.append(
                    {
                        "success": False,
                        "filename": file.filename,
                        "error": "File content does not match a supported type",
                    }
                )
                continue

            file_type = get_file_type(file.filename)
            file_path = unique_upload_path(file.filename)
            with open(file_path, "wb") as f:
                f.write(content)

            print(
                f"\n[{idx}/{total}] Processing [{file_type.upper()}]: {file.filename} ({file_size / 1024:.1f} KB)"
            )

            # Fast path first — skips both the quality check and the GPU for
            # any file that already carries its own text.
            fast = try_fast_path(file_path)
            if fast is not None:
                processing_time = time.time() - start_time
                print(f"  ⚡ Done in {processing_time:.2f}s (fastdoc)")
                results.append(
                    {
                        "success": True,
                        "filename": file.filename,
                        "markdown_content": fast.markdown,
                        "file_size": file_size,
                        "processing_time": processing_time,
                        "file_type": file_type,
                        "error": "",
                        "engine": "fastdoc",
                    }
                )
                continue

            # Pre-OCR quality check
            quality = check_document_quality(str(file_path), file_type)
            print(f"  Quality — blur={quality['blur_score']} brightness={quality['brightness']} contrast={quality['contrast']}")
            if not quality["passed"]:
                if force:
                    print(f"  ⚠ Quality warning (force=true, proceeding): {quality['reason']}")
                else:
                    print(f"  ✗ {quality['reason']}")
                    results.append(
                        {
                            "success": False,
                            "filename": file.filename,
                            "markdown_content": "",
                            "file_size": file_size,
                            "processing_time": time.time() - start_time,
                            "file_type": file_type,
                            "error": quality["reason"],
                        }
                    )
                    continue

            def _process_file(fpath):
                converter = PdfConverter(artifact_dict=app_data["models"])
                rendered = converter(str(fpath))
                return text_from_rendered(rendered)

            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(_process_file, file_path)
                try:
                    markdown_text, _, _ = future.result(timeout=PER_FILE_TIMEOUT)
                except FuturesTimeoutError:
                    future.cancel()
                    processing_time = time.time() - start_time
                    print(
                        f"  ✗ Timeout after {processing_time:.0f}s (limit: {PER_FILE_TIMEOUT}s)"
                    )
                    results.append(
                        {
                            "success": False,
                            "filename": file.filename,
                            "markdown_content": "",
                            "file_size": file_size,
                            "processing_time": processing_time,
                            "file_type": file_type,
                            "error": f"Processing timed out after {PER_FILE_TIMEOUT}s",
                        }
                    )
                    continue

            processing_time = time.time() - start_time
            print(f"  ✓ Done in {processing_time:.2f}s")

            results.append(
                {
                    "success": True,
                    "filename": file.filename,
                    "markdown_content": markdown_text,
                    "file_size": file_size,
                    "processing_time": processing_time,
                    "file_type": file_type,
                    "error": "",
                    "engine": "marker",
                    "blur_score": quality["blur_score"],
                    "brightness": quality["brightness"],
                    "contrast": quality["contrast"],
                }
            )
        except Exception as e:
            processing_time = time.time() - start_time
            print(f"  ✗ Error: {e}")
            results.append(
                {
                    "success": False,
                    "filename": file.filename or f"file_{idx}",
                    "markdown_content": "",
                    "file_size": 0,
                    "processing_time": processing_time,
                    "file_type": "",
                    "error": "Processing failed",
                }
            )
        finally:
            if file_path and file_path.exists():
                try:
                    os.remove(file_path)
                except Exception:
                    pass

    succeeded = sum(1 for r in results if r["success"])
    print(f"\n📦 Batch complete: {succeeded}/{total} succeeded")
    return {"results": results, "total": total, "succeeded": succeeded}


# ---------------------------------------------------------------------------
# Fast path endpoints (fastdoc — no model, no GPU)
# ---------------------------------------------------------------------------


async def _stage_fastdoc_upload(file: UploadFile) -> tuple[Path, str, int]:
    """Validate and store an upload for the fast path.

    Raises HTTPException on rejection. Content decides the format — the
    extension only gates which files are worth reading at all.
    """
    if get_file_extension(file.filename) not in FASTDOC_EXTENSIONS:
        allowed = ", ".join(sorted(FASTDOC_EXTENSIONS))
        raise HTTPException(
            status_code=415, detail=f"Fast path supports: {allowed}"
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")

    detected = detect_bytes(content)
    if detected not in FASTDOC_FORMATS:
        raise HTTPException(
            status_code=415,
            detail=f"File content is '{detected}', which the fast path cannot convert",
        )

    path = unique_upload_path(file.filename)
    with open(path, "wb") as handle:
        handle.write(content)
    return path, detected, len(content)


@app.post("/api/convert-fast")
async def convert_fast(
    file: UploadFile = File(..., description="Document with an existing text layer"),
    page_breaks: bool = Query(False, description="Emit <!-- page N --> markers"),
):
    """Convert a document to Markdown without OCR.

    Returns 422 when the file turns out to be a scan — send it to
    /api/upload instead, which runs the full Marker pipeline.
    """
    file_path = None
    try:
        file_path, detected, file_size = await _stage_fastdoc_upload(file)
        result = fastdoc.convert(str(file_path), page_breaks=page_breaks)

        if not result.ok:
            raise HTTPException(
                status_code=422 if result.needs_ocr else 400,
                detail=result.reason or result.error or "Conversion failed",
            )

        return {
            "success": True,
            "filename": file.filename,
            "markdown_content": result.markdown,
            "file_size": file_size,
            "processing_time": result.elapsed_ms / 1000.0,
            "file_type": detected,
            "engine": "fastdoc",
            "probe": result.probe,
            "warnings": result.warnings,
            "error": "",
        }
    except HTTPException:
        raise
    except Exception as exc:
        print(f"✗ Fast conversion error: {exc}")
        raise HTTPException(status_code=500, detail="Conversion failed")
    finally:
        if file_path and file_path.exists():
            try:
                os.remove(file_path)
            except Exception:
                pass


@app.post("/api/triage-batch")
async def triage_batch(
    files: List[UploadFile] = File(..., description="Files to route before any OCR"),
):
    """Report which files need OCR and which can take the fast path.

    Reads text objects only — never renders a page and never loads a model —
    so a whole batch can be routed before any GPU time is committed.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
    if MAX_BATCH_FILES > 0 and len(files) > MAX_BATCH_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files. Maximum {MAX_BATCH_FILES} files per request.",
        )

    results = []
    for file in files:
        file_path = None
        try:
            content = await file.read()
            if len(content) > MAX_FILE_SIZE:
                results.append(
                    {
                        "filename": file.filename,
                        "route": "error",
                        "error": "File too large (max 50MB)",
                    }
                )
                continue

            file_path = unique_upload_path(file.filename)
            with open(file_path, "wb") as handle:
                handle.write(content)

            verdict = fastdoc.triage(str(file_path))
            if verdict.needs_ocr:
                route = "ocr"
            elif verdict.ok:
                route = "fast"
            else:
                route = "unsupported"

            results.append(
                {
                    "filename": file.filename,
                    "route": route,
                    "format": verdict.format,
                    "reason": verdict.reason or verdict.error,
                    "probe_ms": round(verdict.elapsed_ms, 2),
                    "probe": verdict.probe,
                    "error": verdict.error,
                }
            )
        except Exception as exc:
            print(f"✗ Triage error on {file.filename}: {exc}")
            results.append(
                {"filename": file.filename, "route": "error", "error": "Triage failed"}
            )
        finally:
            if file_path and file_path.exists():
                try:
                    os.remove(file_path)
                except Exception:
                    pass

    counts = {"fast": 0, "ocr": 0, "unsupported": 0, "error": 0}
    for row in results:
        counts[row["route"]] = counts.get(row["route"], 0) + 1
    return {"results": results, "total": len(results), "counts": counts}


# ---------------------------------------------------------------------------
# Notes extraction endpoints
# ---------------------------------------------------------------------------


@app.post("/api/extract-notes")
async def extract_notes_single(
    file: UploadFile = File(..., description="PDF or image engineering drawing"),
    include_image: bool = Query(
        True, description="Return a base64 crop image of the Notes region"
    ),
):
    """
    Extract the 'Notes:' section from a single engineering drawing PDF.

    Runs the full Marker OCR pipeline on the first page, locates the Notes
    block in the right-upper region, and returns the recognised text plus an
    optional cropped PNG for visual verification.
    """
    from notes_extractor import extract_notes_from_pdf  # lazy import

    file_path = None
    start_time = time.time()

    try:
        if not is_allowed_file(file.filename):
            allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type. Allowed: {allowed}",
            )

        content = await file.read()
        file_size = len(content)

        if file_size > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 50MB)")

        if not validate_file_content(content):
            raise HTTPException(
                status_code=400, detail="File content does not match a supported type"
            )

        file_path = unique_upload_path(file.filename)
        with open(file_path, "wb") as f:
            f.write(content)

        print(f"\n{'=' * 60}")
        print(f"Extracting Notes from: {file.filename} ({file_size / 1024:.1f} KB)")
        print(f"{'=' * 60}")

        if "models" not in app_data:
            print("Loading models...")
            app_data["models"] = create_model_dict()

        result = extract_notes_from_pdf(
            str(file_path),
            app_data["models"],
            include_crop_image=include_image,
            yolo_detector=app_data.get("yolo_detector"),
        )

        processing_time = time.time() - start_time
        result["filename"] = file.filename
        result["processing_time"] = processing_time
        result["file_size"] = file_size

        status = "✓" if result["success"] else "✗"
        print(f"{status} Notes extraction done in {processing_time:.2f}s\n")

        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"✗ Error: {e}")
        raise HTTPException(
            status_code=500, detail="Notes extraction failed"
        )
    finally:
        if file_path and file_path.exists():
            try:
                os.remove(file_path)
            except Exception:
                pass


@app.post("/api/extract-notes-batch")
async def extract_notes_batch(
    files: List[UploadFile] = File(
        ..., description="Multiple PDF engineering drawings"
    ),
    include_image: bool = Query(True, description="Return base64 crop images"),
):
    """
    Extract the 'Notes:' section from multiple engineering drawing PDFs.

    Files are processed sequentially; models are loaded once and reused.
    """
    from notes_extractor import extract_notes_from_pdf  # lazy import

    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    if MAX_BATCH_FILES > 0 and len(files) > MAX_BATCH_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files. Maximum {MAX_BATCH_FILES} files per request.",
        )

    results = []
    total = len(files)

    print(f"\n{'=' * 60}")
    print(f"Notes batch extraction: {total} file(s)")
    print(f"{'=' * 60}")

    if "models" not in app_data:
        print("Loading models...")
        app_data["models"] = create_model_dict()

    for idx, file in enumerate(files, 1):
        file_path = None
        start_time = time.time()

        try:
            if not is_allowed_file(file.filename):
                allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
                results.append(
                    {
                        "success": False,
                        "filename": file.filename,
                        "notes_text": None,
                        "crop_image_b64": None,
                        "crop_bbox": None,
                        "error": f"Unsupported file type. Allowed: {allowed}",
                        "processing_time": 0.0,
                        "file_size": 0,
                    }
                )
                continue

            content = await file.read()
            file_size = len(content)

            if file_size > MAX_FILE_SIZE:
                results.append(
                    {
                        "success": False,
                        "filename": file.filename,
                        "notes_text": None,
                        "crop_image_b64": None,
                        "crop_bbox": None,
                        "error": "File too large (max 50MB)",
                        "processing_time": 0.0,
                        "file_size": file_size,
                    }
                )
                continue

            if not validate_file_content(content):
                results.append(
                    {
                        "success": False,
                        "filename": file.filename,
                        "notes_text": None,
                        "crop_image_b64": None,
                        "crop_bbox": None,
                        "error": "File content does not match a supported type",
                        "processing_time": 0.0,
                        "file_size": file_size,
                    }
                )
                continue

            file_path = unique_upload_path(file.filename)
            with open(file_path, "wb") as f:
                f.write(content)

            print(f"\n[{idx}/{total}] {file.filename} ({file_size / 1024:.1f} KB)")

            def _extract(fpath):
                return extract_notes_from_pdf(
                    str(fpath),
                    app_data["models"],
                    include_crop_image=include_image,
                    yolo_detector=app_data.get("yolo_detector"),
                )

            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(_extract, file_path)
                try:
                    result = future.result(timeout=PER_FILE_TIMEOUT)
                except FuturesTimeoutError:
                    future.cancel()
                    processing_time = time.time() - start_time
                    print(f"  ✗ Timeout after {processing_time:.0f}s")
                    results.append(
                        {
                            "success": False,
                            "filename": file.filename,
                            "notes_text": None,
                            "crop_image_b64": None,
                            "crop_bbox": None,
                            "error": f"Processing timed out after {PER_FILE_TIMEOUT}s",
                            "processing_time": processing_time,
                            "file_size": file_size,
                        }
                    )
                    continue

            processing_time = time.time() - start_time
            result["filename"] = file.filename
            result["processing_time"] = processing_time
            result["file_size"] = file_size

            status = "✓" if result["success"] else "✗"
            print(f"  {status} Done in {processing_time:.2f}s")
            results.append(result)

        except Exception as e:
            processing_time = time.time() - start_time
            print(f"  ✗ Error: {e}")
            results.append(
                {
                    "success": False,
                    "filename": getattr(file, "filename", f"file_{idx}"),
                    "notes_text": None,
                    "crop_image_b64": None,
                    "crop_bbox": None,
                    "error": "Processing failed",
                    "processing_time": processing_time,
                    "file_size": 0,
                }
            )
        finally:
            if file_path and file_path.exists():
                try:
                    os.remove(file_path)
                except Exception:
                    pass

    succeeded = sum(1 for r in results if r["success"])
    print(f"\nBatch complete: {succeeded}/{total} succeeded")
    return {"results": results, "total": total, "succeeded": succeeded}


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run("main:app", host=host, port=port, reload=True)
