import { readdir, unlink, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import pdf from "pdf-parse";
import type { DocumentChunk, DocRecord } from "./types";
import { RecursiveCharacterTextSplitter } from "./textSplitter";
import { generateEmbeddings } from "./embeddings";

const SUPPORTED_EXTENSIONS = [".pdf", ".txt", ".md"];
const METADATA_FILE = ".rag-metadata.json";

export interface DocumentInfo {
  name: string;
  path: string;
  size: number;
  type: string;
  description: string;
  createdAt: Date;
}

export interface DocumentManagerConfig {
  docsPath: string;
  chunkSize: number;
  chunkOverlap: number;
}

interface DocumentMetadata {
  [filename: string]: {
    description: string;
    addedAt: string;
  };
}

let config: DocumentManagerConfig = {
  docsPath: "./docs",
  chunkSize: 500,
  chunkOverlap: 50,
};

export function initDocumentManager(cfg: DocumentManagerConfig) {
  config = cfg;
}

async function loadMetadata(): Promise<DocumentMetadata> {
  const metaPath = join(config.docsPath, METADATA_FILE);
  try {
    const content = await Bun.file(metaPath).text();
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveMetadata(metadata: DocumentMetadata): Promise<void> {
  const metaPath = join(config.docsPath, METADATA_FILE);
  await Bun.write(metaPath, JSON.stringify(metadata, null, 2));
}

export async function listDocuments(): Promise<DocumentInfo[]> {
  const documents: DocumentInfo[] = [];
  const metadata = await loadMetadata();

  try {
    const entries = await readdir(config.docsPath);

    for (const entry of entries) {
      if (entry === METADATA_FILE || entry === ".gitkeep") continue;

      const fullPath = join(config.docsPath, entry);
      const ext = extname(entry).toLowerCase();

      if (SUPPORTED_EXTENSIONS.includes(ext)) {
        const stats = await stat(fullPath);
        documents.push({
          name: entry,
          path: fullPath,
          size: stats.size,
          type: ext.slice(1).toUpperCase(),
          description: metadata[entry]?.description || "",
          createdAt: stats.birthtime,
        });
      }
    }
  } catch (error) {
    console.error("[DocManager] Error listing documents:", error);
  }

  return documents.sort((a, b) => a.name.localeCompare(b.name));
}

export async function addDocument(
  filename: string,
  content: Buffer | string,
  description: string = ""
): Promise<{ success: boolean; message: string }> {
  const ext = extname(filename).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return {
      success: false,
      message: `Unsupported file type: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`,
    };
  }

  const cleanFilename = basename(filename);
  const filePath = join(config.docsPath, cleanFilename);

  try {
    await Bun.write(filePath, content);

    // Save description to metadata
    const metadata = await loadMetadata();
    metadata[cleanFilename] = {
      description: description.trim(),
      addedAt: new Date().toISOString(),
    };
    await saveMetadata(metadata);

    return { success: true, message: `Document '${cleanFilename}' added successfully` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to save document: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

export async function deleteDocument(
  filename: string
): Promise<{ success: boolean; message: string }> {
  const cleanFilename = basename(filename);
  const filePath = join(config.docsPath, cleanFilename);

  try {
    await unlink(filePath);

    // Remove from metadata
    const metadata = await loadMetadata();
    delete metadata[cleanFilename];
    await saveMetadata(metadata);

    return { success: true, message: `Document '${cleanFilename}' deleted successfully` };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: false, message: `Document '${cleanFilename}' not found` };
    }
    return {
      success: false,
      message: `Failed to delete document: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function loadDocumentContent(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    const buffer = await Bun.file(filePath).arrayBuffer();
    const data = await pdf(Buffer.from(buffer));
    return data.text;
  }

  return await Bun.file(filePath).text();
}

export async function indexAllDocuments(): Promise<DocRecord[]> {
  console.log("[DocManager] Starting full reindex...");

  const documents = await listDocuments();

  if (documents.length === 0) {
    console.log("[DocManager] No documents to index");
    return [];
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  });

  const allChunks: DocumentChunk[] = [];

  for (const doc of documents) {
    try {
      console.log(`[DocManager] Processing: ${doc.name} (${doc.description || "no description"})`);
      const content = await loadDocumentContent(doc.path);

      if (content.trim()) {
        const textChunks = splitter.split(content);

        for (let i = 0; i < textChunks.length; i++) {
          allChunks.push({
            text: textChunks[i],
            source: doc.name,
            description: doc.description,
            chunkIndex: i,
          });
        }
      }
    } catch (error) {
      console.error(`[DocManager] Error processing ${doc.name}:`, error);
    }
  }

  console.log(`[DocManager] Split ${documents.length} documents into ${allChunks.length} chunks`);

  if (allChunks.length === 0) {
    return [];
  }

  // Generate embeddings
  console.log("[DocManager] Generating embeddings...");
  const texts = allChunks.map((c) => c.text);
  const embeddings = await generateEmbeddings(texts, 32, (current, total) => {
    if (current % 10 === 0 || current === total) {
      console.log(`[DocManager] Embeddings progress: ${current}/${total}`);
    }
  });

  // Create records
  const records: DocRecord[] = allChunks.map((chunk, i) => ({
    id: `${chunk.source}-${chunk.chunkIndex}`,
    vector: embeddings[i],
    text: chunk.text,
    source: chunk.source,
    description: chunk.description,
    chunkIndex: chunk.chunkIndex,
    createdAt: new Date().toISOString(),
  }));

  console.log(`[DocManager] Indexing complete: ${records.length} records`);
  return records;
}
