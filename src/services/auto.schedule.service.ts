import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';

// ─────────────────────────────────────────────────────────────
// Auto timetable scheduler (server-side).
//
// Days: Thứ 2 (2) … Thứ 7 (7). Periods: 1..5 morning, 6..10 afternoon.
// Hard constraints (as requested by the school):
//   • A day's subjects are packed starting from tiết 1 — no gaps.
//   • Every used day has AT LEAST 3 periods (max 5).
//   • Teacher = the one actually responsible (teaching_assignments,
//     then rule teacher, then exact department match). No fuzzy names.
// ─────────────────────────────────────────────────────────────

const MIN_PER_DAY = 3;
const MAX_PER_DAY = 5;

// Khoa học tự nhiên (KHTN) is stored as a single subject in the DB, but the
// school schedules it as three sub-disciplines (Sinh / Lý / Hóa). When the
// auto-scheduler meets the KHTN subject it expands it into these virtual
// sub-subjects (one period each), assigns the sub-discipline teacher, and
// persists each row back to subject 17 with a custom_subject_name.
const KHTN_SUBJECT_ID = 17;
const KHTN_PARTS: Array<{ code: string; name: string; nameFrag: string }> = [
  { code: 'KHTN-SINH', name: 'KHTN - Sinh', nameFrag: 'binh' },
  { code: 'KHTN-LY', name: 'KHTN - Lý', nameFrag: 'thu' },
  { code: 'KHTN-HOA', name: 'KHTN - Hóa', nameFrag: 'duc' },
];

const normalize = (s: string) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');

function mondayOf(isoStr?: string): string {
  let date: Date;
  if (isoStr) date = new Date(`${isoStr}T00:00:00Z`);
  else date = new Date();
  if (isNaN(date.getTime())) date = new Date();
  const dow = date.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().split('T')[0];
}

function mondayWeekStarts(start?: string | null, end?: string | null): string[] {
  if (!start || !end) return [mondayOf()];
  const s = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (isNaN(s.getTime()) || isNaN(endDate.getTime())) return [mondayOf()];
  const d = new Date(s);
  const day = d.getDay();
  const delta = day === 1 ? 0 : day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + delta);
  const fmt = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const out: string[] = [];
  while (d <= endDate) {
    out.push(fmt(d));
    d.setDate(d.getDate() + 7);
  }
  if (out.length === 0) out.push(fmt(d));
  return out;
}

// Deterministic per-class PRNG (seeded by class_id) so every class gets a
// different layout while re-running the same class yields the same result.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Balanced bucket: spread `counts` into `days` buckets each within [min,max].
function distribute(counts: number, days: number, min: number, max: number): number[] {
  const out: number[] = [];
  let remaining = counts;
  for (let d = 0; d < days; d++) {
    const left = days - d;
    if (d === days - 1) {
      out.push(remaining);
      remaining = 0;
      break;
    }
    let v = Math.round(remaining / left);
    v = Math.max(min, Math.min(max, v));
    const minLeft = min * (left - 1);
    const maxLeft = max * (left - 1);
    if (remaining - v < minLeft) v = remaining - minLeft;
    if (remaining - v > maxLeft) v = remaining - maxLeft;
    v = Math.max(min, Math.min(max, v));
    v = Math.min(remaining, v);
    out.push(v);
    remaining -= v;
  }
  return out;
}

