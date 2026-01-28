# ML Service - Audio Transcription

FastAPI service for local audio transcription using Sherpa-ONNX with the Parakeet-TDT model.

## Features

- Local transcription (no external API calls)
- Supports multiple audio formats: mp3, wav, ogg, m4a, flac, opus, webm
- Automatic chunking for long audio files
- Language auto-detection (English/Russian)
- Low memory footprint with Sherpa-ONNX

## Model

Uses NVIDIA Parakeet-TDT 0.6B model (int8 quantized):
- ~600M parameters
- English ASR with high accuracy
- CPU-optimized inference

## API Endpoints

### POST /transcribe

Transcribe an audio file.

**Request:**
```
Content-Type: multipart/form-data
- audio: file (required) - Audio file to transcribe
- language: string (optional) - Language code (auto-detect if not specified)
```

**Response:**
```json
{
  "success": true,
  "data": {
    "text": "Transcribed text here",
    "language": "en",
    "duration": 12.5,
    "processing_time_ms": 3500
  }
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "model": {
    "loaded": true,
    "name": "parakeet-tdt-0.6b-v3"
  },
  "memory": {
    "used_gb": 2.5,
    "available_gb": 5.3
  }
}
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| MODEL_DIR | /models | Path to ONNX model files |
| TEMP_DIR | /app/temp | Temporary file directory |
| NUM_THREADS | 4 | ONNX inference threads |
| CHUNK_SIZE_SECONDS | 60 | Audio chunk size for long files |
| MAX_AUDIO_DURATION_SECONDS | 7200 | Maximum audio duration (2 hours) |
| MAX_FILE_SIZE_MB | 100 | Maximum upload file size |

## Model Files

The following model files are required in MODEL_DIR:
- encoder.int8.onnx
- decoder.int8.onnx
- joiner.int8.onnx
- tokens.txt

Download from: https://github.com/k2-fsa/sherpa-onnx/releases

## Docker

### Build
```bash
docker build -t ml-service .
```

### Run
```bash
docker run -d \
  -p 3010:3010 \
  -v /path/to/models:/models:ro \
  ml-service
```

### Docker Compose
```yaml
ml-service:
  build: ./ml-service
  ports:
    - "3010:3010"
  volumes:
    - ./models:/models:ro
  environment:
    - NUM_THREADS=4
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3010/health"]
    interval: 30s
    timeout: 10s
    retries: 3
```

## Development

### Local Setup
```bash
cd ml-service

# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export MODEL_DIR=/path/to/models
export TEMP_DIR=./temp

# Run
python src/main.py
```

### Testing
```bash
# Test transcription
curl -X POST http://localhost:3010/transcribe \
  -F "audio=@test.wav"

# Health check
curl http://localhost:3010/health
```

## Error Codes

| Code | Description |
|------|-------------|
| MISSING_FILENAME | Audio file must have a filename |
| INVALID_AUDIO_FORMAT | Unsupported audio format |
| FILE_TOO_LARGE | File exceeds size limit |
| AUDIO_TOO_LONG | Audio exceeds duration limit |
| AUDIO_TOO_SHORT | Audio file is empty or too short |
| AUDIO_PROCESSING_ERROR | Failed to process audio |
| TRANSCRIPTION_FAILED | ASR inference failed |
| INTERNAL_ERROR | Unexpected server error |
