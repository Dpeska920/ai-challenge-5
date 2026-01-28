"""
Transcription service.

Orchestrates audio processing and ASR inference with chunking support.
"""

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from config import get_settings
from ml_models.asr import get_asr_model
from services.audio_processor import (
    get_audio_processor,
    AudioProcessingError
)

logger = logging.getLogger(__name__)


@dataclass
class TranscriptionResult:
    """Result of transcription operation."""
    text: str
    language: str
    duration: float
    chunks_processed: int
    processing_time_ms: int


class TranscriptionError(Exception):
    """Exception raised for transcription errors."""
    def __init__(self, message: str, code: str = "TRANSCRIPTION_FAILED"):
        self.message = message
        self.code = code
        super().__init__(message)


class TranscriptionService:
    """Service for transcribing audio files."""

    def __init__(self):
        self.settings = get_settings()
        self.audio_processor = get_audio_processor()
        self.asr_model = get_asr_model()

    def transcribe(
        self,
        audio_path: Path,
        language: Optional[str] = None
    ) -> TranscriptionResult:
        """
        Transcribe audio file with automatic chunking.

        Args:
            audio_path: Path to audio file
            language: Optional language code (currently ignored, model auto-detects)

        Returns:
            TranscriptionResult with text and metadata
        """
        start_time = time.time()
        temp_files: list[Path] = []
        converted_path: Optional[Path] = None
        chunks: list[Path] = []

        try:
            # Get audio duration
            duration = self.audio_processor.get_audio_duration(audio_path)
            logger.info(f"Audio duration: {duration:.1f} seconds")

            # Validate duration
            if duration > self.settings.max_audio_duration_seconds:
                raise TranscriptionError(
                    f"Audio too long. Maximum duration is {self.settings.max_audio_duration_seconds // 60} minutes.",
                    code="AUDIO_TOO_LONG"
                )

            if duration < 0.1:
                raise TranscriptionError(
                    "Audio file appears to be empty or too short.",
                    code="AUDIO_TOO_SHORT"
                )

            # Convert to WAV format
            converted_path = self.audio_processor.convert_to_wav(audio_path)
            temp_files.append(converted_path)

            # Determine if chunking is needed
            needs_chunking = duration > self.settings.chunk_size_seconds

            if needs_chunking:
                # Split into chunks
                chunks = self.audio_processor.split_audio(
                    converted_path,
                    self.settings.chunk_size_seconds
                )
                temp_files.extend(chunks)

                # Transcribe each chunk
                texts = []
                for i, chunk_path in enumerate(chunks):
                    logger.info(f"Transcribing chunk {i+1}/{len(chunks)}")
                    text = self.asr_model.transcribe(chunk_path)
                    if text:
                        texts.append(text)

                full_text = " ".join(texts)
                chunks_processed = len(chunks)

            else:
                # Transcribe directly
                full_text = self.asr_model.transcribe(converted_path)
                chunks_processed = 1

            # Calculate processing time
            processing_time_ms = int((time.time() - start_time) * 1000)

            # Detect language (simplified - could be enhanced)
            detected_language = self._detect_language(full_text) if not language else language

            logger.info(
                f"Transcription complete: {len(full_text)} chars, "
                f"{chunks_processed} chunks, {processing_time_ms}ms"
            )

            return TranscriptionResult(
                text=full_text.strip(),
                language=detected_language,
                duration=duration,
                chunks_processed=chunks_processed,
                processing_time_ms=processing_time_ms
            )

        except TranscriptionError:
            raise
        except AudioProcessingError as e:
            raise TranscriptionError(str(e), code="AUDIO_PROCESSING_ERROR")
        except Exception as e:
            logger.exception("Unexpected transcription error")
            raise TranscriptionError(
                f"Failed to transcribe audio: {str(e)}",
                code="TRANSCRIPTION_FAILED"
            )
        finally:
            # Cleanup temporary files
            self.audio_processor.cleanup_files(temp_files)

    def _detect_language(self, text: str) -> str:
        """
        Simple language detection based on character analysis.

        Args:
            text: Transcribed text

        Returns:
            ISO 639-1 language code
        """
        if not text:
            return "en"

        # Count Cyrillic characters
        cyrillic_count = sum(1 for c in text if "\u0400" <= c <= "\u04ff")
        total_alpha = sum(1 for c in text if c.isalpha())

        if total_alpha == 0:
            return "en"

        cyrillic_ratio = cyrillic_count / total_alpha

        # Simple heuristic: >30% Cyrillic = Russian
        if cyrillic_ratio > 0.3:
            return "ru"

        return "en"


# Module-level instance
_transcription_service: Optional[TranscriptionService] = None


def get_transcription_service() -> TranscriptionService:
    """Get transcription service instance."""
    global _transcription_service
    if _transcription_service is None:
        _transcription_service = TranscriptionService()
    return _transcription_service
