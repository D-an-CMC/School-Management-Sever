-- ============================================================
-- 013: Xét kết quả cuối năm + Điểm danh theo buổi
--
--  1) Mở rộng attendance_sessions: gắn class/semester/school_year + session (Sáng/Chiều)
--  2) Mở rộng attendances.status sang chuẩn mới
--  3) Tạo bảng student_year_results (tổng hợp + xét cuối năm)
-- ============================================================

-- ------------------------------------------------------------
-- 1) attendance_sessions: thêm cột phân loại buổi / lớp / năm học
-- ------------------------------------------------------------
ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS class_id bigint,
  ADD COLUMN IF NOT EXISTS semester_id bigint,
  ADD COLUMN IF NOT EXISTS school_year_id bigint,
  ADD COLUMN IF NOT EXISTS session text,          -- 'MORNING' | 'AFTERNOON'
  ADD COLUMN IF NOT EXISTS attendance_date date;

-- FK (an toàn, không gây trùng)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_sessions_class_id_fkey') THEN
    ALTER TABLE public.attendance_sessions
      ADD CONSTRAINT attendance_sessions_class_id_fkey
      FOREIGN KEY (class_id) REFERENCES public.classes(class_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_sessions_semester_id_fkey') THEN
    ALTER TABLE public.attendance_sessions
      ADD CONSTRAINT attendance_sessions_semester_id_fkey
      FOREIGN KEY (semester_id) REFERENCES public.semesters(semester_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_sessions_school_year_id_fkey') THEN
    ALTER TABLE public.attendance_sessions
      ADD CONSTRAINT attendance_sessions_school_year_id_fkey
      FOREIGN KEY (school_year_id) REFERENCES public.school_years(school_year_id) ON DELETE SET NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2) attendances.status -> chuẩn mới (chuỗi text)
--    Trước tiên đổi kiểu enum sang text (không dùng CASE tham chiếu giá trị
--    không tồn tại trong enum), sau đó mới map dữ liệu cũ:
--      'Có mặt'        -> PRESENT
--      'Vắng'          -> ABSENT_UNEXCUSED
--      'Vắng có phép'  -> ABSENT_EXCUSED
--      'Nghỉ ốm'       -> ABSENT_EXCUSED
--      'Trễ'           -> LATE
-- ------------------------------------------------------------
ALTER TABLE public.attendances
  ALTER COLUMN status TYPE text USING status::text;

ALTER TABLE public.attendances
  ALTER COLUMN status SET DEFAULT 'PRESENT';

UPDATE public.attendances
  SET status = CASE status
      WHEN 'Có mặt'        THEN 'PRESENT'
      WHEN 'Vắng'          THEN 'ABSENT_UNEXCUSED'
      WHEN 'Vắng có phép'  THEN 'ABSENT_EXCUSED'
      WHEN 'Nghỉ ốm'       THEN 'ABSENT_EXCUSED'
      WHEN 'Trễ'           THEN 'LATE'
      ELSE status
    END;

-- ------------------------------------------------------------
-- 3) Bảng kết quả cuối năm (1 dòng / học sinh / năm học)
--    KHÔNG có cột rèn luyện (bỏ hẳn tiêu chí rèn luyện).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_year_results (
  result_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  student_id bigint NOT NULL,
  school_year_id bigint NOT NULL,

  -- Tổng hợp điểm danh (đơn vị: BUỔI)
  total_school_days integer NOT NULL DEFAULT 0,
  present_sessions integer NOT NULL DEFAULT 0,
  absent_excused_sessions integer NOT NULL DEFAULT 0,
  absent_unexcused_sessions integer NOT NULL DEFAULT 0,
  late_sessions integer NOT NULL DEFAULT 0,
  total_absence_sessions integer NOT NULL DEFAULT 0,

  -- Kết quả học tập (tự tính từ module điểm, không nhập tay)
  academic_result text,            -- 'Tốt' | 'Khá' | 'Đạt' | 'Chưa đạt'
  subjects_ge_9 integer NOT NULL DEFAULT 0,   -- số môn có ĐTB môn cả năm >= 9.0

  -- Danh hiệu
  award text,                      -- 'HỌC SINH XUẤT SẮC' | 'HỌC SINH GIỎI' | 'KHÔNG CÓ DANH HIỆU'

  -- Lên lớp
  promotion_status text,           -- PROMOTED | RETAKE_REQUIRED | SUMMER_REMEDIAL_REQUIRED | NOT_PROMOTED | PENDING_REVIEW
  attendance_warning text,         -- NORMAL | WARNING | AT_LIMIT | EXCEEDED

  -- Hai trạng thái: hệ thống đề xuất vs kết quả cuối (chờ duyệt)
  system_recommendation text,      -- máy đề xuất
  final_result text,               -- NULL cho tới khi GVCN/Hiệu trưởng xác nhận
  finalized boolean NOT NULL DEFAULT false,

  reviewed_by bigint,
  reviewed_at timestamptz,
  finalized_by bigint,
  finalized_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT student_year_results_pkey PRIMARY KEY (result_id),
  CONSTRAINT student_year_results_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id) ON DELETE CASCADE,
  CONSTRAINT student_year_results_school_year_id_fkey FOREIGN KEY (school_year_id) REFERENCES public.school_years(school_year_id) ON DELETE CASCADE,
  CONSTRAINT student_year_results_student_year_unique UNIQUE (student_id, school_year_id)
);

CREATE INDEX IF NOT EXISTS idx_syr_student_id ON public.student_year_results(student_id);
CREATE INDEX IF NOT EXISTS idx_syr_school_year_id ON public.student_year_results(school_year_id);

-- trigger cập nhật updated_at
CREATE OR REPLACE FUNCTION public.fn_student_year_results_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_student_year_results_updated_at ON public.student_year_results;
CREATE TRIGGER trg_student_year_results_updated_at
  BEFORE UPDATE ON public.student_year_results
  FOR EACH ROW EXECUTE FUNCTION public.fn_student_year_results_updated_at();
