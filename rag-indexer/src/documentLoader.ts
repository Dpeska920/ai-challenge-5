import { readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import pdf from "pdf-parse";

interface LoadedDocument {
  content: string;
  source: string;
}

const SUPPORTED_EXTENSIONS = [".pdf", ".txt", ".md"];

async function findFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function scanDir(currentDir: string) {
    const entries = await readdir(currentDir);

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        await scanDir(fullPath);
      } else if (stats.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  await scanDir(dir);
  return files;
}

async function loadPdf(filePath: string): Promise<string> {
  const buffer = await Bun.file(filePath).arrayBuffer();
  const data = await pdf(Buffer.from(buffer));
  return data.text;
}

async function loadText(filePath: string): Promise<string> {
  return await Bun.file(filePath).text();
}

async function loadDocument(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case ".pdf":
      return loadPdf(filePath);
    case ".txt":
    case ".md":
      return loadText(filePath);
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}

export async function loadDocuments(docsPath: string): Promise<LoadedDocument[]> {
  console.log(`Scanning directory: ${docsPath}`);

  const files = await findFiles(docsPath);
  console.log(`Found ${files.length} documents`);

  const documents: LoadedDocument[] = [];

  for (const filePath of files) {
    try {
      console.log(`Loading: ${filePath}`);
      const content = await loadDocument(filePath);

      if (content.trim()) {
        documents.push({
          content: content.trim(),
          source: filePath,
        });
      }
    } catch (error) {
      console.error(`Error loading ${filePath}:`, error);
    }
  }

  console.log(`Successfully loaded ${documents.length} documents`);
  return documents;
}
