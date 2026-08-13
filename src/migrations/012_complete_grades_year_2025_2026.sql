-- ============================================================
-- Hoàn tất điểm năm 2025-2026 (year 9, sem 17/18) cho học sinh
-- còn thiếu (101 hs vừa phân bổ). Idempotent - chạy lại an toàn.
-- ============================================================

-- 1) Đảm bảo mỗi học sinh lớp year 9 có đủ subject_result
--    cho mọi môn x 2 học kỳ (17, 18). Bỏ qua trùng khóa.
WITH need AS (
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
  CROSS JOIN (VALUES (17),(18)) AS sem(semester_id)
  WHERE st.class_id BETWEEN 78 AND 89
    AND s.subject_id IN (1,2,3,4,8,9,10,11,12,13,14,15,17,35)
),
missing AS (
  SELECT n.student_id, n.subject_id, n.semester_id, n.teacher_id
  FROM need n
  WHERE NOT EXISTS (
    SELECT 1 FROM public.subject_results sr
    WHERE sr.student_id = n.student_id
      AND sr.subject_id = n.subject_id
      AND sr.semester_id = n.semester_id
  )
)
INSERT INTO public.subject_results (student_id, subject_id, semester_id, teacher_id)
SELECT student_id, subject_id, semester_id, teacher_id FROM missing
ON CONFLICT ON CONSTRAINT subject_results_student_id_subject_id_semester_id_key DO NOTHING;

-- 2) Đảm bảo mỗi subject_result (của sem 17/18) có đủ grade_items:
--    4 thường xuyên (type 1), 1 giữa kỳ (type 2), 1 cuối kỳ (type 3)
WITH all_res AS (
  SELECT result_id FROM public.subject_results WHERE semester_id IN (17,18)
)
INSERT INTO public.grade_items (result_id, grade_type_id, sequence_no, score, recorded_date)
SELECT
  r.result_id,
  g.grade_type_id,
  g.seq,
  ROUND(LEAST(10, GREATEST(1, (
    CASE
      WHEN random() < 0.10 THEN 3 + random()*2
      WHEN random() < 0.15 THEN 8.5 + random()*1.5
      WHEN random() < 0.40 THEN 5 + random()*1.5
      ELSE 6.5 + random()*2
    END
  ))::numeric), 1),
  (CASE WHEN g.grade_type_id = 1 THEN '2025-09-01' WHEN g.grade_type_id = 2 THEN '2025-11-01' ELSE '2025-12-01' END)::date
FROM all_res r
CROSS JOIN (
  SELECT 1 AS grade_type_id, n AS seq FROM generate_series(1,4) AS n
  UNION ALL SELECT 2, 1
  UNION ALL SELECT 3, 1
) g
WHERE NOT EXISTS (
  SELECT 1 FROM public.grade_items gi
  WHERE gi.result_id = r.result_id AND gi.grade_type_id = g.grade_type_id AND gi.sequence_no = g.seq
);

-- 3) Tính lại dtb_mhk (trung bình có trọng số) + ranking cho MỌI
--    subject_result sem 17/18 (bao gồm phần vừa chèn)
UPDATE public.subject_results sr
SET dtb_mhk = gi.wavg,
    ranking = (CASE WHEN gi.wavg >= 5.0 THEN 'Đạt'::result_ranking ELSE 'Chưa đạt'::result_ranking END)
FROM (
  SELECT gi.result_id,
         ROUND(
           (SUM(CASE WHEN gi.grade_type_id = 1 THEN gi.score END) * 1
            + MAX(CASE WHEN gi.grade_type_id = 2 THEN gi.score END) * 2
            + MAX(CASE WHEN gi.grade_type_id = 3 THEN gi.score END) * 3)
           / (COUNT(CASE WHEN gi.grade_type_id = 1 THEN 1 END) * 1 + 2 + 3)
         , 1) AS wavg
  FROM public.grade_items gi
  JOIN public.subject_results sr ON sr.result_id = gi.result_id
  WHERE sr.semester_id IN (17,18)
  GROUP BY gi.result_id
) gi
WHERE sr.result_id = gi.result_id
  AND sr.semester_id IN (17,18);
