-- ============================================================
-- 009: Tổ chức dữ liệu học sinh + điểm cho năm 2025-2026
-- Phương án C:
--   - Giữ nguyên các năm cũ (2023-24, 2024-25, 2025-26, 2026-27, 2027-28)
--   - 2025-2026 (year 9): năm gốc -> có học sinh + điểm đầy đủ
--   - 2026-2027 (year 6): mới tinh (không có điểm), chờ chuyển năm
-- ============================================================

-- ------------------------------------------------------------
-- BƯỚC 1: Chuyển học sinh từ lớp year 6 (2026-27) sang lớp
-- year 9 (2025-26) tương ứng theo tên lớp (6A->6A, 7B->7B, ...)
-- ------------------------------------------------------------
UPDATE public.students st
SET class_id = y9.class_id
FROM public.classes y6
JOIN public.classes y9 ON y9.class_name = y6.class_name AND y9.school_year_id = 9
WHERE y6.school_year_id = 6
  AND st.class_id = y6.class_id;

-- ------------------------------------------------------------
-- BƯỚC 2: Xóa sạch điểm năm 2026-2027 (year 6, sem 11/12) -> mới tinh
-- ------------------------------------------------------------
DELETE FROM public.grade_items gi
USING public.subject_results sr
WHERE gi.result_id = sr.result_id
  AND sr.semester_id IN (11, 12);

DELETE FROM public.subject_results WHERE semester_id IN (11, 12);

-- ------------------------------------------------------------
-- BƯỚC 3: Xóa điểm cũ năm 2025-2026 (sem 17/18) để seed lại đầy đủ
-- ------------------------------------------------------------
DELETE FROM public.grade_items gi
USING public.subject_results sr
WHERE gi.result_id = sr.result_id
  AND sr.semester_id IN (17, 18);

DELETE FROM public.subject_results WHERE semester_id IN (17, 18);

-- ------------------------------------------------------------
-- BƯỚC 4: Seed điểm đầy đủ cho năm 2025-2026
-- Học sinh đang ở lớp year 9 (78-89) x 14 môn x 2 học kỳ (17, 18)
-- ------------------------------------------------------------

-- 4a) Tạo subject_results (mọi môn, 2 học kỳ, gán teacher_id theo môn)
WITH student_subject AS (
  SELECT st.student_id, s.subject_id, sem.semester_id,
         CASE s.subject_id
            WHEN 1  THEN 2
            WHEN 2  THEN 3
            WHEN 3  THEN 4
            WHEN 4  THEN 5
            WHEN 8  THEN 8
            WHEN 9  THEN 9
            WHEN 10 THEN 10
            WHEN 11 THEN 11
            WHEN 12 THEN 12
            WHEN 13 THEN 13
            WHEN 14 THEN 14
            WHEN 15 THEN 16
            WHEN 17 THEN 17
            WHEN 35 THEN 18
         END AS teacher_id
  FROM public.students st
  CROSS JOIN public.subjects s
  CROSS JOIN (VALUES (17), (18)) AS sem(semester_id)
  WHERE st.class_id BETWEEN 78 AND 89
    AND s.subject_id IN (1, 2, 3, 4, 8, 9, 10, 11, 12, 13, 14, 15, 17, 35)
),
ins AS (
  INSERT INTO public.subject_results (student_id, subject_id, semester_id, teacher_id)
  SELECT student_id, subject_id, semester_id, teacher_id FROM student_subject
  RETURNING result_id, student_id, subject_id, semester_id
)
INSERT INTO public.grade_items (result_id, grade_type_id, sequence_no, score, recorded_date)
SELECT
  ins.result_id,
  g.grade_type_id,
  g.seq,
  ROUND(LEAST(10, GREATEST(1, (
    CASE
      WHEN random() < 0.10 THEN 3 + random()*2      -- yếu 3-5
      WHEN random() < 0.15 THEN 8.5 + random()*1.5   -- giỏi 8.5-10
      WHEN random() < 0.40 THEN 5 + random()*1.5     -- TB 5-6.5
      ELSE 6.5 + random()*2                          -- khá 6.5-8.5
    END
  ))::numeric), 1),
  '2025-09-01'::date + (ins.result_id % 160)::int
FROM ins
CROSS JOIN (
  SELECT 1 AS grade_type_id, n AS seq FROM generate_series(1, 4) AS n
  UNION ALL SELECT 2, 1
  UNION ALL SELECT 3, 1
) g;

-- 4b) Tính dtb_mhk (trung bình có trọng số) + ranking
-- ranking là enum result_ranking (Đạt/Chưa đạt) -> cast
UPDATE public.subject_results sr
SET dtb_mhk = gi.wavg,
    ranking = CASE
      WHEN gi.wavg >= 5.0 THEN 'Đạt'::result_ranking
      ELSE 'Chưa đạt'::result_ranking
    END
FROM (
  SELECT gi.result_id,
         ROUND(
           (SUM(CASE WHEN gi.grade_type_id = 1 THEN gi.score END) * 1
            + MAX(CASE WHEN gi.grade_type_id = 2 THEN gi.score END) * 2
            + MAX(CASE WHEN gi.grade_type_id = 3 THEN gi.score END) * 3)
           / (COUNT(CASE WHEN gi.grade_type_id = 1 THEN 1 END) * 1 + 2 + 3)
         , 1) AS wavg
  FROM public.grade_items gi
  GROUP BY gi.result_id
) gi
WHERE sr.result_id = gi.result_id;
