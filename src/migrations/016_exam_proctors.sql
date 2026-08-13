-- ============================================================
-- Exam proctors (người coi thi / giám thị).
-- Each Lịch thi row (timetable_type_id = 2) can have proctors
-- assigned per room on the exam day. A teacher may coi thi
-- multiple periods but never two rooms in the same period.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.exam_proctors (
  exam_schedule_id bigint NOT NULL,
  teacher_id bigint NOT NULL,
  room_id bigint,
  CONSTRAINT exam_proctors_pkey PRIMARY KEY (exam_schedule_id, teacher_id),
  CONSTRAINT exam_proctors_schedule_fkey
    FOREIGN KEY (exam_schedule_id) REFERENCES public.timetables(schedule_id) ON DELETE CASCADE,
  CONSTRAINT exam_proctors_teacher_fkey
    FOREIGN KEY (teacher_id) REFERENCES public.teachers(teacher_id) ON DELETE CASCADE,
  CONSTRAINT exam_proctors_room_fkey
    FOREIGN KEY (room_id) REFERENCES public.rooms(room_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS exam_proctors_teacher_idx ON public.exam_proctors (teacher_id);
CREATE INDEX IF NOT EXISTS exam_proctors_room_idx ON public.exam_proctors (room_id);