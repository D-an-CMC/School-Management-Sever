-- ============================================================
-- Exam name: a single name for a whole exam period, attached to
-- every Lịch thi (timetable_type_id = 2) row of that creation.
-- ============================================================

ALTER TABLE public.timetables ADD COLUMN IF NOT EXISTS exam_name text;