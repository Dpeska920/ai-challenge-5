import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

let embeddingPipeline: FeatureExtractionPipeline | null = null;

export async function initEmbeddings(modelName: string = "Xenova/all-MiniLM-L6-v2") {
  console.log(`Loading embedding model: ${modelName}`);
  embeddingPipeline = await pipeline("feature-extraction", modelName);
  console.log("Embedding model loaded");
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!embeddingPipeline) {
    throw new Error("Embedding pipeline not initialized. Call initEmbeddings first.");
  }

  const output = await embeddingPipeline(text, {
    pooling: "mean",
    normalize: true,
  });

  return Array.from(output.data);
}

export async function generateEmbeddings(
  texts: string[],
  batchSize: number = 32,
  onProgress?: (current: number, total: number) => void
): Promise<number[][]> {
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    for (const text of batch) {
      const embedding = await generateEmbedding(text);
      embeddings.push(embedding);
    }

    if (onProgress) {
      onProgress(Math.min(i + batchSize, texts.length), texts.length);
    }
  }

  return embeddings;
}

export function getEmbeddingDimension(): number {
  // all-MiniLM-L6-v2 produces 384-dimensional vectors
  return 384;
}
