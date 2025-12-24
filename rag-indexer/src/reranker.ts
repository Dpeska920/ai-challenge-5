import { AutoModelForSequenceClassification, AutoTokenizer } from "@xenova/transformers";
import type { SearchResult } from "./types";

// LLM config from environment
const LLM_API_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const LLM_API_KEY = process.env.OPENAI_API_KEY || "";
const LLM_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Cross-encoder model (Xenova ONNX version for transformers.js)
const RERANKER_MODEL = process.env.RERANKER_MODEL || "Xenova/bge-reranker-base";

export type RerankMode = "off" | "cross" | "llm";

export interface RerankResult extends SearchResult {
  originalScore: number;
  rerankScore?: number;
  llmRelevance?: number;
}

export interface RerankResponse {
  results: RerankResult[];
  tokensUsed?: {
    input: number;
    output: number;
    total: number;
  };
}

// Cross-encoder model and tokenizer
let rerankerModel: Awaited<ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>> | null = null;
let rerankerTokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null;

export async function initCrossEncoder(modelName?: string): Promise<void> {
  const model = modelName || RERANKER_MODEL;
  console.log(`[Reranker] Loading cross-encoder model: ${model}`);

  try {
    rerankerTokenizer = await AutoTokenizer.from_pretrained(model);
    rerankerModel = await AutoModelForSequenceClassification.from_pretrained(model);
    console.log(`[Reranker] Cross-encoder model loaded: ${model}`);
  } catch (error) {
    console.error(`[Reranker] Failed to load cross-encoder model:`, error);
    throw error;
  }
}

export function isCrossEncoderReady(): boolean {
  return rerankerModel !== null && rerankerTokenizer !== null;
}

// Score a single query-passage pair using cross-encoder
async function scorePassage(query: string, passage: string): Promise<number> {
  if (!rerankerModel || !rerankerTokenizer) {
    throw new Error("Cross-encoder not loaded");
  }

  // For @xenova/transformers, pass query and passage as separate arguments (text, text_pair)
  const inputs = await rerankerTokenizer(query, {
    text_pair: passage,
    padding: true,
    truncation: true,
    max_length: 512,
  });

  const output = await rerankerModel(inputs);

  // Extract score from logits - it's a single value per pair
  const logits = output.logits;
  const score = logits?.data?.[0] ?? 0;

  return score;
}

// ==================== QUERY EXPANSION ====================
// Generate multiple search queries from user's original query
export interface QueryExpansionResult {
  queries: string[];
  tokensUsed?: {
    input: number;
    output: number;
    total: number;
  };
}

