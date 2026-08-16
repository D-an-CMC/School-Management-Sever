import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';

function mondayOf(isoStr?: string): string | null {
  let date: Date;
  if (isoStr) {
    date = new Date(`${isoStr}T00:00:00Z`);
  } else {
    date = new Date();
  }
  if (isNaN(date.getTime())) return null;
  const dow = date.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().split('T')[0];
}

// Pick the first active semester from a list, falling back to the first row.
function activeSemesterId(semesters: any[]): number {
  const active = semesters.find((s: any) => s.is_active === true);
  return active ? Number(active.semester_id) : semesters.length > 0 ? Number(semesters[0].semester_id) : 1;
}

export class TimetableService {
async findMany(params: { teacherId?: number; classId?: number; semesterId?: number; weekStart?: string; page?: number; limit?: number; timetableTypeId?: number }) {
const { offset, limit } = buildPagination({ page: params.page, limit: params.limit });

let q = supabase.from('timetables').select('*, subjects(*), classes(*, rooms!classes_fixed_room_id_fkey(room_name)), teachers!timetables_teacher_id_fkey(*), timetable_type:timetable_type_id(*)', { count: 'exact' });

    if (params.timetableTypeId != null) {
      q = q.eq('timetable_type_id', Number(params.timetableTypeId));
    }
    if (params.teacherId) {
      const { data: tas } = await supabase
        .from('teaching_assignments')
        .select('class_id, subject_id')
        .eq('teacher_id', params.teacherId);

      const assignedPairs = tas || [];
      if (assignedPairs.length > 0) {
        const orConditions = [
          `teacher_id.eq.${params.teacherId}`,
          ...assignedPairs.map(p => `and(class_id.eq.${p.class_id},subject_id.eq.${p.subject_id})`)
        ].join(',');
        q = q.or(orConditions);
      } else {
        q = q.eq('teacher_id', params.teacherId);
      }
    }
    if (params.classId) {
      q = q.eq('class_id', params.classId);
    }
    if (params.semesterId) {
      q = q.eq('semester_id', params.semesterId);
    }
    if (params.weekStart) {
      const monday = mondayOf(params.weekStart);
      if (monday) {
        q = q.eq('week_start', monday);
      }
    }

    const result = await q.order('day_of_week').range(offset, offset + limit);

if (result.error) {
return error(result.error.message, 'DB_ERROR');
}

// Enrich entries with assigned teacher from teaching_assignments if teachers is null
const { data: assignments } = await supabase
  .from('teaching_assignments')
  .select('class_id, subject_id, teacher_id, teachers(teacher_id, full_name)');

const assignmentMap = new Map<string, any>();
(assignments || []).forEach((a: any) => {
  assignmentMap.set(`${a.class_id}_${a.subject_id}`, a.teachers);
});

const enriched = (result.data ?? []).map((t: any) => {
  let tObj = t.teachers;
  if (!tObj || (Array.isArray(tObj) && tObj.length === 0)) {
    const assigned = assignmentMap.get(`${t.class_id}_${t.subject_id}`);
    if (assigned) tObj = assigned;
  }
  // Resolve room: explicit entry room wins; otherwise fall back to the class's fixed room.
  const cls = Array.isArray(t.classes) ? t.classes[0] : t.classes;
  const fixedRoom = cls?.rooms;
  const roomName = Array.isArray(fixedRoom) ? fixedRoom[0]?.room_name : fixedRoom?.room_name;
  const resolvedRoom = t.room || roomName || '';
  return {
    ...t,
    room: resolvedRoom,
    teachers: tObj,
    teacher_name: Array.isArray(tObj) ? tObj[0]?.full_name : tObj?.full_name,
  };
});

return {
success: true as const,
...paginate(enriched, result.count ?? 0, params.page, params.limit),
};
}

// Return the exam duties (coi thi / giám thị) of a single teacher as
  // timetable-shaped rows (timetable_type_id = 2) so their exam proctoring
  // shows up on their own schedule (in /timetables/my). A proctor is stored on
  // a single anchor schedule row, but the duty spans the whole buổi (all
  // periods of the exam), so the whole buổi is expanded into consecutive rows
  // that the grid merges into one "Coi thi" block.
  async proctorSchedule(params: { teacherId: number; semesterId?: number; weekStart?: string }) {
    const teacherId = Number(params.teacherId);
    const { data: proctors } = await supabase
      .from('exam_proctors')
      .select('exam_schedule_id, room:rooms(room_name)')
      .eq('teacher_id', teacherId);
    const scheduleIds = Array.from(new Set((proctors || []).map((p: any) => Number(p.exam_schedule_id)).filter(Boolean)));
    if (scheduleIds.length === 0) return success([]);

    const roomBySchedule = new Map<number, string>();
    (proctors || []).forEach((p: any) => {
      const sid = Number(p.exam_schedule_id);
      const roomName = Array.isArray(p.room) ? p.room[0]?.room_name : p.room?.room_name;
      if (sid && roomName && !roomBySchedule.has(sid)) roomBySchedule.set(sid, roomName);
    });

    // Resolve the anchor rows to know which buổi (week + day + semester) each
    // teacher covers, then pull the whole group's periods for that buổi.
    let anchorQ = supabase
      .from('timetables')
      .select('*, subjects(*), classes(*, rooms!classes_fixed_room_id_fkey(room_name))')
      .in('schedule_id', scheduleIds);
    if (params.semesterId) anchorQ = anchorQ.eq('semester_id', Number(params.semesterId));
    if (params.weekStart) {
      const monday = mondayOf(params.weekStart);
      if (monday) anchorQ = anchorQ.eq('week_start', monday);
    }
    const { data: anchors, error: anchorErr } = await anchorQ;
    if (anchorErr) return error(anchorErr.message, 'DB_ERROR');
    if (!anchors || anchors.length === 0) return success([]);

    // Collect distinct buổi anchors (semester + week + day).
    const groupKeys = new Map<string, string>(); // key -> representative room
    for (const a of anchors) {
      const key = `${Number(a.semester_id)}_${a.week_start}_${a.day_of_week}`;
      const roomName = roomBySchedule.get(Number(a.schedule_id)) ?? '';
      if (!groupKeys.has(key)) groupKeys.set(key, roomName);
    }

    // One period per buổi (whole grade shares the same subject & period set).
    const buổiPeriods = new Map<string, any>();
    for (const key of groupKeys.keys()) {
      const [sem, weekStart, dayOfWeek] = key.split('_');
      const { data: group } = await supabase
        .from('timetables')
        .select('schedule_id, period_no, weekday_subject:subject_id, custom_subject_name, subjects(*)')
        .eq('timetable_type_id', 2)
        .eq('semester_id', Number(sem))
        .eq('week_start', weekStart)
        .eq('day_of_week', dayOfWeek);
      const byPeriod = new Map<number, any>();
      for (const r of (group || [])) {
        const p = Number(r.period_no);
        if (!byPeriod.has(p)) byPeriod.set(p, r);
      }
      const periodRows = [...byPeriod.values()].sort((a, b) => Number(a.period_no) - Number(b.period_no));
      if (periodRows.length > 0) buổiPeriods.set(key, { anchor: anchors[0], periods: periodRows });
    }

    const rows: any[] = [];
    for (const key of groupKeys.keys()) {
      const [sem, weekStart, dayOfWeek] = key.split('_');
      const entry = buổiPeriods.get(key);
      const roomName = groupKeys.get(key) ?? '';
      const anchor = anchors.find((a: any) => `${Number(a.semester_id)}_${a.week_start}_${a.day_of_week}` === key) || anchors[0];
      const anchorSubj = Array.isArray(anchor.subjects) ? anchor.subjects[0] : anchor.subjects;
      const subjectName = anchor.custom_subject_name?.replace(/^THI - ?/, '') || anchorSubj?.subject_name || 'Môn thi';
      for (const pr of (entry?.periods ?? [])) {
        rows.push({
          schedule_id: Number(pr.schedule_id),
          subject_id: anchor.subject_id,
          class_id: anchor.class_id,
          day_of_week: dayOfWeek,
          period_no: Number(pr.period_no),
          week_start: weekStart,
          semester_id: Number(sem),
          exam_name: anchor.exam_name ?? null,
          timetable_type_id: 2,
          is_proctor_duty: true,
          custom_subject_name: `Coi thi - ${subjectName}`,
          subjects: anchor.subjects,
          classes: anchor.classes,
          teachers: null,
          teacher_name: null,
          room: roomName,
        });
      }
    }

    return success(rows);
  }

async examSchedules(params: { classId?: number; semesterId?: number }) {
let q = supabase.from('exam_schedules').select('*');

if (params.classId) q = q.eq('class_id', params.classId);
if (params.semesterId) q = q.eq('semester_id', params.semesterId);

const result = await q.order('exam_date');

if (result.error) {
return error(result.error.message, 'DB_ERROR');
}

return success(result.data ?? []);
}

