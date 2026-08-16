import { queryPool } from '../../config/pg';
import { vectorToPg } from './embedding';

export interface DocumentChunk {
  source_name: string;
  title: string;
  chunk_index: number;
  content: string;
  embedding: number[];
}

export interface ChunkHit {
  source_file: string;
  title: string;
  chunk_index: number;
  content: string;
  score: number;
}

export async function upsertChunks(chunks: DocumentChunk[]): Promise<void> {
  if (chunks.length === 0) return;
  for (const c of chunks) {
    await queryPool(
      `INSERT INTO public.ai_documents (source_name, title, chunk_index, content, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (source_name, chunk_index)
       DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, embedding = EXCLUDED.embedding`,
      [c.source_name, c.title, c.chunk_index, c.content, vectorToPg(c.embedding)]
    );
  }
}

export async function similaritySearch(
  queryEmbedding: number[],
  k: number = 4,
  minScore: number = 0.25
): Promise<ChunkHit[]> {
  const { rows } = await queryPool<{
    source_name: string;
    title: string;
    chunk_index: number;
    content: string;
    score: string;
  }>(
    `SELECT source_name, title, chunk_index, content, 1 - (embedding <=> $1::vector) AS score
     FROM public.ai_documents
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vectorToPg(queryEmbedding), k]
  );
  return rows
    .filter((r) => Number(r.score) >= minScore)
    .map((r) => ({
      source_file: r.source_name,
      title: r.title,
      chunk_index: r.chunk_index,
      content: r.content,
      score: Number(r.score),
    }));
}

export async function ragStatus(): Promise<{ source: string; chunks: number }[]> {
  const { rows } = await queryPool<{ source: string; chunks: string }>(
    `SELECT source_name AS source, COUNT(*) AS chunks
     FROM public.ai_documents
     GROUP BY source_name
     ORDER BY source_name`
  );
  return rows.map((r) => ({ source: r.source, chunks: Number(r.chunks) }));
}

export async function ragTotalDocs(): Promise<number> {
  const { rows } = await queryPool<{ count: string }>(
    `SELECT COUNT(*) AS count FROM public.ai_documents`
  );
  return Number(rows[0]?.count ?? 0);
}

export async function deleteSource(sourceName: string): Promise<void> {
  await queryPool(`DELETE FROM public.ai_documents WHERE source_name = $1`, [sourceName]);
}