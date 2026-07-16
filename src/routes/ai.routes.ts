import { Router } from 'express';
import { aiService } from '../services/ai.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/risk-warnings/stats', roleMiddleware(['Admin', 'GiaoVien']), async (_req, res) => {
  const result = await aiService.riskStats();
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

router.get('/risk-warnings', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  const classId = req.query.classId ? Number(req.query.classId) : undefined;
  const studentId = req.query.studentId ? Number(req.query.studentId) : undefined;
  const result = await aiService.riskWarnings({ classId, studentId });
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

router.get('/learning-predictions/:studentId', async (req: any, res) => {
  const result = await aiService.learningPredictions(Number(req.params.studentId));
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

router.get('/chat/conversations', async (req: any, res) => {
  const result = await aiService.chatbotConversations(req.user!.userId);
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

router.post('/chat/conversations', async (req: any, res) => {
  const result = await aiService.createConversation(req.user!.userId);
  if (!result.success) return res.status(400).json(result);
  return res.status(201).json(result);
});

router.post('/chat/conversations/:conversationId/messages', async (req: any, res) => {
  const result = await aiService.addMessage(Number(req.params.conversationId), {
    sender_type: 'ai',
    message_content: req.body.message,
  });
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

export default router;