  // ─────────────────────────────────────────────────────────────
  // Exam scheduling (Lịch thi)
  //  - Creates timetable rows with timetable_type_id = 2 for every class
  //    in a grade on a specific date (whole grade shares the same subject).
  //  - Auto-splits candidates across rooms (capacity) + assigns SBD per exam.
  //  - Displaces any regular (type=1) subjects overlapping the exam session
  //    and re-routes them into empty slots in the same week as "Học bù".
  // ─────────────────────────────────────────────────────────────
  async createExamForGrade(input: {
    gradeLevel: number;
    examDate: string;
    session: 'morning' | 'afternoon' | 'both';
    dayOfWeek: string;
    subjectId: number;
    periods: number[];
    semesterId?: number;
    examName?: string;
    proctorsPerRoom?: number;
  }) {
    const gradeLevel = Number(input.gradeLevel);
    const examDate = input.examDate;
    const semesterId = input.semesterId
      ? Number(input.semesterId)
      : await this.currentSemesterId();

    // Resolve the school year for semesterId so we only touch current-year classes.
    const { data: semRow } = await supabase
      .from('semesters')
      .select('school_year_id')
      .eq('semester_id', semesterId)
      .maybeSingle();
    const yearId = semRow?.school_year_id ?? null;

    let classQ = supabase.from('classes').select('class_id, class_name, grade_level');
    if (yearId != null) classQ = classQ.eq('school_year_id', yearId);
    classQ = classQ.eq('grade_level', gradeLevel);
    const { data: classes } = await classQ;
    const gradeClasses = (classes || []).filter((c: any) => Number(c.grade_level) === gradeLevel);
    if (gradeClasses.length === 0) return error(`Không có lớp nào thuộc khối ${gradeLevel}`, 'NO_CLASSES');

    const { data: subject } = await supabase
      .from('subjects')
      .select('subject_id, subject_name, subject_code')
      .eq('subject_id', input.subjectId)
      .maybeSingle();
    if (!subject) return error('Môn thi không tồn tại', 'NOT_FOUND');
    const subjectName = subject.subject_name || 'Môn';
    const periods = (input.periods || []).filter((p: number) => Number.isFinite(Number(p)) && Number(p) >= 1 && Number(p) <= 10).map(Number);
    if (periods.length === 0) return error('Phải chọn ít nhất 1 tiết thi', 'VALIDATION_ERROR');

    const weekStart = mondayOf(examDate);
    const dayOfWeek = String(input.dayOfWeek);

    const classIds = gradeClasses.map((c: any) => Number(c.class_id));

    // 1) Create the exam rows (each period = 1 row) for every class in the grade.
    const createdRows: any[] = [];
    for (const cls of gradeClasses) {
      const classId = Number(cls.class_id);
      for (const periodNo of periods) {
        // delete any existing EXAM row (type=2) in this exact slot for cleanliness;
        // regular (type=1) rows are preserved and displaced via makeupConflicts below.
        await supabase
          .from('timetables')
          .delete()
          .eq('class_id', classId)
          .eq('day_of_week', dayOfWeek)
          .eq('period_no', periodNo)
          .eq('week_start', weekStart)
          .eq('semester_id', semesterId)
          .eq('timetable_type_id', 2);
        const { data: ins, error: insErr } = await supabase
          .from('timetables')
          .insert({
            class_id: classId,
            subject_id: input.subjectId,
            semester_id: semesterId,
            day_of_week: dayOfWeek,
            period_no: periodNo,
            week_start: weekStart,
            timetable_type_id: 2,
            custom_subject_name: `THI - ${subjectName}`,
            exam_name: input.examName || null,
            room: this.examRoomForClass(classId),
          })
          .select('schedule_id, class_id, period_no')
          .single();
        if (insErr) return error('Lỗi tạo lịch thi: ' + insErr.message, 'DB_ERROR');
        createdRows.push(ins);
      }
    }

    // 2) Displace regular subjects overlapping this exam session (same day,
    //    same session as the chosen periods) into empty slots as "Học bù".
    const examLabel = (input.examName && input.examName.trim()) ? input.examName.trim() : `${subjectName}`;
    // Map (class, period) -> the exam schedule row created above, so each makeup
    // record can remember which exam displaced it (used to restore on delete).
    const examRowMap = new Map<string, number>();
    for (const r of createdRows) examRowMap.set(`${r.class_id}_${r.period_no}`, Number(r.schedule_id));
    await this.makeupConflicts(classIds, dayOfWeek, input.session, weekStart, semesterId, `do lịch thi ${examLabel} ngày ${examDate}`, examRowMap);

    // 3) Auto-split candidates across rooms + assign SBD for this exam day.
    const assignments = await this.assignExamSeats(createdRows[0]?.schedule_id, classIds, examDate);

    // 4) Auto-assign proctors (người coi thi) to each exam period/room.
    const proctors = await this.assignProctors(createdRows, classIds, examDate, input.proctorsPerRoom);

    return success({ scheduleIds: createdRows.map((r) => r.schedule_id), count: createdRows.length, assignments, proctors });
  }

