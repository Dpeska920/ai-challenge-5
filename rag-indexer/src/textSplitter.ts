import type { DocumentChunk } from "./types";

interface SplitterConfig {
  chunkSize: number;
  chunkOverlap: number;
  separators?: string[];
}

const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

export class RecursiveCharacterTextSplitter {
  private chunkSize: number;
  private chunkOverlap: number;
  private separators: string[];

  constructor(config: SplitterConfig) {
    this.chunkSize = config.chunkSize;
    this.chunkOverlap = config.chunkOverlap;
    this.separators = config.separators ?? DEFAULT_SEPARATORS;
  }

  private splitBySeparator(text: string, separator: string): string[] {
    if (separator === "") {
      return text.split("");
    }
    return text.split(separator);
  }

  private mergeSplits(splits: string[], separator: string): string[] {
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentLength = 0;

    for (const split of splits) {
      const splitLength = split.length + (currentChunk.length > 0 ? separator.length : 0);

      if (currentLength + splitLength > this.chunkSize && currentChunk.length > 0) {
        const chunk = currentChunk.join(separator);
        if (chunk.trim()) {
          chunks.push(chunk);
        }

        // Keep overlap
        while (currentLength > this.chunkOverlap && currentChunk.length > 1) {
          const removed = currentChunk.shift()!;
          currentLength -= removed.length + separator.length;
        }
      }

      currentChunk.push(split);
      currentLength += splitLength;
    }

    if (currentChunk.length > 0) {
      const chunk = currentChunk.join(separator);
      if (chunk.trim()) {
        chunks.push(chunk);
      }
    }

    return chunks;
  }

  private splitText(text: string, separators: string[]): string[] {
    const finalChunks: string[] = [];

    let separator = separators[separators.length - 1];
    let newSeparators: string[] = [];

    for (let i = 0; i < separators.length; i++) {
      const sep = separators[i];
      if (sep === "" || text.includes(sep)) {
        separator = sep;
        newSeparators = separators.slice(i + 1);
        break;
      }
    }

    const splits = this.splitBySeparator(text, separator);
    const goodSplits: string[] = [];

    for (const split of splits) {
      if (split.length < this.chunkSize) {
        goodSplits.push(split);
      } else {
        if (goodSplits.length > 0) {
          const mergedChunks = this.mergeSplits(goodSplits, separator);
          finalChunks.push(...mergedChunks);
          goodSplits.length = 0;
        }

        if (newSeparators.length === 0) {
          finalChunks.push(split);
        } else {
          const otherChunks = this.splitText(split, newSeparators);
          finalChunks.push(...otherChunks);
        }
      }
    }

    if (goodSplits.length > 0) {
      const mergedChunks = this.mergeSplits(goodSplits, separator);
      finalChunks.push(...mergedChunks);
    }

    return finalChunks;
  }

  split(text: string): string[] {
    return this.splitText(text, this.separators);
  }
}

// Count lines up to a position in text
function countLinesUpTo(text: string, position: number): number {
  let count = 1; // Lines are 1-indexed
  for (let i = 0; i < position && i < text.length; i++) {
    if (text[i] === '\n') count++;
  }
  return count;
}

// Count lines in a string
function countLines(text: string): number {
  let count = 1;
  for (const char of text) {
    if (char === '\n') count++;
  }
  return count;
}

export function splitDocuments(
  documents: { content: string; source: string }[],
  config: SplitterConfig
): DocumentChunk[] {
  const splitter = new RecursiveCharacterTextSplitter(config);
  const chunks: DocumentChunk[] = [];

  for (const doc of documents) {
    const textChunks = splitter.split(doc.content);
    let searchStart = 0;

    for (let i = 0; i < textChunks.length; i++) {
      const chunkText = textChunks[i];

      // Find chunk position in original text (starting from last found position)
      const position = doc.content.indexOf(chunkText, searchStart);

      let startLine = 1;
      let endLine = 1;

      if (position !== -1) {
        startLine = countLinesUpTo(doc.content, position);
        endLine = startLine + countLines(chunkText) - 1;
        // Move search start forward (but account for overlap)
        searchStart = position + 1;
      }

      chunks.push({
        text: chunkText,
        source: doc.source,
        chunkIndex: i,
        startLine,
        endLine,
      });
    }
  }

  console.log(`Split ${documents.length} documents into ${chunks.length} chunks`);
  return chunks;
}
