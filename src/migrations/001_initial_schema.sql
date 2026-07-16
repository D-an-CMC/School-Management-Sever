-- ============================================================
-- School Management System — Initial Schema
-- Based on: https://akurubwwxfgeduyxazyl.supabase.co
-- ============================================================

-- Custom types
CREATE TYPE public.attendance_status AS ENUM ('Có mặt', 'Vắng', 'Vắng có phép', 'Nghỉ ốm');

-- 1. Roles
CREATE TABLE IF NOT EXISTS public.roles (
  role_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  role_name text NOT NULL UNIQUE,
  description text,
  CONSTRAINT roles_pkey PRIMARY KEY (role_id)
);

-- 2. Permissions
CREATE TABLE IF NOT EXISTS public.permissions (
  permission_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  permission_name text NOT NULL UNIQUE,
  description text,
  CONSTRAINT permissions_pkey PRIMARY KEY (permission_id)
);

-- 3. Role Permissions (junction)
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id bigint NOT NULL,
  permission_id bigint NOT NULL,
  CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id),
  CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(role_id),
  CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(permission_id)
);

-- 4. Users
CREATE TABLE IF NOT EXISTS public.users (
  user_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  auth_id uuid UNIQUE,
  role_id bigint,
  username text UNIQUE,
  email text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (user_id),
  CONSTRAINT users_auth_id_fkey FOREIGN KEY (auth_id) REFERENCES auth.users(id),
  CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(role_id)
);

-- 5. School Years
CREATE TABLE IF NOT EXISTS public.school_years (
  school_year_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  year_name text NOT NULL UNIQUE,
  start_date date,
  end_date date,
  CONSTRAINT school_years_pkey PRIMARY KEY (school_year_id)
);

-- 6. Semesters
CREATE TABLE IF NOT EXISTS public.semesters (
  semester_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  school_year_id bigint NOT NULL,
  semester_name text NOT NULL,
  term_order smallint NOT NULL CHECK (term_order = ANY (ARRAY[1, 2])),
  start_date date,
  end_date date,
  CONSTRAINT semesters_pkey PRIMARY KEY (semester_id),
  CONSTRAINT semesters_school_year_id_fkey FOREIGN KEY (school_year_id) REFERENCES public.school_years(school_year_id)
);

-- 7. Teachers
CREATE TABLE IF NOT EXISTS public.teachers (
  teacher_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id bigint UNIQUE,
  teacher_code text UNIQUE,
  full_name text NOT NULL,
  gender text,
  date_of_birth date,
  phone text,
  department text,
  hire_date date,
  CONSTRAINT teachers_pkey PRIMARY KEY (teacher_id),
  CONSTRAINT teachers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id)
);

-- 8. Classes
CREATE TABLE IF NOT EXISTS public.classes (
  class_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  homeroom_teacher_id bigint,
  school_year_id bigint,
  class_name text NOT NULL,
  grade_level smallint,
  CONSTRAINT classes_pkey PRIMARY KEY (class_id),
  CONSTRAINT classes_homeroom_teacher_id_fkey FOREIGN KEY (homeroom_teacher_id) REFERENCES public.teachers(teacher_id),
  CONSTRAINT classes_school_year_id_fkey FOREIGN KEY (school_year_id) REFERENCES public.school_years(school_year_id)
);

-- 9. Students
CREATE TABLE IF NOT EXISTS public.students (
  student_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id bigint UNIQUE,
  class_id bigint,
  student_code text UNIQUE,
  full_name text NOT NULL,
  gender text,
  date_of_birth date,
  address text,
  enrollment_date date,
  parent_full_name text,
  parent_phone text,
  parent_email text,
  parent_relationship text,
  CONSTRAINT students_pkey PRIMARY KEY (student_id),
  CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id),
  CONSTRAINT students_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(class_id)
);

-- 10. Subjects
CREATE TABLE IF NOT EXISTS public.subjects (
  subject_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  subject_code text UNIQUE,
  subject_name text NOT NULL,
  CONSTRAINT subjects_pkey PRIMARY KEY (subject_id)
);

