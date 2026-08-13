-- ============================================================
-- Link each learning-makeup record to the exam that displaced it.
-- When an exam (Lịch thi) is deleted, the displaced regular lessons
-- ("Học bù") can be restored back to their original slots using this id.
-- No FK CASCADE here: we restore manually in code before removing the exam.
-- ============================================================
ALTER TABLE public.exam_makeup
  ADD COLUMN IF NOT EXISTS exam_schedule_id bigint;

CREATE INDEX IF NOT EXISTS exam_makeup_exam_idx
  ON public.exam_makeup (exam_schedule_id);