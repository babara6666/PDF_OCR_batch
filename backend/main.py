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
from fastapi import FastAPI, UploadFile, File, HTTPException, Request, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Marker imports
from marker.converters.pdf import PdfConverter
from marker.models import create_model_dict
from marker.output import text_from_rendered

# Notes extraction — imported lazily inside each endpoint

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


def get_file_extension(filename: str) -> str:
    """Get lowercase file extension"""
    return Path(filename).suffix.lower()


def is_allowed_file(filename: str) -> bool:
    """Check if file extension is allowed"""
    return get_file_extension(filename) in ALLOWED_EXTENSIONS


def get_file_type(filename: str) -> str:
    """Get file type category"""
    ext = get_file_extension(filename)
    if ext == ".pdf":
        return "pdf"
    return "image"


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
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": str(exc)},
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

        # Save to temp file
        file_path = UPLOAD_DIR / file.filename
        with open(file_path, "wb") as f:
            f.write(content)

        print(f"\n{'=' * 60}")
        print(
            f"Processing [{file_type.upper()}]: {file.filename} ({file_size / 1024:.1f} KB)"
        )
        print(f"{'=' * 60}")

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
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"✗ Error: {e}")
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")
    finally:
        # Cleanup
        if file_path and file_path.exists():
            try:
                os.remove(file_path)
            except:
                pass


@app.post("/api/upload-batch")
async def upload_and_process_batch(
    files: List[UploadFile] = File(
        ..., description="Multiple PDF or Image files to process"
    ),
):
    """Upload multiple PDF/Image files and convert each to Markdown sequentially"""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

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

            file_type = get_file_type(file.filename)
            file_path = UPLOAD_DIR / file.filename
            with open(file_path, "wb") as f:
                f.write(content)

            print(
                f"\n[{idx}/{total}] Processing [{file_type.upper()}]: {file.filename} ({file_size / 1024:.1f} KB)"
            )

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
                    "error": str(e),
                }
            )
        finally:
            if file_path and file_path.exists():
                try:
                    os.remove(file_path)
                except:
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

        file_path = UPLOAD_DIR / file.filename
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
            status_code=500, detail=f"Notes extraction failed: {str(e)}"
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

            file_path = UPLOAD_DIR / file.filename
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
                    "error": str(e),
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
