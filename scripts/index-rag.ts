/**
 * Index RAG: đọc toàn bộ ai-docs/ (md/txt), chunk + embed bằng NVIDIA NIM,
 * upsert vào bảng ai_documents (pgvector).
 *
 * Chạy:  npm run index-rag
 * Yêu cầu: .env có NVIDIA_API_KEY + DATABASE_URL (đã chạy migration 018).
 */
import 'dotenv/config';
import * as path from 'path';
import { reindexAll } from '../src/ai/rag/indexer';

async function main() {
  const dir = path.join(process.cwd(), 'ai-docs');
  console.log(`[index-rag] Bắt đầu index ${dir} ...`);
  const results = await reindexAll(dir);
  for (const r of results) {
    console.log(`[index-rag] ${r.source}: ${r.chunks} chunks`);
  }
  const total = results.reduce((a, r) => a + r.chunks, 0);
  console.log(`[index-rag] HOÀN TẤT — ${results.length} tài liệu, ${total} chunks.`);
}

main().catch((e) => {
  console.error('[index-rag] THẤT BẠI:', e?.message ?? e);
  process.exit(1);
});