-- ============================================================
-- Chinh nam sinh + phan bo 101 hs chua co lop vao khoi lop
-- ============================================================

-- 1) Chinh nam sinh cho HS da co lop (theo khoi)
UPDATE public.students st
SET date_of_birth = (CASE
  WHEN st.class_id = 78 THEN '2014-09-01'::date
  WHEN st.class_id = 79 THEN '2014-09-01'::date
  WHEN st.class_id = 80 THEN '2014-09-01'::date
  WHEN st.class_id = 81 THEN '2013-09-01'::date
  WHEN st.class_id = 82 THEN '2013-09-01'::date
  WHEN st.class_id = 83 THEN '2013-09-01'::date
  WHEN st.class_id = 84 THEN '2012-09-01'::date
  WHEN st.class_id = 85 THEN '2012-09-01'::date
  WHEN st.class_id = 86 THEN '2012-09-01'::date
  WHEN st.class_id = 87 THEN '2011-09-01'::date
  WHEN st.class_id = 88 THEN '2011-09-01'::date
  WHEN st.class_id = 89 THEN '2011-09-01'::date
  ELSE st.date_of_birth END)
WHERE st.class_id IN (78,79,80,81,82,83,84,85,86,87,88,89);

-- 2) Phan bo HS chua co lop vao lop cho deu + chinh nam sinh
-- sau khi gan class_id, cap nhat nam sinh theo khoi lop
BEGIN;
UPDATE public.students SET class_id = 78 WHERE student_id IN (680,707,712,724,733,737,753,764,787,838,844,852,857,858,863);
UPDATE public.students SET class_id = 79 WHERE student_id IN (864,865,866,867,868,869,870,871,872,873,874,875,876,877,878,879);
UPDATE public.students SET class_id = 80 WHERE student_id IN (880,881,882,883,884,885,886,887,888);
UPDATE public.students SET class_id = 82 WHERE student_id IN (890);
UPDATE public.students SET class_id = 83 WHERE student_id IN (891);
UPDATE public.students SET class_id = 84 WHERE student_id IN (892,893,894);
UPDATE public.students SET class_id = 85 WHERE student_id IN (895,896,897,898,899,900);
UPDATE public.students SET class_id = 86 WHERE student_id IN (901,902,903,904,905,906,908);
UPDATE public.students SET class_id = 87 WHERE student_id IN (909,910,911,912,913,914,915,916,917,918,919,920,921,922,923);
UPDATE public.students SET class_id = 88 WHERE student_id IN (924,925,926,927,928,929,930,931,932,934,935,936,937,938);
UPDATE public.students SET class_id = 89 WHERE student_id IN (939,940,941,942,943,944,947,948,949,950,951,952,953,954);

UPDATE public.students st SET date_of_birth = (CASE
  WHEN st.class_id = 78 THEN '2014-09-01'::date
  WHEN st.class_id = 79 THEN '2014-09-01'::date
  WHEN st.class_id = 80 THEN '2014-09-01'::date
  WHEN st.class_id = 81 THEN '2013-09-01'::date
  WHEN st.class_id = 82 THEN '2013-09-01'::date
  WHEN st.class_id = 83 THEN '2013-09-01'::date
  WHEN st.class_id = 84 THEN '2012-09-01'::date
  WHEN st.class_id = 85 THEN '2012-09-01'::date
  WHEN st.class_id = 86 THEN '2012-09-01'::date
  WHEN st.class_id = 87 THEN '2011-09-01'::date
  WHEN st.class_id = 88 THEN '2011-09-01'::date
  WHEN st.class_id = 89 THEN '2011-09-01'::date
  ELSE st.date_of_birth END);
COMMIT;

-- Verify
SELECT c.class_id, c.class_name, count(s.student_id) AS hs FROM public.classes c LEFT JOIN public.students s ON s.class_id=c.class_id WHERE c.school_year_id=9 GROUP BY c.class_id,c.class_name ORDER BY c.class_id;