// Build the per-day period counts for a class.
//
// When the user configures a morning-only profile (6 buổi sáng; `d3` days run
// 3 tiết and `d4` days run 4 tiết), each day's MORNING holds exactly its base
// (3 or 4). Any subject periods beyond the total morning capacity are carried
// into the AFTERNOON (tiết 6+) so nothing is dropped.
// Returns { caps, morning, shortfall } where `caps` is the total periods per
// day (morning + afternoon) and `morning` is how many of them are morning tiết.
function buildDayCaps(
  total: number,
  profile?: { d3: number; d4: number },
  maxDay = 10,
  seed = 1
): { caps: number[]; morning: number[]; shortfall: number } {
  const N = 6; // 6 buổi sáng / week
  const FULL = 5; // a normal morning holds tiết 1..5

  if (!profile || (profile.d3 <= 0 && profile.d4 <= 0)) {
    // default: no afternoon split — spread evenly across up to 6 days, min 3
    let days = 6;
    if (total < MIN_PER_DAY * 6) days = Math.max(1, Math.ceil(total / MIN_PER_DAY));
    days = Math.min(6, Math.max(1, days));
    const maxPerDay = Math.max(MIN_PER_DAY, Math.ceil(total / days));
    const caps = distribute(total, days, MIN_PER_DAY, maxPerDay);
    return { caps, morning: caps.slice(), shortfall: 0 };
  }

  // every day starts with a full morning; then mark the specific short days
  const morning: number[] = Array.from({ length: N }, () => FULL);
  const d4 = Math.min(N, Math.max(0, Math.floor(profile.d4)));
  const d3 = Math.min(N - d4, Math.max(0, Math.floor(profile.d3)));

  // choose WHICH days are short (4-tiết then 3-tiết), spread randomly across
  // the week (seeded per class) so they don't always land on Thứ 2 / Thứ 3
  const rng = mulberry32(seed);
  const dayIdx = shuffle(Array.from({ length: N }, (_, i) => i), rng);
  const short4 = new Set<number>(dayIdx.slice(0, d4));
  const short3 = new Set<number>(dayIdx.slice(d4, d4 + d3));
  for (const i of short4) morning[i] = 4;
  for (const i of short3) morning[i] = 3;

  // start with each day carrying exactly its morning base
  const caps = morning.slice();
  const morningCap = caps.reduce((a, b) => a + b, 0);

  if (total <= morningCap) {
    // fits entirely in the morning: trim from the largest days down to `total`
    let cur = caps.reduce((a, b) => a + b, 0);
    let i = 0;
    while (cur > total) {
      const d = i % N;
      if (caps[d] > 3) {
        caps[d]--;
        cur--;
      }
      i++;
    }
    return { caps, morning: caps.slice(), shortfall: 0 };
  }

  // overflow: carry the excess into the afternoon (tiết 6+) of the same days.
  // Round-robin so no single day is overloaded, capped at maxDay total/day.
  let extra = total - morningCap;
  let idx = 0;
  let guard = 0;
  while (extra > 0 && guard < 100000) {
    guard++;
    const d = idx % N;
    if (caps[d] < maxDay) {
      caps[d]++;
      extra--;
    }
    idx++;
  }
  const shortfall = Math.max(0, extra);
  return { caps, morning, shortfall };
}

// ─────────────────────────────────────────────────────────────
// Per-class placement.
//
// Each subject is pre-split into whole `double_period`-sized "blocks"
// (e.g. Toán count 5, double 2 -> blocks [2,2,1]). Blocks are then
// packed into days one-per-day (min-load), so a double subject shows as
// consecutive periods inside a single day and is never fragmented into
// isolated singles scattered across the week.
export interface AutoScheduleResult {
  semesterId: number;
  totalClasses: number;
  totalEntries: number;
  weekStarts: string[];
  teacherStats: Array<{ teacher_name: string; class_count: number; subject: string }>;
  warnings: string[];
  preview?: Array<{ class_id: number; class_name: string; day_of_week: string; period_no: number; subject_name: string; teacher_name: string | null }>;
}

interface SubjectLike {
  subject_id: number;
  subject_code?: string;
  subject_name: string;
}

