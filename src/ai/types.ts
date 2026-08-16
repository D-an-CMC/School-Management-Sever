export type UserRole = 'Admin' | 'GiaoVien' | 'HocSinh-PhuHuynh';

export interface ToolContext {
  userId: number;
  role: UserRole;
  email: string;
  userName?: string;
  studentId?: number;
  teacherId?: number;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute(ctx: ToolContext, args: Record<string, any>): Promise<string>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  all(): Tool[] {
    return [...this.tools.values()];
  }

  toLLM(): LLMTool[] {
    return this.all().map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
}

export interface LLMToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface LLMTool {
  type: string;
  function: { name: string; description: string; parameters: Record<string, any> };
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: LLMToolCall[];
}

export interface LLMResponse {
  content: string;
  reasoning?: string;
  toolCalls: LLMToolCall[];
  error?: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
  truncated: boolean;
}

export interface AgentStepData {
  columns?: string[];
  rows?: unknown[][];
  rowCount?: number;
  limited?: number;
  sql?: string;
  error?: string;
}

export interface AgentStep {
  tool: string;
  summary: string;
  data?: AgentStepData;
}

export interface AgentResult {
  answer: string;
  steps: AgentStep[];
  citations: { source_file: string; title: string; page_number?: number | null; chunk_index?: number }[];
  warnings: string[];
}