import { env } from '../../config/env';
import { LLMMessage, LLMTool, LLMResponse, LLMToolCall } from '../types';

export class NIMError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function serializeMessages(messages: LLMMessage[]): any[] {
  return messages.map((m) => {
    const out: any = { role: m.role };
    if (m.content && m.content.length > 0) {
      out.content = m.content;
    } else if (m.tool_calls && m.tool_calls.length > 0) {
      out.content = null;
    } else if (m.role === 'assistant') {
      out.content = null;
    } else {
      out.content = m.content ?? '';
    }
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.name) out.name = m.name;
    if (m.tool_calls && m.tool_calls.length > 0) out.tool_calls = m.tool_calls;
    return out;
  });
}

interface ChatCompletionsResponse {
  choices?: {
    message?: {
      content?: string | null;
      reasoning_content?: string;
      reasoning?: string;
      tool_calls?: LLMToolCall[];
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
}

export async function callChat(
  messages: LLMMessage[],
  tools?: LLMTool[],
  opts?: { maxTokens?: number; temperature?: number }
): Promise<LLMResponse> {
  if (!env.NVIDIA_API_KEY) {
    throw new NIMError('NVIDIA_API_KEY chưa được cấu hình trong .env', 503);
  }

  const maxTokens = opts?.maxTokens ?? env.AI_MAX_TOKENS;
  const temperature = opts?.temperature ?? env.AI_TEMPERATURE;
  const url = `${env.NVIDIA_BASE_URL.replace(/\/$/, '')}/chat/completions`;

  const payload: Record<string, any> = {
    model: env.AI_MODEL,
    messages: serializeMessages(messages),
    temperature,
    max_tokens: maxTokens,
  };
  if (tools && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }

  const maxRetries = 30;
  const baseDelay = 2000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.AI_HTTP_TIMEOUT_MS);

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.name === 'AbortError') {
        throw new NIMError(`NIM request timeout sau ${env.AI_HTTP_TIMEOUT_MS}ms`, 504);
      }
      throw new NIMError(`Không kết nối được NVIDIA NIM: ${e?.message ?? e}`, 503);
    } finally {
      clearTimeout(timer);
    }

    if (resp.status === 429) {
      const waitTime = Math.min(baseDelay + attempt * 2000, 10000);
      await sleep(waitTime);
      continue;
    }
    if (resp.status >= 500 && resp.status <= 504 && attempt < 6) {
      const waitTime = Math.min(baseDelay + attempt * 1000, 8000);
      await sleep(waitTime);
      continue;
    }

    const body: ChatCompletionsResponse = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new NIMError(
        body.error?.message ?? `NVIDIA NIM trả về HTTP ${resp.status}`,
        resp.status
      );
    }
    if (body.error) {
      throw new NIMError(body.error.message ?? 'Lỗi không xác định từ NVIDIA NIM');
    }

    const choice = body.choices?.[0];
    const message = choice?.message;
    const finishReason = choice?.finish_reason ?? '';

    return {
      content: message?.content ?? '',
      reasoning: message?.reasoning_content ?? message?.reasoning ?? undefined,
      toolCalls: message?.tool_calls ?? [],
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      finishReason,
      truncated: finishReason === 'length',
    };
  }

  throw new NIMError('NVIDIA NIM quá tải (HTTP 429 liên tục) — vui lòng thử lại sau', 429);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}