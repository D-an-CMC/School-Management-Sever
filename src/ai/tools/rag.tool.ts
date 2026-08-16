import { Tool, ToolContext } from '../types';
import { embedNim } from '../rag/embedding';
import { similaritySearch } from '../rag/store';

export const ragTool: Tool = {
  name: 'rag_search',
  description:
    'Tìm kiếm ngữ nghĩa trong tài liệu nhà trường (quy chế, hướng dẫn, luồng nghiệp vụ, quy trình tuyển sinh, quy tắc điểm danh/đánh giá...). ' +
    'Dùng khi câu hỏi về quy định/chính sách/khái niệm nghiệp vụ, KHÔNG phải truy vấn dữ liệu số. Trả về các đoạn tài liệu phù hợp kèm nguồn.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Câu hỏi/khóa tìm kiếm ngắn gọn' },
      k: { type: 'number', description: 'Số kết quả tối đa (mặc định 4)' },
    },
    required: ['query'],
  },
  async execute(_ctx: ToolContext, args: Record<string, any>): Promise<string> {
    const query = String(args.query ?? '').trim();
    const k = Math.min(Math.max(Number(args.k) || 4, 1), 10);
    if (!query) return JSON.stringify({ error: 'Thiếu tham số query' });

    const embedding = await embedNim([query], 'query');
    const hits = await similaritySearch(embedding[0], k);

    return JSON.stringify({
      results: hits.map((h) => ({
        source_file: h.source_file,
        title: h.title,
        chunk_index: h.chunk_index,
        score: h.score,
        content: h.content,
      })),
    });
  },
};