-- 11. Teaching Assignments
CREATE TABLE IF NOT EXISTS public.teaching_assignments (
  assignment_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  teacher_id bigint NOT NULL,
  subject_id bigint NOT NULL,
  class_id bigint NOT NULL,
  semester_id bigint NOT NULL,
  CONSTRAINT teaching_assignments_pkey PRIMARY KEY (assignment_id),
  CONSTRAINT teaching_assignments_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(teacher_id),
  CONSTRAINT teaching_assignments_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(subject_id),
  CONSTRAINT teaching_assignments_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(class_id),
  CONSTRAINT teaching_assignments_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES public.semesters(semester_id)
);

-- 12. Grade Types
CREATE TABLE IF NOT EXISTS public.grade_types (
  grade_type_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  type_code text NOT NULL UNIQUE,
  type_name text NOT NULL,
  weight smallint NOT NULL,
  CONSTRAINT grade_types_pkey PRIMARY KEY (grade_type_id)
);

-- 13. Subject Results
CREATE TABLE IF NOT EXISTS public.subject_results (
  result_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  student_id bigint NOT NULL,
  subject_id bigint NOT NULL,
  semester_id bigint NOT NULL,
  teacher_id bigint,
  dtb_mhk numeric,
  dtb_mcn numeric,
  reassess_dtb_mhk numeric,
  reassess_dtb_mcn numeric,
  ranking text,
  teacher_comment text,
  CONSTRAINT subject_results_pkey PRIMARY KEY (result_id),
  CONSTRAINT subject_results_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id),
  CONSTRAINT subject_results_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(subject_id),
  CONSTRAINT subject_results_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES public.semesters(semester_id),
  CONSTRAINT subject_results_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(teacher_id)
);

-- 14. Grade Items
CREATE TABLE IF NOT EXISTS public.grade_items (
  grade_item_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  result_id bigint NOT NULL,
  grade_type_id bigint NOT NULL,
  sequence_no smallint DEFAULT 1,
  score numeric NOT NULL CHECK (score >= 0::numeric AND score <= 10::numeric),
  recorded_date date DEFAULT CURRENT_DATE,
  CONSTRAINT grade_items_pkey PRIMARY KEY (grade_item_id),
  CONSTRAINT grade_items_result_id_fkey FOREIGN KEY (result_id) REFERENCES public.subject_results(result_id),
  CONSTRAINT grade_items_grade_type_id_fkey FOREIGN KEY (grade_type_id) REFERENCES public.grade_types(grade_type_id)
);

-- 15. Timetables
CREATE TABLE IF NOT EXISTS public.timetables (
  schedule_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  class_id bigint NOT NULL,
  subject_id bigint NOT NULL,
  teacher_id bigint,
  semester_id bigint NOT NULL,
  day_of_week text,
  period_no smallint,
  start_time time without time zone,
  end_time time without time zone,
  room text,
  CONSTRAINT timetables_pkey PRIMARY KEY (schedule_id),
  CONSTRAINT timetables_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(class_id),
  CONSTRAINT timetables_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(subject_id),
  CONSTRAINT timetables_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(teacher_id),
  CONSTRAINT timetables_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES public.semesters(semester_id)
);

-- 16. Attendance Sessions
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  session_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  schedule_id bigint,
  teacher_id bigint,
  session_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT attendance_sessions_pkey PRIMARY KEY (session_id),
  CONSTRAINT attendance_sessions_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.timetables(schedule_id),
  CONSTRAINT attendance_sessions_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(teacher_id)
);

-- 17. Attendances
CREATE TABLE IF NOT EXISTS public.attendances (
  attendance_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  session_id bigint NOT NULL,
  student_id bigint NOT NULL,
  status public.attendance_status NOT NULL DEFAULT 'Có mặt'::attendance_status,
  check_time timestamp with time zone DEFAULT now(),
  note text,
  CONSTRAINT attendances_pkey PRIMARY KEY (attendance_id),
  CONSTRAINT attendances_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(session_id),
  CONSTRAINT attendances_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id)
);

