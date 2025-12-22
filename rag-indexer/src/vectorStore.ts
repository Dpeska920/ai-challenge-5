import * as lancedb from "@lancedb/lancedb";
import type { DocRecord, SearchResult } from "./types";
import { generateEmbedding, getEmbeddingDimension } from "./embeddings";

const TABLE_NAME = "documents";

let db: lancedb.Connection | null = null;
let table: lancedb.Table | null = null;

export async function initVectorStore(dataPath: string): Promise<void> {
  console.log(`Initializing LanceDB at: ${dataPath}`);
  db = await lancedb.connect(dataPath);
  console.log("LanceDB connected");
}

export async function createOrReplaceTable(records: DocRecord[]): Promise<void> {
  if (!db) {
    throw new Error("VectorStore not initialized. Call initVectorStore first.");
  }

  console.log(`Creating table with ${records.length} records...`);

  // Check if table exists and drop it
  const tables = await db.tableNames();
  if (tables.includes(TABLE_NAME)) {
    await db.dropTable(TABLE_NAME);
    console.log("Dropped existing table");
  }

  // Create new table with data
  table = await db.createTable(TABLE_NAME, records);
  console.log(`Table '${TABLE_NAME}' created with ${records.length} records`);
}

export async function openTable(): Promise<void> {
  if (!db) {
    throw new Error("VectorStore not initialized. Call initVectorStore first.");
  }

  const tables = await db.tableNames();
  if (!tables.includes(TABLE_NAME)) {
    throw new Error(`Table '${TABLE_NAME}' does not exist. Run indexer first.`);
  }

  table = await db.openTable(TABLE_NAME);
  console.log(`Opened table '${TABLE_NAME}'`);
}

export async function search(query: string, limit: number = 5): Promise<SearchResult[]> {
  if (!table) {
    throw new Error("Table not opened. Call openTable first.");
  }

  const queryVector = await generateEmbedding(query);

  const results = await table
    .vectorSearch(queryVector)
    .limit(limit)
    .toArray();

  return results.map((row) => ({
    text: row.text as string,
    source: row.source as string,
    description: (row.description as string) || "",
    score: row._distance as number,
  }));
}

// Search with relevance threshold (distance-based, lower is better)
// Distance 0 = perfect match, distance 1+ = less relevant
// Threshold 0.8 means: only return results with distance < 0.8
export async function searchWithThreshold(
  query: string,
  limit: number = 3,
  threshold: number = 0.8
): Promise<SearchResult[]> {
  const results = await search(query, limit * 2); // Get more results to filter

  // Filter by threshold (distance < threshold means relevant enough)
  const filtered = results.filter((r) => r.score < threshold);

  return filtered.slice(0, limit);
}

export async function getStats(): Promise<{ count: number; tables: string[] }> {
  if (!db) {
    throw new Error("VectorStore not initialized");
  }

  const tables = await db.tableNames();
  let count = 0;

  if (tables.includes(TABLE_NAME)) {
    const t = await db.openTable(TABLE_NAME);
    count = await t.countRows();
  }

  return { count, tables };
}

export async function reindexWithRecords(records: DocRecord[]): Promise<void> {
  if (!db) {
    throw new Error("VectorStore not initialized");
  }

  // Drop existing table if exists
  const tables = await db.tableNames();
  if (tables.includes(TABLE_NAME)) {
    await db.dropTable(TABLE_NAME);
  }

  if (records.length === 0) {
    table = null;
    console.log("[VectorStore] No records to index, table cleared");
    return;
  }

  // Create new table with data
  table = await db.createTable(TABLE_NAME, records);
  console.log(`[VectorStore] Reindexed with ${records.length} records`);
}

export function isTableReady(): boolean {
  return table !== null;
}
