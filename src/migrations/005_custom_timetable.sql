-- Custom (tự đăng ký) subject/teacher names stored on the timetable row itself,
-- so they never create rows in the subjects table.

ALTER TABLE public.timetables ADD COLUMN IF NOT EXISTS custom_subject_name TEXT;
ALTER TABLE public.timetables ADD COLUMN IF NOT EXISTS custom_teacher_name TEXT;
