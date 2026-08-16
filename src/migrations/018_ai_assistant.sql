-- 018. AI Assistant: hội thoại + RAG (pgvector)

-- Dọn bảng chatbot cũ (nếu còn tồn tại từ DB đã deploy trước khi xóa khỏi 001)
DROP TABLE IF EXISTS public.chatbot_messages;
DROP TABLE IF EXISTS public.chatbot_conversations;

CREATE EXTENSION IF NOT EXISTS vector;

-- Hội thoại AI
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  conversation_id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(user_id),
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_conversations_user_idx ON public.ai_conversations (user_id);

CREATE TABLE IF NOT EXISTS public.ai_messages (
  message_id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES public.ai_conversations(conversation_id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tools_used JSONB NOT NULL DEFAULT '[]',
  citations JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx ON public.ai_messages (conversation_id);

-- Chunks RAG
CREATE TABLE IF NOT EXISTS public.ai_documents (
  doc_id BIGSERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,
  title TEXT NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(2048) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_name, chunk_index)
);
CREATE INDEX IF NOT EXISTS ai_documents_embedding_idx
  ON public.ai_documents USING hnsw (embedding vector_cosine_ops);