-- ============================================================
-- Xóa sạch năm học 2026-2027 (year 6) -> "mới tinh"
-- Bao gồm: timetables, subject_results (grade_items), classes 40-51,
--          semesters 11/12, school_year 6
-- ============================================================

-- 1) attendance_sessions trỏ vào timetables sem 11/12 (0 dòng, để phòng)
DELETE FROM public.attendance_sessions a
USING public.timetables t
WHERE a.schedule_id = t.schedule_id
  AND t.semester_id IN (11, 12);

-- 2) timetables của sem 11/12 (15048 dòng)
DELETE FROM public.timetables WHERE semester_id IN (11, 12);

-- 3) exam_schedules / teaching_assignments / activities liên quan (0, phòng ngừa)
DELETE FROM public.exam_schedules WHERE semester_id IN (11, 12) OR class_id IN (40,41,42,43,44,45,46,47,48,49,50,51);
DELETE FROM public.teaching_assignments WHERE semester_id IN (11, 12) OR class_id IN (40,41,42,43,44,45,46,47,48,49,50,51);
DELETE FROM public.activities WHERE semester_id IN (11, 12);
DELETE FROM public.learning_predictions WHERE semester_id IN (11, 12);

-- 4) grade_items của subject_results sem 11/12 (0, phòng ngừa)
DELETE FROM public.grade_items gi
USING public.subject_results sr
WHERE gi.result_id = sr.result_id AND sr.semester_id IN (11, 12);

-- 5) subject_results sem 11/12 (0)
DELETE FROM public.subject_results WHERE semester_id IN (11, 12);

-- 6) student_class_enrollments class 40-51 (0)
DELETE FROM public.student_class_enrollments
WHERE class_id IN (40,41,42,43,44,45,46,47,48,49,50,51);

-- 7) Classes year 6 (40-51) - trống, an toàn xóa
DELETE FROM public.classes WHERE school_year_id = 6;

-- 8) Semesters year 6 (11/12)
DELETE FROM public.semesters WHERE school_year_id = 6;

-- 9) School year 2026-2027
DELETE FROM public.school_years WHERE school_year_id = 6;
