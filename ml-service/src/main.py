"""
ML Service for Audio Transcription.

FastAPI application with Sherpa-ONNX ASR.
"""

import logging
import sys
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

import psutil
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import get_settings
from ml_models.asr import get_asr_model
from services.audio_processor import get_audio_processor, cleanup_temp_directory, AudioProcessingError
from services.transcription import get_transcription_service, TranscriptionError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan handler.

    Startup:
    - Clean temp directory
    - Load ASR model

    Shutdown:
    - Unload model
    - Clean temp directory
    """
    settings = get_settings()

    # Startup
    logger.info("=" * 50)
    logger.info("ML Service starting...")
    logger.info(f"Model dir: {settings.model_dir}")
    logger.info(f"Chunk size: {settings.chunk_size_seconds}s")
    logger.info(f"Temp directory: {settings.temp_dir}")
    logger.info("=" * 50)

    # Clean temp directory on startup
    logger.info("Cleaning temp directory...")
    files_removed = cleanup_temp_directory()
    logger.info(f"Removed {files_removed} temporary files")

    # Load ASR model
    logger.info("Loading ASR model (this may take a few minutes)...")
    try:
        asr_model = get_asr_model()
        asr_model.load_model()
        logger.info("ASR model loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load ASR model: {e}")
        logger.error("Service will start but transcription will fail")

    logger.info("=" * 50)
    logger.info("ML Service ready!")
    logger.info("=" * 50)

    yield

    # Shutdown
    logger.info("ML Service shutting down...")

    # Unload model
    try:
        asr_model = get_asr_model()
        asr_model.unload_model()
    except Exception as e:
        logger.warning(f"Error unloading model: {e}")

    # Final cleanup
    cleanup_temp_directory()
    logger.info("ML Service stopped")


# Create FastAPI application
app = FastAPI(
    title="Audio Transcription ML Service",
    description="ASR service using Sherpa-ONNX",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Response models
class TranscriptionData(BaseModel):
    """Transcription result data."""
    text: str
    language: str
    duration: float
    processing_time_ms: int


class TranscriptionResponse(BaseModel):
    """Successful transcription response."""
    success: bool = True
    data: TranscriptionData


class ErrorDetail(BaseModel):
    """Error detail information."""
    code: str
    message: str
    details: Optional[str] = None


class ErrorResponse(BaseModel):
    """Error response."""
    success: bool = False
    error: ErrorDetail


class ModelStatus(BaseModel):
    """Model status information."""
    loaded: bool
    name: str


class MemoryStatus(BaseModel):
    """Memory status information."""
    used_gb: float
    available_gb: float


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    model: ModelStatus
    memory: MemoryStatus


@app.get("/")
async def root() -> dict:
    """Root endpoint with service info."""
    return {
        "service": "Audio Transcription ML Service",
        "model": "sherpa-onnx/parakeet-tdt-0.6b-v3",
        "version": "1.0.0",
        "endpoints": {
            "transcribe": "POST /transcribe",
            "health": "GET /health",
            "docs": "GET /docs"
        }
    }


@app.post(
    "/transcribe",
    response_model=TranscriptionResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid audio format"},
        413: {"model": ErrorResponse, "description": "File too large"},
        500: {"model": ErrorResponse, "description": "Transcription failed"}
    }
)
async def transcribe_audio(
    audio: UploadFile = File(..., description="Audio file to transcribe"),
    language: Optional[str] = Form(
        default=None,
        description="Language code (auto-detect if not specified)"
    )
) -> TranscriptionResponse:
    """
    Transcribe an audio file.

    Accepts audio files in mp3, wav, ogg, m4a, flac formats.
    Supports chunking for long audio files.

    Returns transcribed text with metadata.
    """
    settings = get_settings()
    audio_processor = get_audio_processor()
    transcription_service = get_transcription_service()

    # Validate filename
    if not audio.filename:
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": {
                    "code": "MISSING_FILENAME",
                    "message": "Audio file must have a filename"
                }
            }
        )

    # Validate format
    if not audio_processor.validate_format(audio.filename):
        supported = ", ".join(settings.supported_formats)
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": {
                    "code": "INVALID_AUDIO_FORMAT",
                    "message": f"Unsupported audio format. Supported: {supported}"
                }
            }
        )

    # Check file size (if available)
    if audio.size and audio.size > settings.max_file_size_mb * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail={
                "success": False,
                "error": {
                    "code": "FILE_TOO_LARGE",
                    "message": f"Audio file exceeds maximum size of {settings.max_file_size_mb}MB"
                }
            }
        )

    from pathlib import Path
    saved_path: Optional[Path] = None

    try:
        # Save uploaded file
        saved_path = audio_processor.save_upload(audio.file, audio.filename)

        # Perform transcription
        result = transcription_service.transcribe(saved_path, language)

        return TranscriptionResponse(
            success=True,
            data=TranscriptionData(
                text=result.text,
                language=result.language,
                duration=result.duration,
                processing_time_ms=result.processing_time_ms
            )
        )

    except TranscriptionError as e:
        logger.error(f"Transcription error: {e.code} - {e.message}")
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error": {
                    "code": e.code,
                    "message": e.message
                }
            }
        )

    except AudioProcessingError as e:
        logger.error(f"Audio processing error: {e}")
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": {
                    "code": "AUDIO_PROCESSING_ERROR",
                    "message": str(e)
                }
            }
        )

    except Exception as e:
        logger.exception("Unexpected error during transcription")
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "Failed to transcribe audio",
                    "details": str(e)
                }
            }
        )

    finally:
        # Always cleanup the uploaded file
        if saved_path:
            audio_processor.cleanup_file(saved_path)


@app.get(
    "/health",
    response_model=HealthResponse
)
async def health_check() -> HealthResponse:
    """
    Check service health.

    Returns model status and memory usage information.
    """
    asr_model = get_asr_model()

    # Get memory info
    memory = psutil.virtual_memory()
    used_gb = round((memory.total - memory.available) / (1024 ** 3), 1)
    available_gb = round(memory.available / (1024 ** 3), 1)

    return HealthResponse(
        status="healthy" if asr_model.is_loaded else "degraded",
        model=ModelStatus(
            loaded=asr_model.is_loaded,
            name="parakeet-tdt-0.6b-v3"
        ),
        memory=MemoryStatus(
            used_gb=used_gb,
            available_gb=available_gb
        )
    )


if __name__ == "__main__":
    settings = get_settings()

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        workers=1,
        log_level="info"
    )
