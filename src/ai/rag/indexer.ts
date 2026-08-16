import * as fs from 'fs';
import * as path from 'path';
import { embedNim } from './embedding';
import { upsertChunks, deleteSource } from './store';

export interface ChunkCandidate {
  source_name: string;
  title: string;
  chunk_index: number;
  content: string;
}

export function chunkMarkdown(text: string, maxLen: number = 800, overlap: number = 100): string[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const chunks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const content = current.join('\n').trim();
    if (content.length > 0) chunks.push(content);
    current = [];
  };

  for (const line of lines) {
    const isHeading = /^#{1,6}\s/.test(line);
    if (isHeading && current.length > 0) {
      flush();
      current.push(line);
      continue;
    }
    current.push(line);
    const joined = current.join('\n');
    if (joined.length >= maxLen) flush();
  }
  flush();

  const result: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    if (i > 0 && chunk.length < maxLen) {
      const prev = chunks[i - 1];
      const tail = prev.slice(-overlap);
      const head = tail.replace(/^[^\n]*\n/, '');
      chunk = (head.length > 0 ? head + '\n' : '') + chunk;
    }
    result.push(chunk);
  }

  if (result.length === 0 && text.trim().length > 0) {
    result.push(text.trim());
  }
  return result;
}

/** Đọc toàn bộ tài liệu trong thư mục (đệ quy), trả về danh sách chunk ứng viên. */
export function collectDocs(dir: string): { file: string; title: string; text: string }[] {
  if (!fs.existsSync(dir)) return [];
  const out: { file: string; title: string; text: string }[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.md', '.txt'].includes(ext)) continue;
      const text = fs.readFileSync(full, 'utf8');
      const title = entry.name.replace(/\.(md|txt)$/i, '');
      out.push({ file: entry.name, title, text });
    }
  };
  walk(dir);
  return out;
}

export async function indexDirectory(dir: string): Promise<{ source: string; chunks: number }[]> {
  const docs = collectDocs(dir);
  const indexed: { source: string; chunks: number }[] = [];

  for (const doc of docs) {
    const candidates: ChunkCandidate[] = chunkMarkdown(doc.text).map((content, i) => ({
      source_name: doc.file,
      title: doc.title,
      chunk_index: i,
      content,
    }));

    // Embed theo batch 32 (embedNim tự giới hạn tốc độ)
    const batchSize = 32;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      const embeddings = await embedNim(batch.map((c) => c.content), 'passage');
      await upsertChunks(
        batch.map((c, j) => ({ ...c, embedding: embeddings[j] }))
      );
    }
    indexed.push({ source: doc.file, chunks: candidates.length });
  }
  return indexed;
}

export async function reindexAll(dir: string): Promise<{ source: string; chunks: number }[]> {
  const docs = collectDocs(dir);
  const sources = new Set(docs.map((d) => d.file));
  for (const src of sources) {
    await deleteSource(src);
  }
  return indexDirectory(dir);
}