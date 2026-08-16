import * as path from 'path';
import * as fs from 'fs';
import { env } from '../config/env';
import { ToolRegistry, ToolContext, UserRole } from '../ai/types';
import { sqlTool } from '../ai/tools/sql.tool';
import { writeSqlTool } from '../ai/tools/write.tool';
import { listTablesTool, searchColumnsTool, readTableTool } from '../ai/tools/db-read.tool';
import { dbSchemaTool } from '../ai/tools/schema.tool';
import { ragTool } from '../ai/tools/rag.tool';
import {
  getCurrentContextTool,
  getStudentReportTool,
  getClassSummaryTool,
  getAttendanceReportTool,
  getScheduleTool,
  getExamScheduleTool,
} from '../ai/tools/insight.tool';
import { runAgent } from '../ai/agent/orchestrator';
import { buildSystemPrompt } from '../ai/agent/prompts';
import { AgentStreamEvent } from '../ai/types';
import { queryPool } from '../config/pg';
import {
  createConversation,
  listConversations,
  getConversation,
  listMessages,
  deleteConversation,
  appendMessage,
  touchConversationTitle,
} from '../ai/conversations';
import { reindexAll } from '../ai/rag/indexer';
import { ragStatus } from '../ai/rag/store';
import { NIMError } from '../ai/llm/nim.client';

export interface AskInput {
  question: string;
  conversationId?: number;
}

function aiDocsDir(): string {
  const candidates = [
    path.join(process.cwd(), 'ai-docs'),
    path.join(__dirname, '..', '..', 'ai-docs'),
    path.join(__dirname, '..', '..', '..', 'ai-docs'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export class AiService {
  private registry: ToolRegistry;

  constructor() {
    this.registry = new ToolRegistry();
    this.registry.register(sqlTool);
    this.registry.register(writeSqlTool);
    this.registry.register(listTablesTool);
    this.registry.register(searchColumnsTool);
    this.registry.register(readTableTool);
    this.registry.register(dbSchemaTool);
    this.registry.register(ragTool);
    this.registry.register(getCurrentContextTool);
    this.registry.register(getStudentReportTool);
    this.registry.register(getClassSummaryTool);
    this.registry.register(getAttendanceReportTool);
    this.registry.register(getScheduleTool);
    this.registry.register(getExamScheduleTool);
  }

  async resolveUserContext(
    userId: number,
    role: UserRole,
    email: string,
    userName?: string
  ): Promise<ToolContext> {
    const ctx: ToolContext = { userId, role, email, userName };
    if (!env.DATABASE_URL) return ctx;
    try {
      if (role === 'HocSinh-PhuHuynh') {
        const { rows } = await queryPool<{ student_id: number }>(
          `SELECT student_id FROM public.students WHERE user_id = $1 LIMIT 1`,
          [userId]
        );
        if (rows[0]) ctx.studentId = rows[0].student_id;
      } else if (role === 'GiaoVien') {
        const { rows } = await queryPool<{ teacher_id: number }>(
          `SELECT teacher_id FROM public.teachers WHERE user_id = $1 LIMIT 1`,
          [userId]
        );
        if (rows[0]) ctx.teacherId = rows[0].teacher_id;
      }
    } catch {
      /* không chặn khi DB tạm lỗi */
    }
    return ctx;
  }

  /** Chạy agent + lưu lịch sử; emit() nhận sự kiện real-time nếu dùng streaming. */
  private async runCore(
    user: { userId: number; role: UserRole; email: string; name?: string },
    input: AskInput,
    emit?: (e: AgentStreamEvent) => void
  ) {
    if (!input.question || !input.question.trim()) {
      throw new Error('Vui lòng nhập câu hỏi.');
    }
    const question = input.question.trim().slice(0, 4000);
    const ctx = await this.resolveUserContext(user.userId, user.role, user.email, user.name);

    let conversationId = input.conversationId;
    if (conversationId) {
      const conv = await getConversation(conversationId, user.userId);
      if (!conv) {
        throw new Error('Hội thoại không tồn tại hoặc không thuộc về bạn.');
      }
    } else {
      conversationId = await createConversation(user.userId, question.slice(0, 60));
    }

    const history = await listMessages(conversationId, user.userId);
    const historyForAgent = history
      .slice(-env.AI_MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content }));

    // L5: chỉ ghi vào lịch sử khi agent chạy THÀNH CÔNG — trước đây lưu câu hỏi
    // trước khi chạy, lỗi AI thì lịch sử đầy câu hỏi mồ côi không có câu trả lời.

    let result;
    try {
      result = await runAgent({
        systemPrompt: buildSystemPrompt(ctx),
        question,
        history: historyForAgent,
        registry: this.registry,
        ctx,
        emit,
      });
    } catch (e: any) {
      if (e instanceof NIMError || e?.message?.includes('NVIDIA')) {
        throw new Error(
          `AI service tạm gián đoạn (${e.message}). Vui lòng thử lại sau vài giây.`
        );
      }
      if (e?.message?.includes('DATABASE_URL') || e?.message?.includes('getaddrinfo')) {
        throw new Error(
          'AI chưa được cấu hình kết nối cơ sở dữ liệu (DATABASE_URL). Vui lòng kiểm tra .env.'
        );
      }
      if (e?.message?.includes('ai_documents') || e?.message?.includes('ai_conversations') || e?.message?.includes('relation')) {
        throw new Error(
          'Cơ sở dữ liệu AI chưa được khởi tạo. Chạy "npm run migrate" để tạo bảng (migration 018).'
        );
      }
      throw e;
    }

    await appendMessage(conversationId, 'user', question);
    await appendMessage(conversationId, 'assistant', result.answer, result.steps, result.citations);
    await touchConversationTitle(conversationId, question);

    return {
      answer: result.answer,
      citations: result.citations,
      warnings: result.warnings,
      steps: result.steps,
      conversationId,
      role: user.role,
      userName: user.name,
    };
  }

  async ask(
    user: { userId: number; role: UserRole; email: string; name?: string },
    input: AskInput
  ) {
    return this.runCore(user, input);
  }

  /** Phiên bản streaming (SSE): emit từng sự kiện thought/tool/done khi xảy ra. */
  async askStream(
    user: { userId: number; role: UserRole; email: string; name?: string },
    input: AskInput,
    emit: (e: AgentStreamEvent) => void
  ) {
    const data = await this.runCore(user, input, emit);
    emit({
      type: 'done',
      answer: data.answer,
      steps: data.steps,
      citations: data.citations,
      warnings: data.warnings,
      conversationId: data.conversationId,
    });
    return data;
  }

  async list(userId: number) {
    return listConversations(userId);
  }

  async messages(userId: number, conversationId: number) {
    return listMessages(conversationId, userId);
  }

  async remove(userId: number, conversationId: number) {
    return deleteConversation(conversationId, userId);
  }

  /** Index lại toàn bộ ai-docs (Admin). */
  async syncRag(): Promise<{ source: string; chunks: number }[]> {
    const dir = aiDocsDir();
    if (!fs.existsSync(dir)) {
      throw new Error(
        `Thư mục tài liệu AI không tồn tại: ${dir}. Tạo thư mục ai-docs và đặt tài liệu (.md/.txt) vào rồi thử lại.`
      );
    }
    return reindexAll(dir);
  }

  async status() {
    const sources = await ragStatus();
    const total = sources.reduce((acc, s) => acc + s.chunks, 0);
    return { sources, total, docsDir: aiDocsDir() };
  }
}

export const aiService = new AiService();