import { queryPool } from '../config/pg';

export interface ConversationRow {
  conversation_id: number;
  user_id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  message_id: number;
  conversation_id: number;
  role: string;
  content: string;
  tools_used: any[];
  citations: any[];
  created_at: string;
}

export async function createConversation(userId: number, title?: string | null): Promise<number> {
  const { rows } = await queryPool<{ conversation_id: number }>(
    `INSERT INTO public.ai_conversations (user_id, title)
     VALUES ($1, $2)
     RETURNING conversation_id`,
    [userId, title ?? null]
  );
  return rows[0].conversation_id;
}

export async function listConversations(userId: number, limit: number = 50): Promise<ConversationRow[]> {
  const { rows } = await queryPool<ConversationRow>(
    `SELECT conversation_id, user_id, title, created_at, updated_at
     FROM public.ai_conversations
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function getConversation(
  conversationId: number,
  userId: number
): Promise<ConversationRow | null> {
  const { rows } = await queryPool<ConversationRow>(
    `SELECT conversation_id, user_id, title, created_at, updated_at
     FROM public.ai_conversations
     WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
  return rows[0] ?? null;
}

export async function listMessages(conversationId: number, userId: number): Promise<MessageRow[]> {
  const conv = await getConversation(conversationId, userId);
  if (!conv) return [];
  const { rows } = await queryPool<MessageRow>(
    `SELECT message_id, conversation_id, role, content, tools_used, citations, created_at
     FROM public.ai_messages
     WHERE conversation_id = $1
     ORDER BY message_id ASC`,
    [conversationId]
  );
  return rows;
}

export async function deleteConversation(conversationId: number, userId: number): Promise<boolean> {
  const conv = await getConversation(conversationId, userId);
  if (!conv) return false;
  await queryPool(`DELETE FROM public.ai_conversations WHERE conversation_id = $1`, [
    conversationId,
  ]);
  return true;
}

export async function appendMessage(
  conversationId: number,
  role: 'user' | 'assistant',
  content: string,
  toolsUsed: any[] = [],
  citations: any[] = []
): Promise<void> {
  await queryPool(
    `INSERT INTO public.ai_messages (conversation_id, role, content, tools_used, citations)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [conversationId, role, content, JSON.stringify(toolsUsed), JSON.stringify(citations)]
  );
  await queryPool(
    `UPDATE public.ai_conversations SET updated_at = now() WHERE conversation_id = $1`,
    [conversationId]
  );
}

export async function touchConversationTitle(
  conversationId: number,
  fallbackTitle: string
): Promise<void> {
  await queryPool(
    `UPDATE public.ai_conversations
     SET title = COALESCE(title, $2), updated_at = now()
     WHERE conversation_id = $1`,
    [conversationId, fallbackTitle.slice(0, 120)]
  );
}