-- ============================================================
-- 008 — Year Transition (lên lớp / lưu ban / tốt nghiệp / chuyển trường)
-- ------------------------------------------------------------
-- * student_class_enrollments : lịch sử "học sinh học lớp nào trong năm nào".
--   Đây là nguồn dữ liệu lịch sử chuẩn. students.class_id chỉ phản ánh
--   lớp hiện tại (cho các chức năng đang dùng) và KHÔNG dùng để lưu lịch sử.
-- * students.status : trạng thái lâu dài của hồ sơ học sinh
--   (ACTIVE / GRADUATED / TRANSFERRED / INACTIVE).
-- ============================================================

-- 1) Trạng thái lâu dài của học sinh.
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_students_status ON public.students(status);

-- 2) Bảng lịch sử phân lớp theo từng năm học.
CREATE TABLE IF NOT EXISTS public.student_class_enrollments (
  enrollment_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  student_id bigint NOT NULL,
  class_id bigint,
  school_year_id bigint NOT NULL,
  grade_level smallint,
  status text NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE / GRADUATED / TRANSFERRED / INACTIVE
  enrolled_at timestamp with time zone DEFAULT now(),
  CONSTRAINT student_class_enrollments_pkey PRIMARY KEY (enrollment_id),
  CONSTRAINT sce_student_year_unique UNIQUE (student_id, school_year_id),
  CONSTRAINT sce_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id) ON DELETE CASCADE,
  CONSTRAINT sce_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(class_id) ON DELETE SET NULL,
  CONSTRAINT sce_school_year_id_fkey FOREIGN KEY (school_year_id) REFERENCES public.school_years(school_year_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sce_student_id ON public.student_class_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_sce_school_year_id ON public.student_class_enrollments(school_year_id);
CREATE INDEX IF NOT EXISTS idx_sce_class_id ON public.student_class_enrollments(class_id);