export class AutoScheduleService {
  async run(input: {
    scope?: 'all' | 'selectedGrade';
    gradeLevel?: number;
    semesterId?: number;
    semesterIds?: number[];
    dryRun?: boolean;
    daysOf3Periods?: number;
    daysOf4Periods?: number;
    khtnPriority?: string | string[];
    examBlocks?: Array<{ classId?: number; gradeLevel?: number; dayOfWeek: string; session?: 'morning' | 'afternoon' | 'both' }>;
  }) {
    // "Cả 2 học kì": run once per requested semester and merge the results.
    if (input.semesterIds && input.semesterIds.length > 1) {
      const merged: any = {
        semesterIds: input.semesterIds,
        totalClasses: 0,
        totalEntries: 0,
        weekStarts: [] as string[],
        teacherStats: [] as any[],
        warnings: [] as string[],
        preview: [] as any[],
      };
      const statsMap = new Map<string, any>();
      for (const sid of input.semesterIds) {
        const r = await this.run({ ...input, semesterId: sid, semesterIds: undefined });
        if (!r.success) {
          return error(`Học kỳ ${sid} thất bại: ${r.error}`, (r as any).code || 'DB_ERROR');
        }
        const d = (r as any).data;
        merged.totalClasses += Number(d.totalClasses) || 0;
        merged.totalEntries += Number(d.totalEntries) || 0;
        merged.weekStarts.push(...(d.weekStarts || []));
        merged.preview.push(...(d.preview || []));
        merged.warnings.push(...(d.warnings || []));
        for (const s of d.teacherStats || []) {
          const prev = statsMap.get(s.teacher_name);
          if (prev) prev.class_count = Number(prev.class_count) + Number(s.class_count);
          else statsMap.set(s.teacher_name, { ...s });
        }
      }
      merged.teacherStats = Array.from(statsMap.values());
      merged.weekStarts = Array.from(new Set(merged.weekStarts));
      return success<any>(merged);
    }

    const scope = input.scope || 'all';
    const gradeLevel = scope === 'selectedGrade' && input.gradeLevel ? Number(input.gradeLevel) : null;
    const dryRun = input.dryRun === true;
    const profile =
      Number(input.daysOf3Periods) > 0 || Number(input.daysOf4Periods) > 0
        ? { d3: Math.max(0, Math.floor(Number(input.daysOf3Periods)) || 0), d4: Math.max(0, Math.floor(Number(input.daysOf4Periods)) || 0) }
        : null;

    // 1) Semester + week ranges
    const semRows = await supabase
      .from('semesters')
      .select('semester_id, semester_name, start_date, end_date, school_year_id')
      .order('semester_id');

    let semesters: any[] = semRows.error ? [] : (semRows.data ?? []);
    if (semesters.length === 0) {
      await supabase.from('semesters').insert([
        { semester_name: 'Học kỳ I', term_order: 1 },
        { semester_name: 'Học kỳ II', term_order: 2 },
      ]);
      const again = await supabase.from('semesters').select('*').order('semester_id');
      semesters = again.error ? [] : (again.data ?? []);
    }
    if (semesters.length === 0) return error('Chưa có học kỳ nào. Vui lòng tạo học kỳ trước.', 'NO_SEMESTER');

    let selSem = semesters.find((s: any) => Number(s.semester_id) === Number(input.semesterId));
    if (!selSem) selSem = semesters.find((s: any) => s.is_active === true) || semesters[0];
    const semesterId = Number(selSem.semester_id);
    const weekStarts = mondayWeekStarts(selSem.start_date, selSem.end_date);

    // 2) Master data
    const [clsRes, subjRes, ruleRes, assignRes, tRes, roomRes] = await Promise.all([
      supabase.from('classes').select('class_id, class_name, grade_level, homeroom_teacher_id, fixed_room_id, school_year_id').order('class_id'),
      supabase.from('subjects').select('subject_id, subject_code, subject_name').order('subject_name'),
      supabase.from('schedule_rules').select('subject_id, periods_per_week, session, double_period, teacher_id, enabled'),
      supabase.from('teaching_assignments').select('teacher_id, subject_id, class_id'),
      supabase.from('teachers').select('teacher_id, full_name, subject_id, teacher_code'),
      supabase.from('rooms').select('room_id, room_name, room_type'),
    ]);

    let subjects: SubjectLike[] = subjRes.error ? [] : (subjRes.data ?? []);
    if (subjects.length === 0) {
      const defaults: SubjectLike[] = [
        { subject_code: 'TOAN', subject_name: 'Toán học', subject_id: 0 },
        { subject_code: 'VAN', subject_name: 'Ngữ văn', subject_id: 0 },
        { subject_code: 'ENG', subject_name: 'Tiếng Anh', subject_id: 0 },
        { subject_code: 'LY', subject_name: 'Vật lý', subject_id: 0 },
        { subject_code: 'HOA', subject_name: 'Hóa học', subject_id: 0 },
        { subject_code: 'SINH', subject_name: 'Sinh học', subject_id: 0 },
        { subject_code: 'SU', subject_name: 'Lịch sử', subject_id: 0 },
        { subject_code: 'DIA', subject_name: 'Địa lý', subject_id: 0 },
        { subject_code: 'TIN', subject_name: 'Tin học', subject_id: 0 },
        { subject_code: 'TD', subject_name: 'Thể dục', subject_id: 0 },
        { subject_code: 'CC', subject_name: 'Chào cờ', subject_id: 0 },
        { subject_code: 'SH', subject_name: 'Sinh hoạt lớp', subject_id: 0 },
      ];
      const ins = await supabase
        .from('subjects')
        .insert(defaults.map(({ subject_code, subject_name }) => ({ subject_code, subject_name })))
        .select('subject_id, subject_code, subject_name');
      subjects = ins.error ? [] : (ins.data ?? []);
      if (subjects.length === 0) return error('Không có dữ liệu môn học', 'NO_SUBJECT');
    }

    const classes: any[] = clsRes.error ? [] : (clsRes.data ?? []);
    const rules: any[] = ruleRes.error ? [] : (ruleRes.data ?? []);
    const assignments: any[] = assignRes.error ? [] : (assignRes.data ?? []);
    const teachers: any[] = tRes.error ? [] : (tRes.data ?? []);
    const rooms: any[] = roomRes.error ? [] : (roomRes.data ?? []);

    // 3) KHTN expansion: replace the single KHTN subject with virtual
    // sub-disciplines. Teacher lookup matches by full-name fragment.
    const khtnPartTeacher = new Map<string, number>(); // synthetic code -> teacher_id
    const khtnSynthId = new Map<string, number>(); // synthetic code -> virtual subject_id
    const khtnSynthName = new Map<string, string>(); // synthetic code -> custom name
    const khtnSynthBySubjectId = new Map<number, { code: string; name: string }>();
    const khtnMain = subjects.find((s) => Number(s.subject_id) === KHTN_SUBJECT_ID);
    if (khtnMain) {
      const teacherByFrag = new Map<string, number>();
      for (const t of teachers) {
        const frag = normalize(t.full_name || '');
        for (const part of KHTN_PARTS) {
          if (frag.includes(part.nameFrag)) teacherByFrag.set(part.code, Number(t.teacher_id));
        }
      }
      const synth: SubjectLike[] = [];
      KHTN_PARTS.forEach((part, i) => {
        const synthId = -(1000 + i);
        khtnSynthId.set(part.code, synthId);
        khtnSynthName.set(part.code, part.name);
        khtnSynthBySubjectId.set(synthId, { code: part.code, name: part.name });
        const tId = teacherByFrag.get(part.code);
        if (tId) khtnPartTeacher.set(part.code, tId);
        synth.push({ subject_id: synthId, subject_code: part.code, subject_name: part.name });
      });
      subjects = subjects.filter((s) => Number(s.subject_id) !== KHTN_SUBJECT_ID).concat(synth);
    }

    // 4) Fixed subjects
    const cc = subjects.find((s) => s.subject_code?.toUpperCase() === 'CC' || normalize(s.subject_name).includes('chao co'));
    const sh = subjects.find((s) => s.subject_code?.toUpperCase() === 'SH' || normalize(s.subject_name).includes('sinh hoat'));
    const ccId = cc ? Number(cc.subject_id) : null;
    const shId = sh ? Number(sh.subject_id) : null;

    // 4) Effective counts / double / session per subject.
    // Strictly follows schedule_rules: a subject with no rule, a disabled
    // rule (enabled=false), or 0 periods/week is NOT scheduled at all.
    // A subject set to 2 liền (double_period=2) must appear as consecutive pairs.
    const countMap = new Map<number, number>();
    const doubleMap = new Map<number, number>();
    for (const s of subjects) {
      const id = Number(s.subject_id);
      const rule = rules.find((r) => Number(r.subject_id) === id);
      if (rule && rule.enabled !== false && Number(rule.periods_per_week) > 0) {
        countMap.set(id, Number(rule.periods_per_week));
        doubleMap.set(id, [1, 2, 3].includes(Number(rule.double_period)) ? Number(rule.double_period) : 1);
      } else {
        countMap.set(id, 0);
        doubleMap.set(id, 1);
      }
    }
    // KHTN: the real rule lives on subject 17; split its periods across the
    // virtual sub-disciplines (each counts as a distinct single-period row).
    // Base = total/3 for each part; the remainder (total % 3) is handed out
    // one at a time starting from the priority part (default Hóa), so e.g.
    // total=4 → priority gets 2, the others 1; total=5 → 2, 2, 1.
    if (khtnMain) {
      const khtnRule = rules.find((r) => Number(r.subject_id) === KHTN_SUBJECT_ID);
      const total =
        khtnRule && khtnRule.enabled !== false ? Math.max(0, Math.floor(Number(khtnRule.periods_per_week))) : 0;
      if (total > 0) {
        const base = Math.floor(total / KHTN_PARTS.length);
        let remainder = total % KHTN_PARTS.length;
        const rawPri = input.khtnPriority == null ? ['Hóa'] : Array.isArray(input.khtnPriority) ? input.khtnPriority : [input.khtnPriority];
        const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const priority = rawPri.map((v) => norm(v)).filter(Boolean);
        // Build the distribution order: selected priority parts first (in the order
        // they were picked), then the remaining parts in their default order.
        const order: typeof KHTN_PARTS = [];
        for (const p of priority) {
          const match = KHTN_PARTS.find((x) => x.nameFrag === p || norm(x.name).includes(p));
          if (match && !order.some((o) => o.code === match.code)) order.push(match);
        }
        for (const p of KHTN_PARTS) if (!order.some((o) => o.code === p.code)) order.push(p);
        for (const part of order) {
          const synthId = khtnSynthId.get(part.code)!;
          const add = remainder > 0 ? 1 : 0;
          countMap.set(synthId, base + add);
          doubleMap.set(synthId, 1);
          if (add) remainder--;
        }
      }
    }

    // 5) Teacher lookup
    const assignedTeacher = new Map<string, number>(); // `${classId}_${subjectId}` -> teacherId
    (assignments || []).forEach((a) => assignedTeacher.set(`${Number(a.class_id)}_${Number(a.subject_id)}`, Number(a.teacher_id)));

    const ruleTeacher = new Map<number, number>(); // subjectId -> teacherId
    (rules || []).forEach((r) => {
      if (r.teacher_id) ruleTeacher.set(Number(r.subject_id), Number(r.teacher_id));
    });

    const subjectTeacherPool = new Map<number, number[]>(); // subjectId -> [teacherId]
    for (const t of teachers) {
      const sid = Number(t.subject_id);
      if (sid && t.subject_id != null) {
        if (!subjectTeacherPool.has(sid)) subjectTeacherPool.set(sid, []);
        subjectTeacherPool.get(sid)!.push(Number(t.teacher_id));
      }
    }

    // teacherId -> subjectId (from the teacher's own subject_id) for homeroom priority.
    const teacherSubjectId = new Map<number, number>();
    (teachers || []).forEach((t) => {
      if (t.subject_id != null) teacherSubjectId.set(Number(t.teacher_id), Number(t.subject_id));
    });

    const teacherName = new Map<number, string>();
    (teachers || []).forEach((t) => teacherName.set(Number(t.teacher_id), t.full_name));

    // teacher -> subject (from assignments) for stats
    const teacherSubject = new Map<number, string>();
    const subjectNameById = new Map<number, string>();
    subjects.forEach((s) => subjectNameById.set(Number(s.subject_id), s.subject_name));
    (assignments || []).forEach((a) => {
      if (!teacherSubject.has(Number(a.teacher_id))) {
        teacherSubject.set(Number(a.teacher_id), subjectNameById.get(Number(a.subject_id)) || '');
      }
    });

    // 6) Rooms
    const roomsById = new Map<number, string>();
    (rooms || []).forEach((r) => roomsById.set(Number(r.room_id), r.room_name));

    // 7) Target classes
    // Only schedule for classes belonging to the same school year as the
    // selected semester — never for classes of other school years.
    const selYear = selSem && Number(selSem.school_year_id) > 0 ? Number(selSem.school_year_id) : null;
    let target = classes;
    if (selYear != null) target = target.filter((c) => Number(c.school_year_id) === selYear);
    if (gradeLevel) target = classes.filter((c) => Number(c.grade_level) === gradeLevel && (selYear == null || Number(c.school_year_id) === selYear));
    if (target.length === 0) return error(gradeLevel ? 'Không có lớp nào thuộc khối này' : 'Không có lớp học nào', 'NO_CLASSES');
    const classIds = target.map((c) => Number(c.class_id));

    const generated: any[] = [];
    const teacherClassSet = new Map<number, Set<number>>();
    const teacherOccupied = new Set<string>(); // `${tid}_${day}_${period}`
    const warnings: string[] = [];

    // ── Exam days: reserve cells so no regular subject is placed there. ──
    // examSlotKeys: `${classId}_${day}_${period}` for every blocked period in
    // the exam's session/morning. Also record per-class blocked sessions keyed
    // by day so we can skip those slots during numbering.
    const morningPeriods = new Set([1, 2, 3, 4, 5]);
    const afternoonPeriods = new Set([6, 7, 8, 9, 10]);
    const examSlotKeys = new Set<string>();
    const examBlockedSessions = new Map<string, Set<'morning' | 'afternoon'>>(); // `${classId}_${day}`
    for (const blk of input.examBlocks || []) {
      const day = String(blk.dayOfWeek).trim();
      if (!day) continue;
      const sess = blk.session || 'morning';
      let affectedClassIds: number[] = [];
      if (blk.classId != null) {
        affectedClassIds = [Number(blk.classId)];
      } else if (blk.gradeLevel != null) {
        affectedClassIds = target.filter((c) => Number(c.grade_level) === Number(blk.gradeLevel)).map((c) => Number(c.class_id));
      }
      if (affectedClassIds.length === 0) affectedClassIds = classIds;
      const periodSet = sess === 'afternoon' ? afternoonPeriods : morningPeriods;
      const markers = sess === 'both' ? (['morning', 'afternoon'] as const) : ([sess] as const);
      for (const cid of affectedClassIds) {
        for (const p of periodSet) examSlotKeys.add(`${cid}_${day}_${p}`);
        const key = `${cid}_${day}`;
        const cur = examBlockedSessions.get(key) || new Set<'morning' | 'afternoon'>();
        markers.forEach((m) => cur.add(m));
        examBlockedSessions.set(key, cur);
      }
    }

    const roomForEntry = (subj: SubjectLike, cls: any): string | undefined => {
      const n = normalize(`${subj.subject_name} ${subj.subject_code || ''}`);
      if (n.includes('the duc')) {
        const found = rooms.find((r) => normalize(`${r.room_name} ${r.room_type || ''}`).includes('san'));
        if (found) return found.room_name;
      }
      if (n.includes('tin')) {
        const found = rooms.find((r) => /lab|it|may/.test(normalize(`${r.room_name} ${r.room_type || ''}`)));
        if (found) return found.room_name;
      }
      if (cls.fixed_room_id) return roomsById.get(Number(cls.fixed_room_id));
      return undefined;
    };

    // ── per-class planning ──
    for (const cls of target) {
      const classId = Number(cls.class_id);

      const regular: Array<{ subject: SubjectLike; count: number; double: number }> = [];
      for (const s of subjects) {
        const id = Number(s.subject_id);
        if (id === ccId || id === shId) continue;
        const count = countMap.get(id) || 0;
        if (count <= 0) continue;
        regular.push({ subject: s, count, double: doubleMap.get(id) || 1 });
      }

      // CC / SH only appear if their rule is enabled with periods > 0
      const ccRes = ccId && (countMap.get(ccId) || 0) > 0 ? 1 : 0;
      const shRes = shId && (countMap.get(shId) || 0) > 0 ? 1 : 0;
      const totalUnits = regular.reduce((s, r) => s + r.count, 0) + ccRes + shRes;
      if (totalUnits === 0) {
        warnings.push(`Lớp ${cls.class_name}: không có môn nào để xếp.`);
        continue;
      }

      // day lengths: either the configured morning 3/4 profile (with overflow
      // going to the afternoon) or the default balanced spread. Seeded by the
      // class id so the short days land on different weekdays per class.
      const built = buildDayCaps(totalUnits, profile, 10, classId);
      const dayMax: number[] = built.caps;
      const morningBase: number[] = built.morning;
      const daysUsed = dayMax.length;
      if (built.shortfall > 0) {
        warnings.push(
          `Lớp ${cls.class_name}: ${built.shortfall} tiết không đủ chỗ trong buổi sáng, đã dồn phần còn lại xuống buổi chiều.`
        );
      }

      // ── Exam-day handling: if this class has a blocked session on some days,
      // reduce that day's available capacity so no regular subject lands there.
      // Morning block reduces up to 5 tiết; afternoon up to 5 tiết.
      if (examBlockedSessions.get(`${classId}`)?.size) {
        for (let d = 0; d < daysUsed; d++) {
          const dayStr = String(d + 2);
          const dayKeyPrefix = `${classId}_${dayStr}_`;
          let blockedCount = 0;
          for (const k of examSlotKeys) {
            if (k.startsWith(dayKeyPrefix)) blockedCount++;
          }
          if (blockedCount > 0) {
            const reduced = dayMax[d] - blockedCount;
            dayMax[d] = Math.max(0, reduced);
          }
        }
      }

      // reserved cells: Chào cờ at day 0 period 1, Sinh hoạt at last day (last period)
      const ccDay = 0;
      const shDay = daysUsed - 1;

      // cells already claimed by fixed subjects per day (baseline load)
      const baseline: number[] = Array.from({ length: daysUsed }, (_, d) => {
        let b = 0;
        if (ccRes && d === ccDay) b += 1;
        if (shRes && d === shDay && shDay !== ccDay) b += 1;
        return b;
      });

      // per-class randomization (seeded by class_id) so timetables differ
      // across classes and Math isn't always dumped into the afternoon slot
      const rng = mulberry32(classId);
      const dayOrder = shuffle(Array.from({ length: daysUsed }, (_, d) => d), rng);

      // pre-split every regular subject into whole `double`-sized blocks
      const blocks: Array<{ subject: SubjectLike; size: number }> = [];
      for (const r of regular) {
        let rem = r.count;
        while (rem > 0) {
          const size = Math.min(r.double, rem);
          blocks.push({ subject: r.subject, size });
          rem -= size;
        }
      }
      const shuffledBlocks = shuffle(blocks, rng);

      // pack whole blocks into days (min-load), keeping each block intact in one day
      const dayAtoms: Array<Array<{ subject: SubjectLike; take: number }>> = Array.from({ length: daysUsed }, () => []);
      const daySum = Array.from({ length: daysUsed }, (_, d) => baseline[d]);
      const maxReg = (d: number) => Math.max(0, dayMax[d] - baseline[d]);
      const hasSubject = (d: number, id: number) => dayAtoms[d].some((a) => Number(a.subject.subject_id) === id);
      const insertIntoDay = (d: number, b: { subject: SubjectLike; take: number }) => {
        let idx = -1;
        for (let i = 0; i < dayAtoms[d].length; i++) {
          if (Number(dayAtoms[d][i].subject.subject_id) === Number(b.subject.subject_id)) idx = i;
        }
        if (idx === -1) dayAtoms[d].push(b);
        else dayAtoms[d].splice(idx + 1, 0, b);
      };
      for (const b of shuffledBlocks) {
        const sid = Number(b.subject.subject_id);
        let best = -1;
        // prefer a day that doesn't already hold this subject (keeps it contiguous)
        for (const d of dayOrder) {
          if (hasSubject(d, sid)) continue;
          if (daySum[d] + b.size > dayMax[d]) continue;
          if (b.size > maxReg(d)) continue;
          if (best === -1 || daySum[d] < daySum[best]) best = d;
        }
        if (best === -1) {
          for (const d of dayOrder) {
            if (hasSubject(d, sid)) continue;
            if (daySum[d] + b.size <= dayMax[d] && (best === -1 || daySum[d] < daySum[best])) best = d;
          }
        }
        if (best === -1) {
          best = dayOrder[0];
          for (const d of dayOrder.slice(1)) if (daySum[d] < daySum[best]) best = d;
        }
        insertIntoDay(best, { subject: b.subject, take: b.size });
        daySum[best] += b.size;
      }

      // repair: every used day must reach at least MIN_PER_DAY (blocks stay whole)
      for (let d = 0; d < daysUsed; d++) {
        while (daySum[d] < MIN_PER_DAY) {
          let from = -1;
          for (let x = 0; x < daysUsed; x++) {
            if (x === d) continue;
            if (dayAtoms[x].length === 0) continue;
            if (daySum[x] - MIN_PER_DAY < 1) continue;
            if (from === -1 || daySum[x] > daySum[from]) from = x;
          }
          if (from === -1) break;
          const blk = dayAtoms[from].pop()!;
          dayAtoms[d].push(blk);
          daySum[from] -= blk.take;
          daySum[d] += blk.take;
        }
      }

      // assemble period numbers. Only days configured as SHORT mornings (3 or 4
      // tiết) get the morning/afternoon split: their morning stays exactly at
      // the base (tiết 1..base) and any overflow on that day goes to the
      // afternoon (tiết 6+). Full-morning days (5 tiết) are numbered contiguously
      // 1..N like a normal day, so they never show a spurious "4-tiết" morning.
      const AFTERNOON_START = 6;
      const atoms: Array<{ day: number; period: number; subject: SubjectLike }> = [];
      for (let d = 0; d < daysUsed; d++) {
        const atList = dayAtoms[d];
        const isShortMorning = (morningBase[d] ?? 5) < 5;

        if (!isShortMorning) {
          // full-morning day: plain contiguous numbering
          let p = 1;
          if (d === ccDay && ccRes && cc) {
            atoms.push({ day: d, period: p, subject: cc });
            p++;
          }
          for (const at of atList) {
            for (let k = 0; k < at.take; k++) {
              atoms.push({ day: d, period: p, subject: at.subject });
              p++;
            }
          }
          if (d === shDay && shRes && sh) {
            atoms.push({ day: d, period: p, subject: sh });
          }
          continue;
        }

        // short-morning day: morning slots up to base, overflow to tiết 6+
        const scheduledUnits = atList.reduce((s, a) => s + a.take, 0) + baseline[d];
        const morningUnits = Math.min(morningBase[d] ?? 3, scheduledUnits);
        let morningUsed = 0;
        let afternoonUsed = 0;
        if (d === ccDay && ccRes && cc) {
          atoms.push({ day: d, period: morningUsed + 1, subject: cc });
          morningUsed++;
        }
        for (const at of atList) {
          if (morningUsed + at.take <= morningUnits) {
            for (let k = 0; k < at.take; k++) {
              atoms.push({ day: d, period: morningUsed + 1 + k, subject: at.subject });
            }
            morningUsed += at.take;
          } else {
            for (let k = 0; k < at.take; k++) {
              atoms.push({ day: d, period: AFTERNOON_START + afternoonUsed + k, subject: at.subject });
            }
            afternoonUsed += at.take;
          }
        }
        if (d === shDay && shRes && sh) {
          const p = morningUsed < morningUnits ? morningUsed + 1 : AFTERNOON_START + afternoonUsed;
          atoms.push({ day: d, period: p, subject: sh });
        }
      }

      // teacher + room + emit rows
      for (const at of atoms) {
        const subjectId = Number(at.subject.subject_id);
        const dayStr = String(at.day + 2);
        const periodNo = at.period;

        // KHTN virtual sub-discipline: force its dedicated teacher and carry a
        // custom_subject_name; the row is persisted under subject 17.
        const khtnPart = khtnSynthBySubjectId.get(subjectId);
        const storedSubjectId = khtnPart ? KHTN_SUBJECT_ID : subjectId;
        const customSubjectName = khtnPart ? khtnPart.name : undefined;

        let teacherId: number | null = khtnPart ? khtnPartTeacher.get(khtnPart.code) ?? null : null;
        if (!teacherId) teacherId = assignedTeacher.get(`${classId}_${subjectId}`) ?? null;
        if (!teacherId && ruleTeacher.has(subjectId)) teacherId = ruleTeacher.get(subjectId) ?? null;
        if (!teacherId) {
          // Homeroom teacher priority: if the class's homeroom teacher teaches
          // this subject, prefer them (free at this slot) before the pool.
          const homeroomTid = cls.homeroom_teacher_id ? Number(cls.homeroom_teacher_id) : null;
          if (homeroomTid != null && teacherSubjectId.get(homeroomTid) === subjectId) {
            const key = `${homeroomTid}_${dayStr}_${periodNo}`;
            if (!teacherOccupied.has(key)) {
              teacherId = homeroomTid;
            }
          }
        }
        if (!teacherId) {
          const pool = subjectTeacherPool.get(subjectId) || [];
          for (const tId of pool) {
            const key = `${tId}_${dayStr}_${periodNo}`;
            if (!teacherOccupied.has(key)) {
              teacherId = tId;
              break;
            }
          }
        }

        if (teacherId) {
          const key = `${teacherId}_${dayStr}_${periodNo}`;
          if (teacherOccupied.has(key)) {
            warnings.push(
              `Giáo viên ${teacherName.get(teacherId) || teacherId} trùng tiết ${periodNo} thứ ${dayStr} — bỏ gán giáo viên cho tiết này.`
            );
            teacherId = null;
          } else {
            teacherOccupied.add(key);
            if (!teacherClassSet.has(teacherId)) teacherClassSet.set(teacherId, new Set());
            teacherClassSet.get(teacherId)!.add(classId);
          }
        }

        generated.push({
          classId,
          subjectId: storedSubjectId,
          customSubjectName,
          teacherId,
          semesterId,
          dayOfWeek: dayStr,
          periodNo,
          room: roomForEntry(at.subject, cls),
        });
      }
    }

    if (generated.length === 0) {
      return error('Không xếp được tiết nào. Vui lòng kiểm tra quy tắc môn học.', 'NO_ROWS');
    }

    const teacherStats = Array.from(teacherClassSet.entries()).map(([tid, set]) => ({
      teacher_name: teacherName.get(tid) || '',
      class_count: set.size,
      subject: teacherSubject.get(tid) || '',
    }));

    const preview = generated.map((r) => ({
      class_id: r.classId,
      class_name: target.find((c) => Number(c.class_id) === r.classId)?.class_name || '',
      day_of_week: r.dayOfWeek,
      period_no: r.periodNo,
      subject_name: r.customSubjectName || subjectNameById.get(r.subjectId) || '',
      teacher_name: r.teacherId ? teacherName.get(r.teacherId) || null : null,
    }));

    if (dryRun) {
      return success<AutoScheduleResult>({
        semesterId,
        totalClasses: target.length,
        totalEntries: generated.length,
        weekStarts,
        teacherStats,
        warnings,
        preview,
      });
    }

    // 9) Persist (replace): clear the whole semester's timetable for these classes
    // first, so no stale/gapped rows from older runs remain, then insert all weeks.
    await supabase
      .from('timetables')
      .delete()
      .in('class_id', classIds)
      .eq('semester_id', semesterId);
    for (const wk of weekStarts) {
      for (const batch of chunk(generated, 100)) {
        const rows = batch.map((r) => ({
          class_id: r.classId,
          subject_id: r.subjectId,
          teacher_id: r.teacherId,
          custom_subject_name: r.customSubjectName ?? null,
          semester_id: r.semesterId,
          day_of_week: r.dayOfWeek,
          period_no: r.periodNo,
          room: r.room || null,
          week_start: wk,
        }));
        const { error: insErr } = await supabase.from('timetables').insert(rows);
        if (insErr) return error('Lỗi lưu thời khóa biểu: ' + insErr.message, 'DB_ERROR');
      }
    }

    return success<AutoScheduleResult>({
      semesterId,
      totalClasses: target.length,
      totalEntries: generated.length,
      weekStarts,
      teacherStats,
      warnings,
      preview,
    });
  }
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export const autoScheduleService = new AutoScheduleService();
