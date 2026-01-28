import { log } from '../../utils/logger';

export interface TranscriptionResult {
  text: string;
  language: string;
  duration: number;
  processing_time_ms: number;
}

interface TranscriptionResponse {
  success: boolean;
  data: TranscriptionResult;
}

interface ErrorResponse {
  success: boolean;
  error: {
    code: string;
    message: string;
    details?: string;
  };
}

interface HealthResponse {
  status: string;
  model: {
    loaded: boolean;
    name: string;
  };
  memory: {
    used_gb: number;
    available_gb: number;
  };
}

export class MLServiceClient {
  constructor(private baseUrl: string) {}

  async transcribe(audioBuffer: Buffer, filename: string): Promise<TranscriptionResult> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/ogg' });
    formData.append('audio', blob, filename);

    log('info', 'Sending audio for transcription', {
      filename,
      size: audioBuffer.length,
      baseUrl: this.baseUrl,
    });

    const response = await fetch(`${this.baseUrl}/transcribe`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      let errorMessage = 'Transcription failed';
      try {
        const errorData = (await response.json()) as ErrorResponse;
        errorMessage = errorData.error?.message || errorMessage;
        log('error', 'Transcription failed', {
          code: errorData.error?.code,
          message: errorData.error?.message,
          details: errorData.error?.details,
        });
      } catch {
        log('error', 'Transcription failed with non-JSON response', {
          status: response.status,
          statusText: response.statusText,
        });
      }
      throw new Error(errorMessage);
    }

    const result = (await response.json()) as TranscriptionResponse;

    log('info', 'Transcription completed', {
      textLength: result.data.text.length,
      language: result.data.language,
      duration: result.data.duration,
      processingTime: result.data.processing_time_ms,
    });

    return result.data;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as HealthResponse;
      return data.status === 'healthy' && data.model.loaded;
    } catch (error) {
      log('warn', 'ML Service health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
