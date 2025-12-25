export interface DocRecord {
  id: string;
  vector: number[];
  text: string;
  source: string;
  description: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  createdAt: string;
  [key: string]: unknown;
}

export interface DocumentChunk {
  text: string;
  source: string;
  description?: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
}

export interface SearchResult {
  text: string;
  source: string;
  description: string;
  score: number;
  startLine: number;
  endLine: number;
}

export interface IndexerConfig {
  docsPath: string;
  dataPath: string;
  chunkSize: number;
  chunkOverlap: number;
  modelName: string;
}
