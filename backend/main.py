"""
FastAPI Backend for PDF/Image OCR using Marker
Provides CAD_OCR-compatible API interface
"""

import os
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

# Configuration
API_TITLE = "PDF/Image OCR Service (Marker)"
API_VERSION = "1.1.0"
API_DESCRIPTION = "PDF and Image to Markdown conversion using Marker"

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

# Maximum number of files allowed in a single batch request
MAX_BATCH_FILES = 50

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


def sanitize_filename(filename: str) -> str:
    """Strip any directory components to prevent path traversal."""
    return Path(filename).name


def get_file_extension(filename: str) -> str:
    """Get lowercase file extension"""
    return Path(filename).suffix.lower()


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

    yield

    # Cleanup
    print("\n🛑 Shutting down...")
    if "models" in app_data:
        del app_data["models"]
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
    return {
        "name": API_TITLE,
        "version": API_VERSION,
        "supported_formats": list(ALLOWED_EXTENSIONS),
        "endpoints": {
            "upload": "/api/upload",
            "upload_batch": "/api/upload-batch",
            "extract_notes": "/api/extract-notes",
            "extract_notes_batch": "/api/extract-notes-batch",
            "health": "/api/health",
        },
    }


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "model_loaded": "models" in app_data,
        "device": app_data.get("device", "unknown"),
        "supported_formats": list(ALLOWED_EXTENSIONS),
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
        safe_filename = sanitize_filename(file.filename)
        file_path = UPLOAD_DIR / safe_filename
        with open(file_path, "wb") as f:
            f.write(content)

        print(f"\n{'=' * 60}")
        print(
            f"Processing [{file_type.upper()}]: {file.filename} ({file_size / 1024:.1f} KB)"
        )
        print(f"{'=' * 60}")

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
    if len(files) > MAX_BATCH_FILES:
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
            safe_filename = sanitize_filename(file.filename)
            file_path = UPLOAD_DIR / safe_filename
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

    if len(files) > MAX_BATCH_FILES:
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
            safe_filename = sanitize_filename(file.filename)
            file_path = UPLOAD_DIR / safe_filename
            with open(file_path, "wb") as f:
                f.write(content)

            print(
                f"\n[{idx}/{total}] Processing [{file_type.upper()}]: {file.filename} ({file_size / 1024:.1f} KB)"
            )

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

        safe_filename = sanitize_filename(file.filename)
        file_path = UPLOAD_DIR / safe_filename
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

    if len(files) > MAX_BATCH_FILES:
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

            safe_filename = sanitize_filename(file.filename)
            file_path = UPLOAD_DIR / safe_filename
            with open(file_path, "wb") as f:
                f.write(content)

            print(f"\n[{idx}/{total}] {file.filename} ({file_size / 1024:.1f} KB)")

            def _extract(fpath):
                return extract_notes_from_pdf(
                    str(fpath),
                    app_data["models"],
                    include_crop_image=include_image,
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
