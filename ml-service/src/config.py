"""
ML Service Configuration.

Environment-based settings with validation.
"""

from pathlib import Path
from functools import lru_cache

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Model configuration (Sherpa-ONNX transducer)
    model_dir: Path = Field(
        default=Path("/models"),
        description="Directory containing ONNX model files"
    )

    # Audio processing
    chunk_size_seconds: int = Field(
        default=60,
        ge=10,
        le=300,
        description="Chunk size for long audio processing"
    )
    sample_rate: int = Field(
        default=16000,
        description="Target sample rate for audio"
    )
    max_audio_duration_seconds: int = Field(
        default=7200,  # 2 hours
        description="Maximum audio duration in seconds"
    )
    max_file_size_mb: int = Field(
        default=100,
        description="Maximum file size in MB"
    )

    # Temp directory
    temp_dir: Path = Field(
        default=Path("/app/temp"),
        description="Directory for temporary files"
    )

    # Server configuration
    host: str = Field(default="0.0.0.0", description="Server host")
    port: int = Field(default=3010, description="Server port")

    # Performance
    num_threads: int = Field(
        default=4,
        ge=1,
        le=32,
        description="Number of threads for ONNX inference"
    )

    # Supported formats
    supported_formats: list[str] = Field(
        default=["mp3", "wav", "ogg", "m4a", "flac", "opus", "webm", "oga"],
        description="Supported audio formats"
    )

    class Config:
        env_prefix = ""
        case_sensitive = False

    @property
    def encoder_path(self) -> Path:
        return self.model_dir / "encoder.int8.onnx"

    @property
    def decoder_path(self) -> Path:
        return self.model_dir / "decoder.int8.onnx"

    @property
    def joiner_path(self) -> Path:
        return self.model_dir / "joiner.int8.onnx"

    @property
    def tokens_path(self) -> Path:
        return self.model_dir / "tokens.txt"

    def ensure_directories(self) -> None:
        """Create required directories if they don't exist."""
        self.temp_dir.mkdir(parents=True, exist_ok=True)

    def validate_model_files(self) -> None:
        """Check that all model files exist."""
        required_files = [
            self.encoder_path,
            self.decoder_path,
            self.joiner_path,
            self.tokens_path,
        ]
        missing = [f for f in required_files if not f.exists()]
        if missing:
            raise RuntimeError(
                f"Missing model files: {[str(f) for f in missing]}\n"
                f"Expected in: {self.model_dir}"
            )


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    settings = Settings()
    settings.ensure_directories()
    return settings
