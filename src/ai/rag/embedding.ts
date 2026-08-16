import { env } from '../../config/env';
import { NIMError } from '../llm/nim.client';

let lastRequestAt = 0;

async function rateLimit() {
  const minGap = 100; // max 1 request / 100ms (giống reference Go)
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < minGap) {
    await new Promise((r) => setTimeout(r, minGap - elapsed));
  }
  lastRequestAt = Date.now();
}

export interface EmbedResponse {
  data: { embedding: number[]; index: number }[];
}

export async function embedNim(
  texts: string[],
  inputType: 'passage' | 'query'
): Promise<number[][]> {
  if (!env.NVIDIA_API_KEY) {
    throw new NIMError('NVIDIA_API_KEY chưa được cấu hình trong .env', 503);
  }
  if (texts.length === 0) return [];

  const truncated = texts.map((t) => (t.length > 16384 ? t.slice(0, 16384) : t));
  const url = `${env.NVIDIA_BASE_URL.replace(/\/$/, '')}/embeddings`;
  const batchSize = 32;
  const results: number[][] = [];

  for (let i = 0; i < truncated.length; i += batchSize) {
    const batch = truncated.slice(i, i + batchSize);
    await rateLimit();

    const payload = {
      model: env.AI_EMBED_MODEL,
      input: batch,
      input_type: inputType,
      encoding_format: 'float',
    };

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (e: any) {
      throw new NIMError(`Không kết nối được NVIDIA NIM embeddings: ${e?.message ?? e}`, 503);
    }

    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new NIMError(
        body?.error?.message ?? `NIM embeddings trả về HTTP ${resp.status}`,
        resp.status
      );
    }

    const data: { embedding: number[]; index: number }[] = body?.data ?? [];
    if (data.length !== batch.length) {
      throw new NIMError('NIM embeddings trả về thiếu vector');
    }
    const sorted = [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    results.push(...sorted);
  }

  return results;
}

export function vectorToPg(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}