export async function expandQuery(originalQuery: string): Promise<QueryExpansionResult> {
  if (!LLM_API_KEY) {
    console.warn("[Reranker] LLM API key not set, skipping query expansion");
    return { queries: [originalQuery] };
  }

  const prompt = `You are a search query optimizer. Given a user's question, generate 3 different search queries that would help find relevant information in a knowledge base.

User question: "${originalQuery}"

Rules:
- Generate 3 semantically different but related queries
- Include synonyms and related terms
- Keep queries concise (3-8 words each)
- Focus on key concepts from the question
- Use the same language as the original question

Respond ONLY with a JSON array of 3 strings, e.g. ["query1", "query2", "query3"]. No explanation.`;

  try {
    const response = await fetch(`${LLM_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "[]";

    const usage = data.usage;
    const tokensUsed = usage ? {
      input: usage.prompt_tokens ?? 0,
      output: usage.completion_tokens ?? 0,
      total: usage.total_tokens ?? 0,
    } : undefined;

    // Parse queries array
    const match = content.match(/\[[\s\S]*?\]/);
    if (!match) {
      throw new Error("Could not parse queries from: " + content);
    }

    const queries: string[] = JSON.parse(match[0]);

    console.log(`[Reranker] Query expansion: "${originalQuery}" -> ${queries.length} queries (tokens: ${tokensUsed?.total ?? 'N/A'})`);
    console.log(`[Reranker] Expanded queries: ${queries.join(" | ")}`);

    return { queries, tokensUsed };
  } catch (error) {
    console.error("[Reranker] Query expansion failed:", error);
    return { queries: [originalQuery] };
  }
}

// ==================== CROSS-ENCODER RERANKING (BGE-RERANKER) ====================
// Use Xenova/bge-reranker-base for neural reranking
async function crossEncoderRerank(
  query: string,
  results: SearchResult[],
  limit: number
): Promise<RerankResponse> {
  if (results.length === 0) return { results: [] };

  if (!rerankerModel || !rerankerTokenizer) {
    console.warn("[Reranker] Cross-encoder not loaded, returning original order");
    return {
      results: results.slice(0, limit).map((r) => ({
        ...r,
        originalScore: r.score,
      })),
    };
  }

  try {
    const scored: RerankResult[] = [];

    for (const result of results) {
      try {
        // Use helper function to score query-passage pair
        const score = await scorePassage(query, result.text.slice(0, 512));

        scored.push({
          ...result,
          originalScore: result.score,
          rerankScore: score,
        });
      } catch (err) {
        console.error("[Reranker] Error scoring passage:", err);
        scored.push({
          ...result,
          originalScore: result.score,
          rerankScore: -999,
        });
      }
    }

    // Sort by rerank score (higher = better), take top N
    const sorted = scored
      .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))
      .slice(0, limit);

    console.log(
      `[Reranker] Cross-encoder (bge): ${results.length} -> ${sorted.length} (top score: ${sorted[0]?.rerankScore?.toFixed(3)})`
    );

    return { results: sorted };
  } catch (error) {
    console.error("[Reranker] Cross-encoder reranking failed:", error);
    return {
      results: results.slice(0, limit).map((r) => ({
        ...r,
        originalScore: r.score,
      })),
    };
  }
}

// ==================== LLM-BASED RERANKING ====================
// Ask LLM to score relevance directly - most accurate but slowest
async function llmRerank(
  query: string,
  results: SearchResult[],
  limit: number
): Promise<RerankResponse> {
  if (!LLM_API_KEY) {
    console.warn("[Reranker] LLM API key not set, returning original order");
    return {
      results: results.slice(0, limit).map((r) => ({
        ...r,
        originalScore: r.score,
      })),
    };
  }

  if (results.length === 0) return { results: [] };

  // Build passages for LLM
  const passages = results
    .map((r, i) => {
      const preview = r.text.slice(0, 400).replace(/\n+/g, " ");
      return `[${i + 1}] ${preview}`;
    })
    .join("\n\n");

  const prompt = `You are a relevance scoring assistant. Given a user query and passages, rate EACH passage's relevance to the query on a scale of 0-10.

Query: "${query}"

Passages:
${passages}

Respond ONLY with a JSON array of scores in the same order, e.g. [8, 5, 2, 9, 0]. No explanation needed.`;

  try {
    const response = await fetch(`${LLM_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "[]";

    // Extract token usage from API response
    const usage = data.usage;
    const tokensUsed = usage ? {
      input: usage.prompt_tokens ?? 0,
      output: usage.completion_tokens ?? 0,
      total: usage.total_tokens ?? 0,
    } : undefined;

    // Parse scores
    const match = content.match(/\[[\d,\s]+\]/);
    if (!match) {
      throw new Error("Could not parse LLM scores from: " + content);
    }

    const llmScores: number[] = JSON.parse(match[0]);

    // Apply LLM scores
    const scored = results.map((r, i) => ({
      ...r,
      originalScore: r.score,
      llmRelevance: llmScores[i] ?? 0,
      rerankScore: (llmScores[i] ?? 0) / 10, // Normalize to 0-1
    }));

    // Sort by LLM relevance, filter out zeros, take top N
    const sorted = scored
      .filter((r) => (r.llmRelevance ?? 0) > 0)
      .sort((a, b) => (b.llmRelevance ?? 0) - (a.llmRelevance ?? 0))
      .slice(0, limit);

    console.log(
      `[Reranker] LLM: ${results.length} -> ${sorted.length} (scores: ${llmScores.join(", ")}, tokens: ${tokensUsed?.total ?? 'N/A'})`
    );

    // If LLM filtered everything, return original order
    if (sorted.length === 0) {
      console.warn("[Reranker] LLM filtered all results, returning original order");
      return {
        results: results.slice(0, limit).map((r) => ({
          ...r,
          originalScore: r.score,
        })),
        tokensUsed,
      };
    }

    return { results: sorted, tokensUsed };
  } catch (error) {
    console.error("[Reranker] LLM reranking failed:", error);
    return {
      results: results.slice(0, limit).map((r) => ({
        ...r,
        originalScore: r.score,
      })),
    };
  }
}

// ==================== MAIN RERANK FUNCTION ====================
export async function rerank(
  query: string,
  results: SearchResult[],
  mode: RerankMode,
  limit: number = 3
): Promise<RerankResponse> {
  console.log(`[Reranker] Mode: ${mode}, Input: ${results.length} results`);

  switch (mode) {
    case "off":
      // No reranking - just return as-is with metadata
      return {
        results: results.slice(0, limit).map((r) => ({
          ...r,
          originalScore: r.score,
        })),
      };

    case "cross":
      // Use BGE cross-encoder for reranking
      return crossEncoderRerank(query, results, limit);

    case "llm":
      // LLM scores relevance directly
      return llmRerank(query, results, limit);

    default:
      return {
        results: results.slice(0, limit).map((r) => ({
          ...r,
          originalScore: r.score,
        })),
      };
  }
}