-- 18. Exam Schedules
CREATE TABLE IF NOT EXISTS public.exam_schedules (
  exam_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  subject_id bigint NOT NULL,
  class_id bigint NOT NULL,
  semester_id bigint NOT NULL,
  exam_date date,
  start_time time without time zone,
  room text,
  exam_type text,
  CONSTRAINT exam_schedules_pkey PRIMARY KEY (exam_id),
  CONSTRAINT exam_schedules_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(subject_id),
  CONSTRAINT exam_schedules_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(class_id),
  CONSTRAINT exam_schedules_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES public.semesters(semester_id)
);

-- 19. Activities
CREATE TABLE IF NOT EXISTS public.activities (
  activity_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  organizer_teacher_id bigint,
  semester_id bigint,
  activity_name text NOT NULL,
  activity_type text,
  description text,
  location text,
  start_datetime timestamp with time zone,
  end_datetime timestamp with time zone,
  CONSTRAINT activities_pkey PRIMARY KEY (activity_id),
  CONSTRAINT activities_organizer_teacher_id_fkey FOREIGN KEY (organizer_teacher_id) REFERENCES public.teachers(teacher_id),
  CONSTRAINT activities_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES public.semesters(semester_id)
);

-- 20. Activity Participants
CREATE TABLE IF NOT EXISTS public.activity_participants (
  activity_id bigint NOT NULL,
  student_id bigint NOT NULL,
  attendance_status text DEFAULT 'Tham gia'::text,
  note text,
  CONSTRAINT activity_participants_pkey PRIMARY KEY (activity_id, student_id),
  CONSTRAINT activity_participants_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(activity_id),
  CONSTRAINT activity_participants_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id)
);

-- 21. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  notification_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  sender_id bigint,
  title text NOT NULL,
  content text,
  target_type text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (notification_id),
  CONSTRAINT notifications_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(user_id)
);

-- 22. Notification Recipients
CREATE TABLE IF NOT EXISTS public.notification_recipients (
  notification_id bigint NOT NULL,
  user_id bigint NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamp with time zone,
  CONSTRAINT notification_recipients_pkey PRIMARY KEY (notification_id, user_id),
  CONSTRAINT notification_recipients_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id),
  CONSTRAINT notification_recipients_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(notification_id)
);

-- 23. Chatbot Conversations
CREATE TABLE IF NOT EXISTS public.chatbot_conversations (
  conversation_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id bigint,
  topic text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chatbot_conversations_pkey PRIMARY KEY (conversation_id),
  CONSTRAINT chatbot_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id)
);

-- 24. Chatbot Messages
CREATE TABLE IF NOT EXISTS public.chatbot_messages (
  message_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  conversation_id bigint NOT NULL,
  sender_type text,
  message_content text,
  intent text,
  sent_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chatbot_messages_pkey PRIMARY KEY (message_id),
  CONSTRAINT chatbot_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.chatbot_conversations(conversation_id)
);

-- 25. Learning Predictions
CREATE TABLE IF NOT EXISTS public.learning_predictions (
  prediction_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  student_id bigint NOT NULL,
  semester_id bigint,
  predicted_performance text,
  risk_level text,
  model_name text,
  confidence numeric,
  analysis_date date DEFAULT CURRENT_DATE,
  recommendation text,
  CONSTRAINT learning_predictions_pkey PRIMARY KEY (prediction_id),
  CONSTRAINT learning_predictions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id),
  CONSTRAINT learning_predictions_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES public.semesters(semester_id)
);

-- 26. Risk Warnings
CREATE TABLE IF NOT EXISTS public.risk_warnings (
  warning_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  student_id bigint NOT NULL,
  prediction_id bigint,
  warning_type text,
  description text,
  status text DEFAULT 'Mới'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT risk_warnings_pkey PRIMARY KEY (warning_id),
  CONSTRAINT risk_warnings_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id),
  CONSTRAINT risk_warnings_prediction_id_fkey FOREIGN KEY (prediction_id) REFERENCES public.learning_predictions(prediction_id)
);

-- Seed: Default roles
INSERT INTO public.roles (role_name, description) VALUES
  ('admin', 'Quản trị hệ thống'),
  ('teacher', 'Giáo viên'),
  ('student', 'Học sinh'),
  ('parent', 'Phụ huynh'),
  ('medical', 'Y tế'),
  ('accountant', 'Kế toán')
ON CONFLICT (role_name) DO NOTHING;
