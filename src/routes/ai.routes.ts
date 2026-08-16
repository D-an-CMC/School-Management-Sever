import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
import { aiRateLimitMiddleware } from '../middleware/ai-rate-limit.middleware';
import { aiService } from '../services/ai.service';
import { getConversation } from '../ai/conversations';
import { success, error } from '../utils/response';

const router = Router();

const askSchema = z.object({
  question: z.string().min(1).max(4000),
  conversationId: z.coerce.number().int().positive().optional(),
});

// POST /api/ai/chat — hỏi AI (agentic + RAG), mọi role đã đăng nhập
router.post(
  '/chat',
  authMiddleware,
  aiRateLimitMiddleware,
  async (req: AuthRequest, res) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(error('Câu hỏi không hợp lệ.', 'INVALID_QUESTION'));
    }
    const user = req.user!;
    try {
      const data = await aiService.ask(
        {
          userId: user.userId,
          role: user.role as any,
          email: user.email,
          name: (user as any).name,
        },
        { question: parsed.data.question as string, conversationId: parsed.data.conversationId }
      );
      return res.json(success(data));
    } catch (e: any) {
      return res.status(500).json(error(e?.message ?? 'Lỗi AI service.', 'AI_ERROR'));
    }
  }
);

// POST /api/ai/chat/stream — hỏi AI với server-sent events:
// stream từng thought / tool call / done để UI hiển thị agent activity LIVE.
router.post(
  '/chat/stream',
  authMiddleware,
  aiRateLimitMiddleware,
  async (req: AuthRequest, res) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(error('Câu hỏi không hợp lệ.', 'INVALID_QUESTION'));
    }
    const user = req.user!;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`retry: 3000\n\n`);

    const send = (event: any) => {
      try {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {
        /* client đã đóng */
      }
    };

    const onClose = () => {
      res.end();
    };
    req.on('close', onClose);

    try {
      await aiService.askStream(
        {
          userId: user.userId,
          role: user.role as any,
          email: user.email,
          name: (user as any).name,
        },
        { question: parsed.data.question as string, conversationId: parsed.data.conversationId },
        send
      );
    } catch (e: any) {
      if (!res.writableEnded) {
        send({ type: 'error', message: e?.message ?? 'Lỗi AI service.' });
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  }
);

// GET /api/ai/conversations — danh sách hội thoại của user
router.get('/conversations', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const data = await aiService.list(req.user!.userId);
    return res.json(success(data));
  } catch (e: any) {
    return res.status(500).json(error(e?.message ?? 'Lỗi lấy danh sách hội thoại.', 'AI_ERROR'));
  }
});

// GET /api/ai/conversations/:id — chi tiết hội thoại kèm messages
router.get('/conversations/:id', authMiddleware, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json(error('ID hội thoại không hợp lệ.', 'INVALID_ID'));
  }
  try {
    const conv = await getConversation(id, req.user!.userId);
    if (!conv) {
      return res.status(404).json(error('Không tìm thấy hội thoại.', 'NOT_FOUND'));
    }
    const messages = await aiService.messages(req.user!.userId, id);
    return res.json(success({ conversationId: id, messages }));
  } catch (e: any) {
    return res.status(500).json(error(e?.message ?? 'Lỗi lấy hội thoại.', 'AI_ERROR'));
  }
});

// DELETE /api/ai/conversations/:id — xóa hội thoại (chủ sở hữu)
router.delete('/conversations/:id', authMiddleware, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json(error('ID hội thoại không hợp lệ.', 'INVALID_ID'));
  }
  try {
    const ok = await aiService.remove(req.user!.userId, id);
    if (!ok) return res.status(404).json(error('Không tìm thấy hội thoại.', 'NOT_FOUND'));
    return res.json(success({ deleted: true }));
  } catch (e: any) {
    return res.status(500).json(error(e?.message ?? 'Lỗi xóa hội thoại.', 'AI_ERROR'));
  }
});

// POST /api/ai/rag/sync — index lại tài liệu (Admin)
router.post(
  '/rag/sync',
  authMiddleware,
  roleMiddleware(['Admin']),
  async (_req: AuthRequest, res) => {
    try {
      const results = await aiService.syncRag();
      return res.json(success({ indexed: results }));
    } catch (e: any) {
      return res.status(500).json(error(e?.message ?? 'Lỗi index RAG.', 'AI_RAG_ERROR'));
    }
  }
);

// GET /api/ai/rag/status — trạng thái index (Admin)
router.get(
  '/rag/status',
  authMiddleware,
  roleMiddleware(['Admin']),
  async (_req: AuthRequest, res) => {
    try {
      const data = await aiService.status();
      return res.json(success(data));
    } catch (e: any) {
      return res.status(500).json(error(e?.message ?? 'Không đọc được trạng thái RAG.', 'AI_RAG_ERROR'));
    }
  }
);

export default router;