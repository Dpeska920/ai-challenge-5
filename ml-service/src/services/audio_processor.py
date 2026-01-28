"""
Audio processing utilities.

Handles audio conversion, resampling, and format validation.
"""

import logging
import uuid
from pathlib import Path
from typing import BinaryIO

import librosa
import soundfile as sf
import numpy as np
from pydub import AudioSegment

from config import get_settings

logger = logging.getLogger(__name__)


class AudioProcessingError(Exception):
    """Exception raised for audio processing errors."""
    pass


class AudioProcessor:
    """Audio file processor for ASR preparation."""

    def __init__(self):
        self.settings = get_settings()

    def get_audio_duration(self, file_path: Path) -> float:
        """
        Get audio duration in seconds.

        Args:
            file_path: Path to audio file

        Returns:
            Duration in seconds
        """
        try:
            duration = librosa.get_duration(path=str(file_path))
            return duration
        except Exception as e:
            logger.error(f"Failed to get audio duration: {e}")
            raise AudioProcessingError(f"Failed to get audio duration: {e}")

    def validate_format(self, filename: str) -> bool:
        """
        Validate audio file format.

        Args:
            filename: Original filename

        Returns:
            True if format is supported
        """
        ext = Path(filename).suffix.lower().lstrip(".")
        return ext in self.settings.supported_formats

    def save_upload(self, file: BinaryIO, filename: str) -> Path:
        """
        Save uploaded file to temp directory.

        Args:
            file: File-like object
            filename: Original filename

        Returns:
            Path to saved file
        """
        ext = Path(filename).suffix.lower()
        if not ext:
            ext = ".wav"

        unique_name = f"{uuid.uuid4()}{ext}"
        file_path = self.settings.temp_dir / unique_name

        try:
            content = file.read()
            with open(file_path, "wb") as f:
                f.write(content)
            logger.debug(f"Saved upload to: {file_path}")
            return file_path
        except Exception as e:
            logger.error(f"Failed to save upload: {e}")
            raise AudioProcessingError(f"Failed to save upload: {e}")

    def convert_to_wav(self, input_path: Path) -> Path:
        """
        Convert audio to 16kHz mono WAV format.

        Args:
            input_path: Path to input audio file

        Returns:
            Path to converted WAV file
        """
        output_path = input_path.with_suffix(".converted.wav")

        try:
            # Try using pydub first (handles more formats via ffmpeg)
            audio = AudioSegment.from_file(str(input_path))

            # Convert to mono
            audio = audio.set_channels(1)

            # Resample to 16kHz
            audio = audio.set_frame_rate(self.settings.sample_rate)

            # Export as WAV
            audio.export(str(output_path), format="wav")

            logger.debug(f"Converted to WAV: {output_path}")
            return output_path

        except Exception as e:
            logger.warning(f"Pydub conversion failed, trying librosa: {e}")

            try:
                # Fallback to librosa
                y, sr = librosa.load(
                    str(input_path),
                    sr=self.settings.sample_rate,
                    mono=True
                )

                sf.write(str(output_path), y, self.settings.sample_rate)
                logger.debug(f"Converted to WAV using librosa: {output_path}")
                return output_path

            except Exception as e2:
                logger.error(f"All conversion methods failed: {e2}")
                raise AudioProcessingError(f"Failed to convert audio: {e2}")

    def split_audio(self, audio_path: Path, chunk_duration: int) -> list[Path]:
        """
        Split audio into chunks.

        Args:
            audio_path: Path to audio file
            chunk_duration: Duration of each chunk in seconds

        Returns:
            List of paths to chunk files
        """
        chunks = []

        try:
            # Load audio
            y, sr = librosa.load(
                str(audio_path),
                sr=self.settings.sample_rate,
                mono=True
            )

            total_samples = len(y)
            chunk_samples = chunk_duration * sr
            num_chunks = int(np.ceil(total_samples / chunk_samples))

            logger.info(f"Splitting audio into {num_chunks} chunks")

            for i in range(num_chunks):
                start = i * chunk_samples
                end = min((i + 1) * chunk_samples, total_samples)

                chunk_audio = y[start:end]

                chunk_path = audio_path.parent / f"{audio_path.stem}_chunk_{i:04d}.wav"
                sf.write(str(chunk_path), chunk_audio, sr)

                chunks.append(chunk_path)
                logger.debug(f"Created chunk {i+1}/{num_chunks}: {chunk_path}")

            return chunks

        except Exception as e:
            # Clean up any created chunks on error
            for chunk in chunks:
                try:
                    chunk.unlink()
                except Exception:
                    pass
            logger.error(f"Failed to split audio: {e}")
            raise AudioProcessingError(f"Failed to split audio: {e}")

    def cleanup_file(self, file_path: Path) -> None:
        """
        Remove temporary file.

        Args:
            file_path: Path to file to remove
        """
        try:
            if file_path.exists():
                file_path.unlink()
                logger.debug(f"Cleaned up: {file_path}")
        except Exception as e:
            logger.warning(f"Failed to cleanup file {file_path}: {e}")

    def cleanup_files(self, file_paths: list[Path]) -> None:
        """
        Remove multiple temporary files.

        Args:
            file_paths: List of paths to remove
        """
        for path in file_paths:
            self.cleanup_file(path)


def cleanup_temp_directory() -> int:
    """
    Clean all files in temp directory.

    Returns:
        Number of files removed
    """
    settings = get_settings()
    temp_dir = settings.temp_dir

    if not temp_dir.exists():
        temp_dir.mkdir(parents=True, exist_ok=True)
        return 0

    count = 0
    for file_path in temp_dir.iterdir():
        if file_path.is_file():
            try:
                file_path.unlink()
                count += 1
            except Exception as e:
                logger.warning(f"Failed to remove temp file {file_path}: {e}")

    logger.info(f"Cleaned up {count} files from temp directory")
    return count


# Module-level instance
audio_processor = AudioProcessor()


def get_audio_processor() -> AudioProcessor:
    """Get audio processor instance."""
    return audio_processor
