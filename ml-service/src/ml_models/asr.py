"""
ASR Model wrapper using Sherpa-ONNX.

Lightweight and fast inference on CPU.
"""

import logging
from pathlib import Path
from typing import Optional

import numpy as np
import sherpa_onnx
import soundfile as sf

from config import get_settings

logger = logging.getLogger(__name__)


class ASRModel:
    """Wrapper for Sherpa-ONNX transducer ASR model."""

    _instance: Optional["ASRModel"] = None
    _recognizer: Optional[sherpa_onnx.OfflineRecognizer] = None

    def __new__(cls) -> "ASRModel":
        """Singleton pattern for model instance."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @property
    def is_loaded(self) -> bool:
        """Check if model is loaded."""
        return self._recognizer is not None

    def load_model(self) -> None:
        """Load the ASR model from ONNX files."""
        if self._recognizer is not None:
            logger.info("Model already loaded, skipping")
            return

        settings = get_settings()

        logger.info(f"Loading ASR model from: {settings.model_dir}")

        # Validate model files exist
        settings.validate_model_files()

        try:
            # Create recognizer using from_transducer factory method
            # model_type="nemo_transducer" required for Parakeet-TDT models
            self._recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
                encoder=str(settings.encoder_path),
                decoder=str(settings.decoder_path),
                joiner=str(settings.joiner_path),
                tokens=str(settings.tokens_path),
                num_threads=settings.num_threads,
                provider="cpu",
                decoding_method="greedy_search",
                model_type="nemo_transducer",
            )
            logger.info(f"Using {settings.num_threads} threads for inference")

            logger.info("ASR model loaded successfully")

        except Exception as e:
            logger.error(f"Failed to load ASR model: {e}")
            raise RuntimeError(f"Failed to load ASR model: {e}")

    def transcribe(self, audio_path: str | Path) -> str:
        """
        Transcribe audio file.

        Args:
            audio_path: Path to audio file (16kHz mono WAV)

        Returns:
            Transcribed text
        """
        if not self.is_loaded:
            raise RuntimeError("Model not loaded")

        audio_path = str(audio_path)
        logger.debug(f"Transcribing: {audio_path}")

        try:
            # Read audio using soundfile
            samples, sample_rate = sf.read(audio_path, dtype="float32")

            # Convert to mono if stereo
            if len(samples.shape) > 1:
                samples = samples.mean(axis=1)

            # Create stream and process
            stream = self._recognizer.create_stream()
            stream.accept_waveform(sample_rate, samples.tolist())

            # Decode
            self._recognizer.decode_stream(stream)

            # Get result
            result = stream.result.text.strip()

            return result

        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            raise RuntimeError(f"Transcription failed: {e}")

    def transcribe_samples(self, samples: np.ndarray, sample_rate: int = 16000) -> str:
        """
        Transcribe audio samples directly.

        Args:
            samples: Audio samples as numpy array (float32)
            sample_rate: Sample rate of audio

        Returns:
            Transcribed text
        """
        if not self.is_loaded:
            raise RuntimeError("Model not loaded")

        try:
            stream = self._recognizer.create_stream()
            stream.accept_waveform(sample_rate, samples.tolist())
            self._recognizer.decode_stream(stream)
            return stream.result.text.strip()

        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            raise RuntimeError(f"Transcription failed: {e}")

    def unload_model(self) -> None:
        """Unload model from memory."""
        if self._recognizer is not None:
            del self._recognizer
            self._recognizer = None
            logger.info("ASR model unloaded")


# Global model instance
asr_model = ASRModel()


def get_asr_model() -> ASRModel:
    """Get the ASR model instance."""
    return asr_model
