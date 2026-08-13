-- ============================================================
-- Timetable types (Học thường / Lịch thi), exam rooms+seats,
-- and learning-makeup records.
-- ============================================================

-- 1. Timetable types: 1 = Học thường (regular), 2 = Lịch thi (exam)
CREATE TABLE IF NOT EXISTS public.timetable_type (
  timetable_type_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  type_name text NOT NULL UNIQUE,
  type_code text NOT NULL UNIQUE,
  CONSTRAINT timetable_type_pkey PRIMARY KEY (timetable_type_id)
);

INSERT INTO public.timetable_type (type_name, type_code) VALUES
  ('Học thường', 'REGULAR'),
  ('Lịch thi', 'EXAM')
ON CONFLICT (type_code) DO NOTHING;

-- 2. Classify each timetable row.
ALTER TABLE public.timetables ADD COLUMN IF NOT EXISTS timetable_type_id bigint NOT NULL DEFAULT 1;

-- Ensure the FK exists; column already may exist from a prior run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'timetables_timetable_type_id_fkey'
  ) THEN
    ALTER TABLE public.timetables
      ADD CONSTRAINT timetables_timetable_type_id_fkey
      FOREIGN KEY (timetable_type_id) REFERENCES public.timetable_type(timetable_type_id);
  END IF;
END $$;

-- 3. Room capacity (needed to split exam candidates across rooms).
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS capacity integer DEFAULT 40;

-- 4. Exam candidate seat assignment (room + SBD per student per exam day).
CREATE TABLE IF NOT EXISTS public.exam_exam_assignment (
  exam_schedule_id bigint NOT NULL,
  student_id bigint NOT NULL,
  room_id bigint NOT NULL,
  seat_no integer,
  CONSTRAINT exam_exam_assignment_pkey PRIMARY KEY (exam_schedule_id, student_id),
  CONSTRAINT exam_exam_assignment_exam_schedule_id_fkey
    FOREIGN KEY (exam_schedule_id) REFERENCES public.timetables(schedule_id) ON DELETE CASCADE,
  CONSTRAINT exam_exam_assignment_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(student_id),
  CONSTRAINT exam_exam_assignment_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES public.rooms(room_id),
  CONSTRAINT exam_exam_assignment_seat_unique UNIQUE (exam_schedule_id, room_id, seat_no)
);

CREATE INDEX IF NOT EXISTS exam_exam_assignment_room_idx ON public.exam_exam_assignment (room_id);

-- 5. Learning-makeup records: a regular subject displaced by an exam day,
--    re-scheduled into an empty slot (clearly noted).
CREATE TABLE IF NOT EXISTS public.exam_makeup (
  makeup_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  original_schedule_id bigint,
  makeup_schedule_id bigint,
  class_id bigint,
  day_of_week text,
  period_no smallint,
  makeup_date date,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT exam_makeup_pkey PRIMARY KEY (makeup_id),
  CONSTRAINT exam_makeup_original_fkey
    FOREIGN KEY (original_schedule_id) REFERENCES public.timetables(schedule_id) ON DELETE SET NULL,
  CONSTRAINT exam_makeup_makeup_fkey
    FOREIGN KEY (makeup_schedule_id) REFERENCES public.timetables(schedule_id) ON DELETE SET NULL,
  CONSTRAINT exam_makeup_class_fkey FOREIGN KEY (class_id) REFERENCES public.classes(class_id)
);