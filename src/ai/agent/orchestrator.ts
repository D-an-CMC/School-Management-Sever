import { env } from '../../config/env';
import { callChat } from '../llm/nim.client';
import { ToolRegistry, ToolContext, LLMMessage, AgentResult, AgentStep, AgentStreamEvent } from '../types';

interface RunOptions {
  systemPrompt: string;
  question: string;
  history?: { role: string; content: string }[];
  registry: ToolRegistry;
  ctx: ToolContext;
  /** Nhận sự kiện real-time để streaming lên UI (SSE) */
  emit?: (event: AgentStreamEvent) => void;
}

function summarizeToolResult(toolName: string, raw: string, maxLen = 220): { summary: string; data?: any } {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.rows)) {
      return {
        summary: `${parsed.rows.length} dòng`,
        data: {
          columns: parsed.columns,
          rows: parsed.rows,
          rowCount: parsed.rowCount,
          limited: parsed.limited,
          sql: parsed.sql,
        },
      };
    }
    if (parsed.rowCount != null) {
      const action = parsed.ok && parsed.action ? `${String(parsed.action)} ${parsed.table}: ${parsed.rowCount} dòng` : `${parsed.rowCount} dòng`;
      return { summary: action, data: parsed };
    }
    if (parsed.results && Array.isArray(parsed.results)) {
      return { summary: `${parsed.results.length} kết quả` };
    }
    if (parsed.error) {
      return { summary: `lỗi: ${String(parsed.error).slice(0, 120)}`, data: { error: String(parsed.error) } };
    }
    if (parsed.table && Array.isArray(parsed.columns) && parsed.columns.some((c) => typeof c === 'object')) {
      // read_table: {table, columns:[{name,...}], constraints:[], sample:{rows}}
      const cons = Array.isArray(parsed.constraints) ? parsed.constraints.length : 0;
      const sampleRows = parsed.sample?.rows?.length ?? 0;
      return { summary: `${parsed.columns.length} cột, ${cons} ràng buộc, ${sampleRows} dòng mẫu` };
    }
    if (parsed.columns) return { summary: `${parsed.columns.length} cột` };
  } catch {
    /* không phải JSON */
  }
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  return { summary: trimmed.length > maxLen ? trimmed.slice(0, maxLen) + '…' : trimmed };
}

export async function runAgent(opts: RunOptions): Promise<AgentResult> {
  const { registry, ctx, emit } = opts;
  const tools = registry.toLLM();

  const messages: LLMMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    ...opts.history!.slice(-env.AI_MAX_HISTORY).map((h) => ({
      role: (h.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: h.content,
    })),
    { role: 'user', content: opts.question },
  ];

  const steps: AgentStep[] = [];
  const citations: AgentResult['citations'] = [];
  const warnings: string[] = [];

  let maxTokens = env.AI_MAX_TOKENS;
  const totalTurns = env.AI_MAX_TURNS;

  for (let turn = 0; turn < totalTurns; turn++) {
    let resp;
    try {
      resp = await callChat(messages, tools, { maxTokens });
    } catch (e: any) {
      // M2: lỗi transient (NIM gián đoạn) — báo lại có ngữ cảnh, không để exception
      // giết conversation.
      warnings.push(`Lỗi gọi AI ở vòng ${turn + 1}: ${e?.message ?? e}`);
      return {
        answer:
          'Xin lỗi, dịch vụ AI đang bận — tôi chưa xử lý được câu hỏi. Vui lòng thử lại sau ít phút.',
        steps,
        citations,
        warnings,
      };
    }

    if (resp.error) throw new Error(resp.error);

    // Escalate token budget khi bị cắt (finish_reason = length)
    if (resp.truncated && maxTokens < env.AI_MAX_TOKENS_CAP) {
      maxTokens = Math.min(maxTokens * 2, env.AI_MAX_TOKENS_CAP);
    }

    // Ghi lại "suy nghĩ" của AI (reasoning_content) thành step riêng biệt để
    // frontend hiển thị dạng THOUGHT message.
    if (resp.reasoning && resp.reasoning.trim().length > 0) {
      const thought = resp.reasoning.trim().replace(/\s+/g, ' ').slice(0, 800);
      steps.push({ tool: 'thought', summary: thought });
      emit?.({ type: 'thought', summary: thought });
    }

    if (!resp.toolCalls || resp.toolCalls.length === 0) {
      // Hoàn tất — trả lời cuối
      let answer = resp.content.trim();
      if (!answer) {
        warnings.push('AI trả về câu trả lời rỗng; vui lòng thử lại với câu hỏi rõ hơn.');
        answer = 'Xin lỗi, tôi chưa thể trả lời được câu hỏi này. Bạn có thể hỏi rõ hơn hoặc cụ thể hơn không?';
      }
      return { answer, steps, citations, warnings };
    }

    // Thực thi từng tool
    for (const call of resp.toolCalls) {
      const tool = registry.get(call.function.name);
      if (!tool) {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [call],
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({ error: `Tool không tồn tại: ${call.function.name}` }),
        });
        continue;
      }

      let args: Record<string, any> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }

      let result: string;
      try {
        result = await tool.execute(ctx, args);
      } catch (e: any) {
        result = JSON.stringify({ error: `Lỗi tool: ${e?.message ?? e}` });
      }

      // Ghi lại steps + citations (từ rag_search). steps.data chứa dữ liệu thật
      // (columns/rows) để frontend render bảng/chart — giới hạn ≤ 100 dòng mỗi step.
      const parsed = summarizeToolResult(tool.name, result);
      const data = parsed.data;
      if (data && Array.isArray(data.rows) && data.rows.length > 100) {
        data.rows = data.rows.slice(0, 100);
      }
      steps.push({
        tool: tool.name,
        summary: parsed.summary,
        data: data ? { ...data } : undefined,
      });
      emit?.({
        type: 'tool',
        tool: tool.name,
        summary: parsed.summary,
        data: data
          ? {
              ...data,
              rows: Array.isArray(data.rows) ? data.rows.slice(0, 100) : undefined,
            }
          : undefined,
      });

      if (tool.name === 'rag_search') {
        try {
          const parsed = JSON.parse(result);
          if (parsed.results) {
            for (const r of parsed.results) {
              citations.push({
                source_file: r.source_file,
                title: r.title,
                chunk_index: r.chunk_index,
              });
            }
          }
        } catch {
          /* ignore */
        }
      }

      messages.push({ role: 'assistant', content: null, tool_calls: [call] });
      // M2: tool result đẩy thẳng vào history — cắt ≤ 4000 ký tự để khỏi thổi token
      // window khi SQL trả về hàng nghìn dòng.
      const truncated = result.length > 4000 ? result.slice(0, 4000) + '\n…(bị cắt)' : result;
      messages.push({ role: 'tool', tool_call_id: call.id, name: tool.name, content: truncated });
    }
  }

  warnings.push('Đã đạt giới hạn số vòng xử lý — câu trả lời có thể chưa đầy đủ.');
  return {
    answer:
      'Xin lỗi, tôi cần xử lý thêm để trả lời chính xác. Bạn có thể hỏi lại với phạm vi nhỏ hơn được không?',
    steps,
    citations,
    warnings,
  };
}