  private async currentSemesterId(): Promise<number> {
    // H5: phải select is_active — trước đây thiếu cột nên luôn fallback về semester đầu tiên.
    const { data: list } = await supabase
      .from('semesters')
      .select('semester_id, is_active')
      .order('term_order')
      .order('semester_id');
    const active = (list || []).find((s: any) => s.is_active === true);
    return active ? Number(active.semester_id) : (list && list.length > 0 ? Number(list[0].semester_id) : 1);
  }

  private examRoomForClass(_classId: number): string | undefined {
    return undefined; // room resolved dynamically from seat assignment
  }

  // Concrete exam date from week_start (Monday) + day_of_week (0=Chủ nhật scheme).
  private examDateFromWeek(weekStart: string, dayOfWeek: string): string {
    const monday = new Date(`${weekStart}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() + (Number(dayOfWeek) - 2));
    return monday.toISOString().split('T')[0];
  }

  // Move regular (type=1) subjects of the exam's whole session (morning=tiết 1-5,
  // afternoon=tiết 6-10, both=all) on that day into empty slots, preferring the
  // opposite session of the SAME day first, then scattering to other days. Each
  // moved row is recorded as "Học bù".
  private async makeupConflicts(
    classIds: number[],
    dayOfWeek: string,
    session: 'morning' | 'afternoon' | 'both',
    weekStart: string,
    semesterId: number,
    reason: string,
    examRowMap?: Map<string, number>
  ) {
    const MORNING = [1, 2, 3, 4, 5];
    const AFTERNOON = [6, 7, 8, 9, 10];
    const examPeriods = new Set(
      session === 'afternoon' ? AFTERNOON : session === 'both' ? [...MORNING, ...AFTERNOON] : MORNING
    );
    // Target slots to try first on the SAME day: the opposite session.
    const sameDayPrefer = session === 'afternoon' ? MORNING : session === 'morning' ? AFTERNOON : [...MORNING, ...AFTERNOON];
    for (const classId of classIds) {
      const { data: existing } = await supabase
        .from('timetables')
        .select('schedule_id, class_id, subject_id, teacher_id, room, custom_subject_name, custom_teacher_name, day_of_week, period_no, week_start, semester_id, timetable_type_id')
        .eq('class_id', classId)
        .eq('day_of_week', dayOfWeek)
        .eq('week_start', weekStart)
        .eq('semester_id', semesterId)
        .eq('timetable_type_id', 1);

      const displaced = (existing || []).filter((r: any) => examPeriods.has(Number(r.period_no)));
      for (const row of displaced) {
        const target = await this.findFreeSlot(classId, dayOfWeek, weekStart, semesterId, sameDayPrefer);
        if (!target) continue; // no free slot across the whole horizon — keep as-is (measurably rare)
        // create the makeup row
        const { data: mk, error: mkErr } = await supabase
          .from('timetables')
          .insert({
            class_id: classId,
            subject_id: row.subject_id,
            teacher_id: row.teacher_id ?? null,
            semester_id: row.semester_id ?? semesterId,
            day_of_week: target.day,
            period_no: target.period,
            week_start: target.week,
            timetable_type_id: 1,
            custom_subject_name: row.custom_subject_name ?? null,
            custom_teacher_name: row.custom_teacher_name ?? null,
            room: row.room ?? null,
          })
          .select('schedule_id')
          .single();
        if (mkErr) continue;
        // record the makeup (must reference the original row BEFORE deleting it)
        const mkup = await supabase.from('exam_makeup').insert({
          original_schedule_id: row.schedule_id,
          makeup_schedule_id: mk.schedule_id,
          class_id: classId,
          day_of_week: target.day,
          period_no: target.period,
          makeup_date: target.date || null,
          exam_schedule_id: examRowMap?.get(`${classId}_${row.period_no}`) ?? null,
          note: `Học bù ${reason}`,
        });
        if (mkup.error) {
          console.error('[MAKEUP-INSERT]', mkup.error.message);
          continue;
        }
        // delete the displaced row
        await supabase.from('timetables').delete().eq('schedule_id', row.schedule_id);
      }
    }
  }

  // Find an empty (day, period) slot for a class for the makeup class, always
  // scheduled OUTSIDE the exam's own session. Order of preference:
  //   1) opposite-session tiết on the SAME day (same date as the exam);
  //   2) the exam's opposite session / remaining tiết on later days same week;
  //   3) rolling into FOLLOWING weeks (up to HORIZON_WEEKS) until any free slot
  //      is found — so a makeup is never left inside the exam session.
  private async findFreeSlot(
    classId: number,
    excludeDay: string,
    weekStart: string,
    semesterId: number,
    sameDayPrefer: number[]
  ): Promise<{ day: string; period: number; date: string | null; week: string } | null> {
    const OTHER_PERIODS = [4, 5, 6, 7, 8, 9, 10, 1, 2, 3];
    // Always try the exam's opposite session first (on any week), then the rest.
    const PREFERRED_PERIODS = [...sameDayPrefer, ...OTHER_PERIODS.filter((p) => !sameDayPrefer.includes(p))];
    const ALL_DAYS = ['2', '3', '4', '5', '6', '7'];
    const HORIZON_WEEKS = 16;
    const curMonday = weekStart ? new Date(`${weekStart}T00:00:00Z`) : null;
    if (!curMonday) return null;

    // Candidate weeks: the exam week + the following HORIZON_WEEKS-1 weeks.
    const weekStarts: string[] = [];
    for (let i = 0; i < HORIZON_WEEKS; i++) {
      const d = new Date(curMonday);
      d.setUTCDate(d.getUTCDate() + i * 7);
      weekStarts.push(d.toISOString().split('T')[0]);
    }

    // Gather occupied (week, day, period) for this class across all candidate weeks.
    const { data: week } = await supabase
      .from('timetables')
      .select('week_start, day_of_week, period_no')
      .eq('class_id', classId)
      .eq('semester_id', semesterId)
      .in('week_start', weekStarts);
    const occupied = new Set((week || []).map((r: any) => `${r.week_start}_${r.day_of_week}_${r.period_no}`));

    type Slot = { week: string; day: string; period: number; date: string | null };
    const slotOrder: Slot[] = [];
    const dateForDay = (monday: Date, day: string): string => {
      const d = new Date(monday);
      d.setUTCDate(d.getUTCDate() + (Number(day) - 2));
      return d.toISOString().split('T')[0];
    };

    weekStarts.forEach((ws, idx) => {
      const monday = new Date(`${ws}T00:00:00Z`);
      if (idx === 0) {
        // Exam week: opposite-session on the exam day first, then strictly later days.
        const sameDate = dateForDay(monday, excludeDay);
        for (const p of sameDayPrefer) slotOrder.push({ week: ws, day: excludeDay, period: p, date: sameDate });
        const laterDays = ALL_DAYS.filter((d) => d !== excludeDay && Number(d) > Number(excludeDay));
        for (const d of laterDays) {
          const date = dateForDay(monday, d);
          for (const p of PREFERRED_PERIODS) slotOrder.push({ week: ws, day: d, period: p, date });
        }
        return;
      }
      // Following weeks: all days, preferred (opposite-session) periods first.
      for (const d of ALL_DAYS) {
        const date = dateForDay(monday, d);
        for (const p of PREFERRED_PERIODS) slotOrder.push({ week: ws, day: d, period: p, date });
      }
    });

    for (const s of slotOrder) {
      if (!occupied.has(`${s.week}_${s.day}_${s.period}`)) {
        return { day: s.day, period: s.period, date: s.date, week: s.week };
      }
    }
    return null;
  }

  // Split the grade's students (randomly, not per class) across available rooms
  // by capacity and assign seats once, into a single representative exam row so
  // there is no redundancy. All schedule rows of this exam share the same roster.
  private async assignExamSeats(anchorScheduleId: number | null, classIds: number[], examDate: string) {
    if (!anchorScheduleId) return { total: 0, rooms: [] };

    // rooms usable for exams (skip Sân trường / Ngoài trời)
    const { data: roomRows } = await supabase
      .from('rooms')
      .select('room_id, room_name, room_type, capacity')
      .neq('room_type', 'Ngoài trời');
    const rooms = (roomRows || []).sort((a: any, b: any) => Number(a.room_id) - Number(b.room_id));

    const { data: students } = await supabase.from('students').select('student_id').in('class_id', classIds);
    const candidates = (students || []).map((s: any) => Number(s.student_id));

    // Shuffle candidates so seating is random across the whole grade (not per class).
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    // distribute round-robin to fill rooms up to capacity
    const seats: Array<{ room_id: number; student_id: number; seat_no: number }> = [];
    let roomIdx = 0;
    let seatInRoom = 0;
    for (const studentId of candidates) {
      if (rooms.length === 0) break;
      let room = rooms[roomIdx];
      let guard = 0;
      while (room && Number(room.capacity) > 0 && seatInRoom >= Number(room.capacity) && guard < rooms.length * 2) {
        roomIdx = (roomIdx + 1) % rooms.length;
        room = rooms[roomIdx];
        seatInRoom = 0;
        guard++;
      }
      if (!room) break;
      seatInRoom++;
      seats.push({ room_id: Number(room.room_id), student_id: studentId, seat_no: seatInRoom });
    }

    // Assign the whole roster once, to the single anchor row only (no duplication).
    const sid = Number(anchorScheduleId);
    await supabase.from('exam_exam_assignment').delete().eq('exam_schedule_id', sid);
    const rows = seats.map((s) => ({
      exam_schedule_id: sid,
      student_id: s.student_id,
      room_id: s.room_id,
      seat_no: s.seat_no,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error: err } = await supabase.from('exam_exam_assignment').insert(batch);
      if (err) {
        console.error('Exam seat insert error:', err);
        return { total: 0, rooms: [], error: err.message };
      }
    }
    return {
      total: candidates.length,
      rooms: rooms.map((r: any) => ({ room_id: r.room_id, room_name: r.room_name, capacity: r.capacity })),
    };
  }

  // Auto-assign proctors (người coi thi) per exam period + room.
  // Rules:
  //   - a teacher covers at most ONE room in the same period (no trùng tiết),
  //   - teachers who are teaching (type=1) in that week/day/period are excluded,
  //   - teachers from a DIFFERENT grade (not teaching the examined classes)
  //     are preferred, then any remaining free teacher,
  //   - N (1 or 2) proctors per room as chosen by the user.
  private async assignProctors(
    schedules: any[],
    classIds: number[],
    examDate: string,
    proctorsPerRoom?: number
  ) {
    const n = Math.min(Math.max(Number(proctorsPerRoom) || 1, 1), 2);
    if (!schedules || schedules.length === 0) return { total: 0, rooms: [] };

    const sids = schedules.map((s: any) => Number(s.schedule_id));
    const { data: seatRows } = await supabase
      .from('exam_exam_assignment')
      .select('room_id')
      .in('exam_schedule_id', sids);
    let rooms = [...new Set((seatRows || []).map((r: any) => Number(r.room_id)))].filter(Boolean);
    // If there are no seat assignments (e.g. no candidates / no split yet), fall
    // back to every exam-capable room so proctors are still assigned per room.
    if (rooms.length === 0) {
      const { data: allRooms } = await supabase
        .from('rooms')
        .select('room_id')
        .neq('room_type', 'Ngoài trời');
      rooms = (allRooms || []).map((r: any) => Number(r.room_id)).filter(Boolean);
    }
    if (rooms.length === 0) return { total: 0, rooms: [] };

    const first = schedules[0];
    const weekStart = String(first.week_start);
    const dayOfWeek = String(first.day_of_week);

    // Distinct periods -> representative schedule_id per period.
    const periodToSchedule = new Map<number, number>();
    for (const s of schedules) {
      const p = Number(s.period_no);
      if (!periodToSchedule.has(p)) periodToSchedule.set(p, Number(s.schedule_id));
    }
    const periods = [...periodToSchedule.keys()].sort((a, b) => a - b);

    const { data: teachers } = await supabase.from('teachers').select('teacher_id, full_name');
    const teacherPool = (teachers || []).map((t: any) => Number(t.teacher_id));

    // Teaching busy map: teacher busy in a week/day/period because they teach.
    const { data: teachRows } = await supabase
      .from('timetables')
      .select('teacher_id, day_of_week, period_no, week_start, class_id')
      .eq('timetable_type_id', 1)
      .eq('week_start', weekStart)
      .not('teacher_id', 'is', null);
    const teachingBusy = new Map<string, number>(); // key -> teacherId
    (teachRows || []).forEach((r: any) => {
      if (r.teacher_id != null)
        teachingBusy.set(`${r.week_start}_${r.day_of_week}_${r.period_no}_${r.teacher_id}`, Number(r.class_id));
    });

    // teachingBusy key list uses requested grade locally; keep filtering simple.
    // Prefer teachers who do NOT teach the examined classes (Giáo viên khối khác).
    const { data: gradeClassRows } = await supabase
      .from('classes')
      .select('homeroom_teacher_id')
      .eq('class_id', classIds);
    const gradeTeacherIds = new Set(
      (gradeClassRows || []).map((c: any) => (c.homeroom_teacher_id != null ? Number(c.homeroom_teacher_id) : null)).filter(Boolean)
    );
    const orderPool = [
      ...teacherPool.filter((t) => !gradeTeacherIds.has(t)),
      ...teacherPool.filter((t) => gradeTeacherIds.has(t)),
    ];

    // One proctor per room for the WHOLE buổi (session) — regardless of how many
    // consecutive periods the exam runs. Teachers busy teaching any of the
    // examined periods are excluded; a teacher cannot cover two rooms.
    const busyDuringSession = new Set<number>();
    for (const p of periods) {
      for (const key of teachingBusy.keys()) {
        if (key.startsWith(`${weekStart}_${dayOfWeek}_${p}_`)) {
          busyDuringSession.add(Number(key.split('_').pop()));
        }
      }
    }

    const used = new Set<number>();
    const assigned: any[] = [];
    let idx = 0;

    const pickFree = (): number | null => {
      for (let attempts = 0; attempts < orderPool.length * 4; attempts++) {
        const t = orderPool[idx % orderPool.length];
        idx++;
        if (used.has(t)) continue;
        if (busyDuringSession.has(t)) continue;
        used.add(t);
        return t;
      }
      return null;
    };

    // Attach the whole buổi's proctors to the anchor (first) exam schedule row.
    const anchorSid = periodToSchedule.get(periods[0])!;
    await supabase.from('exam_proctors').delete().in('exam_schedule_id', sids);

    const rows: Array<{ exam_schedule_id: number; teacher_id: number; room_id: number }> = [];
    for (const roomId of rooms) {
      for (let k = 0; k < n; k++) {
        const t = pickFree();
        if (t == null) break;
        rows.push({ exam_schedule_id: anchorSid, teacher_id: t, room_id: roomId });
      }
    }
    if (rows.length > 0) {
      const { error: err } = await supabase.from('exam_proctors').insert(rows);
      if (err) console.error('[PROCTOR] insert error:', err.message);
      assigned.push(...rows);
    }

    return {
      total: assigned.length,
      rooms: rooms.map((roomId) => ({ room_id: Number(roomId) })),
      periodCount: periods.length,
    };
  }

  // Re-assign proctors (người coi thi) to an existing exam occasion (a single
  // schedule row). Gathers the whole exam group (same grade/week/day) and runs
  // the same auto-assignment used at creation time — useful when an exam was
  // created without seats/rooms and got no proctors.
  async reassignProctors(scheduleId: number, proctorsPerRoom?: number) {
    const { data: anchor } = await supabase
      .from('timetables')
      .select('class_id, semester_id, week_start, day_of_week, period_no, classes(grade_level)')
      .eq('schedule_id', scheduleId)
      .eq('timetable_type_id', 2)
      .maybeSingle();
    if (!anchor) return error('Không tìm thấy lịch thi', 'NOT_FOUND');
    const cls = Array.isArray(anchor.classes) ? anchor.classes[0] : anchor.classes;
    const gradeLevel = Number(cls?.grade_level);
    const weekStart = anchor.week_start;
    const dayOfWeek = anchor.day_of_week;
    const semesterId = Number(anchor.semester_id);

    if (!gradeLevel || !weekStart) return error('Thiếu thông tin khối/tuần lịch thi', 'VALIDATION_ERROR');

    // Fetch the whole exam group for this grade + week + day (any period).
    const { data: gradeClasses } = await supabase.from('classes').select('class_id').eq('grade_level', gradeLevel);
    const classIds = (gradeClasses || []).map((c: any) => Number(c.class_id)).filter(Boolean);
    if (classIds.length === 0) return error('Không có lớp thuộc khối này', 'NO_CLASSES');

    const { data: rows } = await supabase
      .from('timetables')
      .select('*')
      .eq('timetable_type_id', 2)
      .eq('semester_id', semesterId)
      .eq('week_start', weekStart)
      .eq('day_of_week', dayOfWeek)
      .in('class_id', classIds);
    const groupRows = rows || [];
    if (groupRows.length === 0) return error('Không tìm thấy các dòng lịch thi của khối', 'NOT_FOUND');

    const examDate = this.examDateFromWeek(weekStart, dayOfWeek);
    const proctors = await this.assignProctors(groupRows, classIds, examDate, proctorsPerRoom);

    const { data: pc } = await supabase
      .from('exam_proctors')
      .select('exam_schedule_id, teacher_id, room_id, teachers(teacher_id, full_name), rooms(room_id, room_name)')
      .in('exam_schedule_id', groupRows.map((r: any) => r.schedule_id));
    return success({ ...proctors, proctors: pc || [] });
  }

  async findExams(params: { gradeLevel?: number; semesterId?: number; weekStart?: string; date?: string }) {
    let q = supabase
      .from('timetables')
      .select('*, subjects(*), classes(class_id, class_name, grade_level), timetable_type:timetable_type_id(*)')
      .eq('timetable_type_id', 2);
    if (params.semesterId) q = q.eq('semester_id', Number(params.semesterId));
    if (params.weekStart) q = q.eq('week_start', mondayOf(params.weekStart) || params.weekStart);
    if (params.gradeLevel) {
      const { data: cls } = await supabase.from('classes').select('class_id').eq('grade_level', Number(params.gradeLevel));
      const ids = (cls || []).map((c: any) => c.class_id);
      if (ids.length > 0) q = q.in('class_id', ids);
    }
    const { data: schedules } = await q.order('day_of_week').order('period_no');

    const classIds = Array.from(new Set((schedules || []).map((r: any) => r.class_id).filter(Boolean)));
    const examScheduleIds = (schedules || []).map((r: any) => r.schedule_id);
    let assignments: any[] = [];
    if (examScheduleIds.length > 0) {
      const { data: asg } = await supabase
        .from('exam_exam_assignment')
        .select('exam_schedule_id, student_id, room_id, seat_no, students(student_id, full_name, student_code), rooms(room_id, room_name)')
        .in('exam_schedule_id', examScheduleIds);
      assignments = asg || [];
    }
    // Per-class examinee counts (number of students in each class) for display.
    let classStudentCount = new Map<number, number>();
    if (classIds.length > 0) {
      const { data: sn } = await supabase
        .from('students')
        .select('class_id')
        .in('class_id', classIds);
      classStudentCount = (sn || []).reduce((m: Map<number, number>, r: any) => {
        const cid = Number(r.class_id);
        m.set(cid, (m.get(cid) ?? 0) + 1);
        return m;
      }, new Map<number, number>());
    }
    (schedules || []).forEach((r: any) => {
      r.students_count = classStudentCount.get(Number(r.class_id)) ?? 0;
    });
    // Proctors (người coi thi) attached to the returned exam rows.
    let proctors: any[] = [];
    if (examScheduleIds.length > 0) {
      const { data: pc } = await supabase
        .from('exam_proctors')
        .select('exam_schedule_id, teacher_id, room_id, teachers(teacher_id, full_name), rooms(room_id, room_name)')
        .in('exam_schedule_id', examScheduleIds);
      proctors = pc || [];
    }
    let makeup: any[] = [];
    if (classIds.length > 0) {
      const { data: mk } = await supabase
        .from('exam_makeup')
        .select('*, classes(class_id, class_name)')
        .in('class_id', classIds);
      makeup = mk || [];
    }
    return success({ schedules: schedules || [], assignments, proctors, makeup });
  }

async create(data: { classId: number; subjectId: number; teacherId?: number; semesterId: number; dayOfWeek: string; periodNo?: number; startTime?: string; endTime?: string; room?: string; weekStart?: string; custom_subject_name?: string; custom_teacher_name?: string; timetableTypeId?: number }) {
const semResult = await this.semesters();
const dbSemesters = semResult.success ? (semResult.data ?? []) : [];
const validSemesterIds = new Set(dbSemesters.map((s: any) => s.semester_id));
const fallbackSemesterId = activeSemesterId(dbSemesters);
const semId = data.semesterId && validSemesterIds.has(data.semesterId) ? data.semesterId : fallbackSemesterId;

const periodNo = data.periodNo
const timetableTypeId = data.timetableTypeId && [1, 2].includes(Number(data.timetableTypeId)) ? Number(data.timetableTypeId) : 1;
const insert: Record<string, any> = {
class_id: data.classId,
subject_id: data.subjectId,
semester_id: semId,
day_of_week: data.dayOfWeek,
timetable_type_id: timetableTypeId,
};
if (periodNo) insert.period_no = periodNo;
if (data.teacherId) insert.teacher_id = data.teacherId;
if (data.startTime) insert.start_time = data.startTime;
if (data.endTime) insert.end_time = data.endTime;
if (data.room) insert.room = data.room;
if (data.custom_subject_name) insert.custom_subject_name = data.custom_subject_name;
if (data.custom_teacher_name) insert.custom_teacher_name = data.custom_teacher_name;

const weekStart = mondayOf(data.weekStart);
if (weekStart) insert.week_start = weekStart;

  if (data.teacherId && periodNo && semId && timetableTypeId !== 2) {
    let conflictQuery = supabase
      .from('timetables')
      .select('schedule_id, class_id, classes(class_name)')
      .eq('semester_id', semId)
      .eq('day_of_week', data.dayOfWeek)
      .eq('period_no', periodNo)
      .eq('teacher_id', data.teacherId)
      .neq('class_id', data.classId);
    if (weekStart) {
      conflictQuery = conflictQuery.eq('week_start', weekStart);
    }
    const conflict = await conflictQuery;

    if (!conflict.error && conflict.data && conflict.data.length > 0) {
      const row = conflict.data[0];
      const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes;
      let clsName = cls?.class_name;
      if (!clsName) {
        const { data: c } = await supabase
          .from('classes')
          .select('class_name')
          .eq('class_id', row.class_id)
          .maybeSingle();
        clsName = c?.class_name;
      }
      return error(
        'Giáo viên đã có tiết dạy ' + (clsName || ('Lớp ' + row.class_id)) + ' vào tiết ' + periodNo + ' thứ ' + data.dayOfWeek + ' trong học kỳ này',
        'TEACHER_CONFLICT'
      );
    }
  }

// Remove any duplicate entries for this slot first, then insert
// M7: chỉ xoá dòng CÙNG LOẠI (timetable_type_id) — trước đây việc lưu slot bình thường
// vô tình xoá luôn Lịch thi đặt ở slot đó.
if (periodNo) {
const dupDelete = supabase
.from('timetables')
.delete()
.eq('class_id', data.classId)
.eq('day_of_week', data.dayOfWeek)
.eq('period_no', periodNo)
.eq('semester_id', semId)
.eq('timetable_type_id', data.timetableTypeId ?? 1);
if (weekStart) {
  dupDelete.eq('week_start', weekStart);
}
await dupDelete;
}

const result = await supabase
.from('timetables')
.insert(insert)
.select('*, subjects(*), classes(*)');

if (result.error) {
return error(result.error.message, 'DB_ERROR');
}
return success(result.data ?? null);
}

async remove(id: number) {
const lookup = await supabase
.from('timetables')
.select('class_id, day_of_week, period_no, week_start, semester_id, timetable_type_id')
.eq('schedule_id', id)
.maybeSingle();

if (lookup.error) {
return error(lookup.error.message, 'DB_ERROR');
}

const entry = lookup.data;
if (!entry) {
return error('Entry not found', 'DB_ERROR');
}

const isExam = Number(entry.timetable_type_id) === 2;

// If this is an exam row, remove its seat assignments and proctors too.
if (isExam) {
  await supabase.from('exam_exam_assignment').delete().eq('exam_schedule_id', id);
  await supabase.from('exam_proctors').delete().eq('exam_schedule_id', id);
}

// Delete ALL entries for this slot in the same week — handles duplicate seed data
const slotDelete = supabase
.from('timetables')
.delete()
.eq('class_id', entry.class_id)
.eq('day_of_week', entry.day_of_week)
.eq('period_no', entry.period_no);
if (entry.week_start) slotDelete.eq('week_start', entry.week_start);
if (entry.timetable_type_id != null) slotDelete.eq('timetable_type_id', entry.timetable_type_id);
const result = await slotDelete;

if (result.error) {
return error(result.error.message, 'DB_ERROR');
}

// Restore displaced "Học bù" lessons back to their original slots when an
// exam is deleted: put each makeup subject back where it was (the exam slot)
// and remove the temporary makeup row + record.
if (isExam) {
  const { data: makeups } = await supabase
    .from('exam_makeup')
    .select('*')
    .eq('exam_schedule_id', id);
  for (const m of (makeups || [])) {
    if (m.makeup_schedule_id) {
      const { data: mkRow } = await supabase
        .from('timetables')
        .select('*')
        .eq('schedule_id', m.makeup_schedule_id)
        .maybeSingle();
      if (mkRow) {
        await supabase.from('timetables').insert({
          class_id: mkRow.class_id,
          subject_id: mkRow.subject_id,
          teacher_id: mkRow.teacher_id ?? null,
          semester_id: entry.semester_id ?? mkRow.semester_id,
          day_of_week: entry.day_of_week ?? mkRow.day_of_week,
          period_no: entry.period_no ?? mkRow.period_no,
          week_start: entry.week_start ?? mkRow.week_start,
          timetable_type_id: 1,
          custom_subject_name: mkRow.custom_subject_name ?? null,
          custom_teacher_name: mkRow.custom_teacher_name ?? null,
          room: mkRow.room ?? null,
        });
        await supabase.from('timetables').delete().eq('schedule_id', m.makeup_schedule_id);
      }
    }
    await supabase.from('exam_makeup').delete().eq('makeup_id', m.makeup_id);
  }
}

// Cleanup any makeup records pointing to the deleted row.
await supabase.from('exam_makeup').update({ makeup_schedule_id: null }).eq('makeup_schedule_id', id);
await supabase.from('exam_makeup').delete().eq('makeup_schedule_id', id).is('original_schedule_id', null);

return success(result.data ?? null);
      }

      // Wipe the regular (type=1) timetable for an entire grade. Used by the
  // "Xóa TKB toàn khối" button: clears all scheduled lessons for the grade's
  // classes within a semester, optionally restricted to one week.
  async clearGradeTimetable(params: { gradeLevel: number; semesterId?: number; weekStart?: string }) {
    const gradeLevel = Number(params.gradeLevel);
    if (!Number.isFinite(gradeLevel)) return error('Thiếu khối (gradeLevel)', 'VALIDATION_ERROR');

    let classQ = supabase.from('classes').select('class_id').eq('grade_level', gradeLevel);
    if (params.semesterId) {
      const { data: semRow } = await supabase
        .from('semesters')
        .select('school_year_id')
        .eq('semester_id', Number(params.semesterId))
        .maybeSingle();
      if (semRow?.school_year_id != null) classQ = classQ.eq('school_year_id', semRow.school_year_id);
    }
    const { data: classRows } = await classQ;
    const classIds = (classRows || []).map((c: any) => Number(c.class_id)).filter((n: any) => Number.isFinite(n));
    if (classIds.length === 0) return success({ deleted: 0 });

    const delQuery = supabase
      .from('timetables')
      .delete()
      .in('class_id', classIds)
      .eq('timetable_type_id', 1);
    if (params.semesterId) delQuery.eq('semester_id', Number(params.semesterId));
    if (params.weekStart) {
      const monday = mondayOf(params.weekStart);
      if (monday) delQuery.eq('week_start', monday);
    }
    const { data, error: err } = await delQuery.select('schedule_id');
    if (err) return error(err.message, 'DB_ERROR');
    return success({ deleted: (data || []).length });
  }

      async getOrCreateSubject(data: { subject_name: string; subject_code?: string }) {
        const name = (data.subject_name || '').trim();
        if (!name) return error('Tên môn học không được để trống', 'VALIDATION_ERROR');
        const { data: existing, error: findErr } = await supabase
          .from('subjects')
          .select('*')
          .ilike('subject_name', name)
          .maybeSingle();
        if (findErr) return error(findErr.message, 'DB_ERROR');
        if (existing) return success(existing);
        let code = (data.subject_code || 'TDK').trim().toUpperCase().slice(0, 8);
        if (!code) code = 'M';
        code += Math.floor(Math.random() * 9000 + 1000);
        const { data: created, error: insErr } = await supabase
          .from('subjects')
          .insert({ subject_name: name, subject_code: code })
          .select('*')
          .single();
        if (insErr) return error(insErr.message, 'DB_ERROR');
        return success(created);
      }

      async subjects() {
let result = await supabase
.from('subjects')
.select('*')
.order('subject_name');

if (result.error || !result.data || result.data.length === 0) {
  const defaultSubs = [
    { subject_code: 'TOAN', subject_name: 'Toán học' },
    { subject_code: 'VAN', subject_name: 'Ngữ văn' },
    { subject_code: 'ENG', subject_name: 'Tiếng Anh' },
    { subject_code: 'LY', subject_name: 'Vật lý' },
    { subject_code: 'HOA', subject_name: 'Hóa học' },
    { subject_code: 'SINH', subject_name: 'Sinh học' },
    { subject_code: 'SU', subject_name: 'Lịch sử' },
    { subject_code: 'DIA', subject_name: 'Địa lý' },
    { subject_code: 'TIN', subject_name: 'Tin học' },
    { subject_code: 'TD', subject_name: 'Thể dục' },
    { subject_code: 'GDCD', subject_name: 'GDCD' },
    { subject_code: 'MT', subject_name: 'Mỹ thuật' },
    { subject_code: 'AN', subject_name: 'Âm nhạc' },
    { subject_code: 'CC', subject_name: 'Chào cờ' },
    { subject_code: 'SH', subject_name: 'Sinh hoạt lớp' },
  ];
  await supabase.from('subjects').insert(defaultSubs);
  result = await supabase.from('subjects').select('*').order('subject_name');
}

if (result.error) {
return error(result.error.message, 'DB_ERROR');
}

return success(result.data ?? []);
}

async semesters() {
let result = await supabase
.from('semesters')
.select('*, school_year:school_years(*)')
.order('semester_id');

if (result.error || !result.data || result.data.length === 0) {
  let { data: sy } = await supabase.from('school_years').select('school_year_id').limit(1);
  let syId = sy && sy.length > 0 ? sy[0].school_year_id : null;

  if (!syId) {
    const { data: newSy } = await supabase.from('school_years').insert({
      year_name: '2023-2024',
      start_date: '2023-09-05',
      end_date: '2024-05-31',
    }).select('school_year_id').maybeSingle();
    syId = newSy?.school_year_id || 1;
  }

  await supabase.from('semesters').insert([
    { semester_name: 'Học kỳ I - 2023-2024', school_year_id: syId, is_active: true },
    { semester_name: 'Học kỳ II - 2023-2024', school_year_id: syId, is_active: false },
  ]);

  result = await supabase
    .from('semesters')
    .select('*, school_year:school_years(*)')
    .order('semester_id');
}

if (result.error) {
return error(result.error.message, 'DB_ERROR');
}

return success(result.data ?? []);
}

async bulkCreate(entries: Array<{ classId: number; subjectId: number; teacherId?: number; semesterId?: number; dayOfWeek: string; periodNo?: number; room?: string; custom_subject_name?: string; custom_teacher_name?: string; timetableTypeId?: number }>, weekStart?: string) {
  if (!entries || entries.length === 0) {
    return success(true);
  }

  const targetWeekStart = mondayOf(weekStart);

  // Ensure subjects exist in DB
  const subResult = await this.subjects();
  const dbSubjects = subResult.success ? subResult.data : [];
  const validSubjectIds = new Set(dbSubjects.map((s: any) => s.subject_id));
  const fallbackSubjectId = dbSubjects.length > 0 ? dbSubjects[0].subject_id : 1;

  // Fetch valid teacher_ids from DB
  const { data: teachers } = await supabase.from('teachers').select('teacher_id');
  const validTeacherIds = new Set((teachers || []).map((t: any) => t.teacher_id));

  // Ensure semesters exist in DB and fetch a valid semester_id
  const semResult = await this.semesters();
  const dbSemesters = semResult.success ? (semResult.data ?? []) : [];
  const validSemesterIds = new Set(dbSemesters.map((s: any) => s.semester_id));
  const fallbackSemesterId = activeSemesterId(dbSemesters);

  const classIds = Array.from(new Set(entries.map(e => e.classId).filter(Boolean)));
  if (classIds.length > 0) {
    const delQuery = supabase.from('timetables').delete().in('class_id', classIds);
    if (targetWeekStart) delQuery.eq('week_start', targetWeekStart);
    const { error: delErr } = await delQuery;
    if (delErr) {
      console.error('Bulk timetable delete error:', delErr);
    }
  }

  // Fetch teaching assignments for teacher assignment lookup
  const { data: assignments } = await supabase.from('teaching_assignments').select('class_id, subject_id, teacher_id');
  const assignmentMap = new Map<string, number>();
  (assignments || []).forEach((a: any) => {
    assignmentMap.set(`${a.class_id}_${a.subject_id}`, Number(a.teacher_id));
  });

  const rows = entries.map(e => {
    const sId = validSubjectIds.has(e.subjectId) ? e.subjectId : fallbackSubjectId;
    let tId = e.teacherId && validTeacherIds.has(e.teacherId) ? e.teacherId : null;

    if (!tId) {
      const assigned = assignmentMap.get(`${e.classId}_${sId}`);
      if (assigned && validTeacherIds.has(assigned)) {
        tId = assigned;
      }
    }

    const semId = e.semesterId && validSemesterIds.has(e.semesterId) ? e.semesterId : fallbackSemesterId;

    const row: Record<string, any> = {
      class_id: e.classId,
      subject_id: sId,
      semester_id: semId,
      day_of_week: String(e.dayOfWeek),
      period_no: e.periodNo || 1,
      room: e.room || null,
      timetable_type_id: e.timetableTypeId && [1, 2].includes(Number(e.timetableTypeId)) ? Number(e.timetableTypeId) : 1,
    };
    if (targetWeekStart) row.week_start = targetWeekStart;
    if (tId) row.teacher_id = tId;
    if (e.custom_subject_name) row.custom_subject_name = e.custom_subject_name;
    if (e.custom_teacher_name) row.custom_teacher_name = e.custom_teacher_name;
    return row;
  });

  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error: err } = await supabase.from('timetables').insert(batch);
    if (err) {
      console.error('Bulk timetable insert error:', err);
      return error(err.message, 'DB_ERROR');
    }
  }

  return success(true);
}
}

export const timetableService = new TimetableService();

