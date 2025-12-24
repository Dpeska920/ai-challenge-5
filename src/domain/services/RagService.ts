export interface RagDocument {
  name: string;
  path: string;
  size: number;
  type: string;
  description: string;
  createdAt: string;
}

export interface RagSearchResult {
  text: string;
  source: string;
  description: string;
  relevance: string;
  rerankScore?: string;
  llmRelevance?: number;
}

export interface RagTokensUsed {
  input: number;
  output: number;
  total: number;
}

export interface RagSearchResponse {
  results: RagSearchResult[];
  tokensUsed?: RagTokensUsed;
  expandedQueries?: string[];
}

export type RerankMode = 'off' | 'cross' | 'llm';

export interface RagServiceConfig {
  apiUrl: string;
}

export class RagService {
  private apiUrl: string;

  constructor(config: RagServiceConfig) {
    this.apiUrl = config.apiUrl;
  }

  async listDocuments(): Promise<RagDocument[]> {
    try {
      const response = await fetch(`${this.apiUrl}/api/documents`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to list documents');
      }

      return data.documents;
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('RAG service unavailable');
      }
      throw error;
    }
  }

  async addDocument(
    filename: string,
    content: Buffer,
    description: string = ''
  ): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.apiUrl}/api/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename,
          content: content.toString('base64'),
          description,
        }),
      });

      const data = await response.json();
      return {
        success: data.success,
        message: data.message || data.error || 'Unknown response',
      };
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return { success: false, message: 'RAG service unavailable' };
      }
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async deleteDocument(filename: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.apiUrl}/api/documents/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      return {
        success: data.success,
        message: data.message || data.error || 'Unknown response',
      };
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return { success: false, message: 'RAG service unavailable' };
      }
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async reindex(): Promise<{ success: boolean; message: string; count?: number }> {
    try {
      const response = await fetch(`${this.apiUrl}/api/reindex`, {
        method: 'POST',
      });

      const data = await response.json();
      return {
        success: data.success,
        message: data.message || data.error || 'Unknown response',
        count: data.count,
      };
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return { success: false, message: 'RAG service unavailable' };
      }
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Search for relevant context based on user query
  // Returns empty array if nothing relevant found (below threshold)
  // rerankMode: 'off' | 'score' | 'cross' | 'llm'
  async searchContext(
    query: string,
    limit: number = 3,
    threshold: number = 0.8,
    rerankMode: RerankMode = 'off'
  ): Promise<RagSearchResponse> {
    try {
      const response = await fetch(`${this.apiUrl}/api/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit, threshold, rerankMode }),
      });

      const data = await response.json();

      if (!data.success) {
        return { results: [] };
      }

      return {
        results: data.results || [],
        tokensUsed: data.tokensUsed,
        expandedQueries: data.expandedQueries,
      };
    } catch (error) {
      // Silently fail - don't break the chat if RAG is unavailable
      return { results: [] };
    }
  }

  // Format RAG context for injection into AI prompt
  formatContextForPrompt(results: RagSearchResult[]): string | null {
    if (results.length === 0) {
      return null;
    }

    const contextParts = results.map((r, i) => {
      const header = r.description
        ? `[${i + 1}] ${r.source} (${r.description})`
        : `[${i + 1}] ${r.source}`;
      return `${header}\n${r.text}`;
    });

    return `Relevant context from documents:\n\n${contextParts.join('\n\n---\n\n')}`;
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
