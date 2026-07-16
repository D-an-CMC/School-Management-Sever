export interface User {
  user_id: number;
  auth_id?: string;
  role_id?: number;
  username?: string;
  email?: string;
  phone?: string;
  is_active: boolean;
  created_at: string;
}

export interface Student {
  student_id: number;
  user_id?: number;
  class_id?: number;
  student_code?: string;
  full_name: string;
  gender?: string;
  date_of_birth?: string;
  address?: string;
  enrollment_date?: string;
  parent_full_name?: string;
  parent_phone?: string;
  parent_email?: string;
  parent_relationship?: string;
}

export interface Teacher {
  teacher_id: number;
  user_id?: number;
  teacher_code?: string;
  full_name: string;
  gender?: string;
  date_of_birth?: string;
  phone?: string;
  department?: string;
  hire_date?: string;
}

export interface Class {
  class_id: number;
  homeroom_teacher_id?: number;
  school_year_id?: number;
  class_name: string;
  grade_level?: number;
}

export interface GradeItem {
  grade_item_id: number;
  result_id: number;
  grade_type_id: number;
  sequence_no?: number;
  score: number;
  recorded_date: string;
}

export interface GradeType {
  grade_type_id: number;
  type_code: string;
  type_name: string;
  weight: number;
}

export interface AttendanceSession {
  session_id: number;
  schedule_id?: number;
  teacher_id?: number;
  session_date: string;
  created_at: string;
}

export interface Attendance {
  attendance_id: number;
  session_id: number;
  student_id: number;
  status: string;
  check_time?: string;
  note?: string;
}

export interface Timetable {
  schedule_id: number;
  class_id: number;
  subject_id: number;
  teacher_id?: number;
  semester_id: number;
  day_of_week?: string;
  period_no?: number;
  start_time?: string;
  end_time?: string;
  room?: string;
}

export interface ExamSchedule {
  exam_id: number;
  subject_id: number;
  class_id: number;
  semester_id: number;
  exam_date?: string;
  start_time?: string;
  room?: string;
  exam_type?: string;
}

export interface Notification {
  notification_id: number;
  sender_id?: number;
  title: string;
  content?: string;
  target_type?: string;
  created_at: string;
}

export interface Role {
  role_id: number;
  role_name: string;
  description?: string;
}

export interface Permission {
  permission_id: number;
  permission_name: string;
  description?: string;
}

export interface Activity {
  activity_id: number;
  organizer_teacher_id?: number;
  semester_id?: number;
  activity_name: string;
  activity_type?: string;
  description?: string;
  location?: string;
  start_datetime?: string;
  end_datetime?: string;
}
