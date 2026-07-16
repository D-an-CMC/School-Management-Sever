const { createClient } = require('@supabase/supabase-js');

const URL = 'https://akurubwwxfgeduyxazyl.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrdXJ1Ynd3eGZnZWR1eXhhenlsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjcyNTc1NSwiZXhwIjoyMDk4MzAxNzU1fQ.N958cFmRxMqEDDHjBh_vvWqPdmDLzN5YBSKsqLr36pI';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  // === 1. Roles ===
  const { data: roles } = await sb.from('roles').select('*');
  console.log('Roles:', roles?.map(r => r.role_name).join(', '));
  const roleMap = {};
  if (roles) roles.forEach(r => roleMap[r.role_name] = r.role_id);
  const adminRoleId = roleMap['Admin'];
  const teacherRoleId = roleMap['GiaoVien'];
  const studentRoleId = roleMap['HocSinh-PhuHuynh'];

  // === 2. Permissions ===
  const { data: perms } = await sb.from('permissions').select('*').order('permission_id');
  console.log('Permissions:', perms?.length || 0);

  if (perms?.length && adminRoleId && teacherRoleId && studentRoleId) {
    const rp = [];
    perms.forEach(p => {
      rp.push({ role_id: adminRoleId, permission_id: p.permission_id });
      rp.push({ role_id: teacherRoleId, permission_id: p.permission_id });
      if (['view_grades','view_attendance','view_schedule','view_notifications'].includes(p.permission_key)) {
        rp.push({ role_id: studentRoleId, permission_id: p.permission_id });
      }
    });
    const { error: rpErr } = await sb.from('role_permissions').upsert(rp, { onConflict: 'role_id,permission_id' });
    console.log(rpErr ? 'role_permissions warn: ' + rpErr.message : rp.length + ' role_permissions');
  }

  // === 3. School years ===
  let { data: syData } = await sb.from('school_years').select('*');
  if (!syData?.length) {
    const { data } = await sb.from('school_years').insert([
      { year_name: '2024-2025', start_date: '2024-09-01', end_date: '2025-05-30' },
    ]).select();
    syData = data;
  }
  const sy = syData[0];
  console.log('School year:', sy.year_name);

  // === 4. Semesters ===
  let { data: semData } = await sb.from('semesters').select('*');
  if (!semData?.length) {
    const { data } = await sb.from('semesters').insert([
      { school_year_id: sy.school_year_id, semester_name: 'Hoc ki I', term_order: 1, start_date: '2024-09-01', end_date: '2025-01-15' },
      { school_year_id: sy.school_year_id, semester_name: 'Hoc ki II', term_order: 2, start_date: '2025-01-20', end_date: '2025-05-30' },
    ]).select();
    semData = data;
  }
  const hk2 = semData.find(s => s.semester_name === 'Hoc ki II') || semData[0];
  console.log('Semesters:', semData.length);

  // === 5. Subjects ===
  let { data: subjData } = await sb.from('subjects').select('*');
  if (!subjData?.length) {
    const { data } = await sb.from('subjects').insert([
      { subject_code: 'TOAN', subject_name: 'Toan' },
      { subject_code: 'LY', subject_name: 'Vat ly' },
      { subject_code: 'HOA', subject_name: 'Hoa hoc' },
      { subject_code: 'NV', subject_name: 'Ngu van' },
      { subject_code: 'TA', subject_name: 'Tieng Anh' },
    ]).select();
    subjData = data;
  }
  console.log('Subjects:', subjData.length);

  // === 6. Grade types ===
  let { data: gtData } = await sb.from('grade_types').select('*');
  if (!gtData?.length) {
    const { data } = await sb.from('grade_types').insert([
      { type_code: 'DDGtx', type_name: 'Mieng', weight: 1 },
      { type_code: 'DDG15p', type_name: '15 phut', weight: 1 },
      { type_code: 'DDGgiua', type_name: 'Giua ki', weight: 2 },
      { type_code: 'DDGck', type_name: 'Cuoi ki', weight: 3 },
    ]).select();
    gtData = data;
  }
  console.log('Grade types:', gtData.length);

  // === 7. Teachers (skip if exist) ===
  let { data: teachData } = await sb.from('teachers').select('*');
  if (!teachData?.length) {
    teachData = [];
    const teachDefs = [
      { name: 'Tran Minh Anh', phone: '0901112233', dept: 'Toan' },
      { name: 'Nguyen Van Hung', phone: '0904445566', dept: 'Vat ly' },
      { name: 'Le Thi Mai', phone: '0907778899', dept: 'Ngu van' },
      { name: 'Pham Tuan Kiet', phone: '0901234567', dept: 'Tieng Anh' },
    ];
    for (const t of teachDefs) {
      const email = t.name.toLowerCase().replace(/\s+/g, '.') + '@teacher.school.com';
      const { data: newAuth, error: authErr } = await sb.auth.admin.createUser({
        email, password: '123456', email_confirm: true, user_metadata: { full_name: t.name }
      });
      if (authErr || !newAuth?.user) {
        console.error('Teacher auth fail:', email, authErr?.message);
        continue;
      }
      const authId = newAuth.user.id;
      const { data: userRec } = await sb.from('users').insert({
        auth_id: authId, email, username: t.name, role_id: teacherRoleId, is_active: true
      }).select().single();

      // Use correct teacher columns: teacher_id, user_id, teacher_code, full_name, gender, date_of_birth, phone, department, hire_date
      const { data: tRec, error } = await sb.from('teachers').insert({
        user_id: userRec.user_id,
        full_name: t.name,
        gender: t.name.includes('Thi') ? 'Nu' : 'Nam',
        date_of_birth: '1985-05-15',
        phone: t.phone,
        department: t.dept,
        hire_date: '2015-08-15',
      }).select();
      if (error) { console.error('Teacher insert:', error.message); continue; }
      teachData.push(tRec[0]);
      console.log('Teacher:', t.name);
      await sleep(400);
    }
  } else {
    console.log('Teachers exist:', teachData.length);
  }

  // === 8. Classes ===
  let { data: clsData } = await sb.from('classes').select('*');
  if (!clsData?.length) {
    const { data } = await sb.from('classes').insert([
      { class_name: '10A1', grade_level: 10, school_year_id: sy.school_year_id, homeroom_teacher_id: teachData[0]?.teacher_id },
      { class_name: '10A2', grade_level: 10, school_year_id: sy.school_year_id, homeroom_teacher_id: teachData[1]?.teacher_id },
      { class_name: '10A3', grade_level: 10, school_year_id: sy.school_year_id, homeroom_teacher_id: teachData[2]?.teacher_id },
    ]).select();
    clsData = data;
  }
  console.log('Classes:', clsData.length);

  // === 9. Students ===
  let { data: stuData } = await sb.from('students').select('*');
  if (!stuData?.length && clsData?.length) {
    const snames = ['Nguyen','Tran','Le','Pham','Vo','Dang','Hoang','Bui','Do','Ngo'];
    const fnames = ['Kiet','Thu','Nam','Anh','Mai','Binh','Lan','Duc','Huong','Tuan'];
    const allStu = [];
    let idx = 0;
    for (const cls of clsData) {
      for (let n = 0; n < 3; n++) {
        const sn = snames[idx % snames.length];
        const fn = fnames[idx % fnames.length];
        const fullName = sn + ' ' + fn;
        const code = 'HS-2026-' + String(idx + 1).padStart(3, '0');
        const email = fullName.toLowerCase().replace(/\s+/g, '.') + '.s' + idx + '@student.school.com';
        allStu.push({ fullName, code, clsId: cls.class_id, email, idx });
        idx++;
      }
    }

    stuData = [];
    for (const s of allStu) {
      const { data: newAuth, error: authErr } = await sb.auth.admin.createUser({
        email: s.email, password: '123456', email_confirm: true, user_metadata: { full_name: s.fullName }
      });
      if (authErr || !newAuth?.user) {
        console.error('Student auth fail:', s.email, authErr?.message);
        await sleep(300);
        continue;
      }
      const { data: userRec } = await sb.from('users').insert({
        auth_id: newAuth.user.id, email: s.email, username: s.fullName, role_id: studentRoleId, is_active: true
      }).select().single();

      // Correct student columns: student_id, user_id, class_id, student_code, full_name, gender, date_of_birth, address, enrollment_date, parent_full_name, parent_phone, parent_email, parent_relationship
      const { data: stRec, error } = await sb.from('students').insert({
        user_id: userRec.user_id,
        class_id: s.clsId,
        student_code: s.code,
        full_name: s.fullName,
        gender: s.idx % 2 === 0 ? 'Nam' : 'Nu',
        date_of_birth: '2008-0' + ((s.idx % 3) + 1) + '-' + String((s.idx % 28) + 1).padStart(2, '0'),
        address: 'Ha Noi',
        parent_full_name: snames[(s.idx + 3) % snames.length] + ' Family',
        parent_phone: '09' + String(10000000 + s.idx * 1234567),
        parent_email: s.email.replace('.s' + s.idx, '.parent'),
      }).select();
      if (error) { console.error('Student insert:', error.message); continue; }
      stuData.push(stRec[0]);
      console.log('Student:', s.fullName, s.code);
      await sleep(400);
    }
  } else {
    console.log('Students exist:', stuData?.length);
  }

  // === 10. Subject results → Grade items (FK chain) ===
  if (stuData?.length && subjData?.length) {
    const { data: srCount } = await sb.from('subject_results').select('*', { count: 'exact', head: true });
    if (!srCount) {
      const srBatch = [];
      for (const s of stuData) {
        for (let j = 0; j < 2; j++) {
          srBatch.push({
            student_id: s.student_id,
            subject_id: subjData[(s.student_id + j) % subjData.length].subject_id,
            semester_id: hk2.semester_id,
            teacher_id: teachData[Math.floor(Math.random() * teachData.length)]?.teacher_id,
            dtb_mhk: +(2 + Math.random() * 8).toFixed(1),
            ranking: 'Dat yeu cau',
          });
        }
      }
      const { data: srData } = await sb.from('subject_results').insert(srBatch).select();
      console.log(srData?.length, 'subject_results');

      if (srData?.length && gtData?.length) {
        const giBatch = [];
        for (const sr of srData) {
          giBatch.push({
            result_id: sr.result_id,
            grade_type_id: gtData[0].grade_type_id,
            sequence_no: 1,
            score: +(3 + Math.random() * 7).toFixed(1),
            recorded_date: '2025-01-10',
          });
        }
        const { data: giData } = await sb.from('grade_items').insert(giBatch).select();
        console.log(giData?.length, 'grade_items');
      }
    } else {
      console.log('Subject results exist:', srCount);
    }
  }

  // === 11. Timetables ===
  const { count: ttCount } = await sb.from('timetables').select('*', { count: 'exact', head: true });
  if (!ttCount && clsData?.length && subjData?.length) {
    const ttBatch = [];
    const rooms = ['B201', 'B202', 'B203', 'B204', 'A101', 'A102'];
    for (const cls of clsData) {
      // Use only days 2-6 (Mon-Fri), periods 1-4
      for (let d = 2; d <= 6; d++) {
        for (let p = 1; p <= 4; p++) {
          const subj = subjData[(d + p) % subjData.length];
          ttBatch.push({
            class_id: cls.class_id,
            subject_id: subj.subject_id,
            teacher_id: teachData[Math.floor(Math.random() * teachData.length)]?.teacher_id,
            semester_id: hk2.semester_id,
            day_of_week: String(d),
            period_no: p,
            start_time: '07:30',
            end_time: '08:15',
            room: rooms[Math.floor(Math.random() * rooms.length)],
          });
        }
      }
    }
    const { data: ttData } = await sb.from('timetables').insert(ttBatch).select();
    console.log(ttData?.length, 'timetables');

    // === 12. Attendance session ===
    const { data: atsData } = await sb.from('attendance_sessions').insert({
      teacher_id: teachData[0]?.teacher_id,
      schedule_id: ttData?.[0]?.schedule_id,
      session_date: '2025-11-20',
      created_at: new Date().toISOString(),
    }).select();
    console.log(atsData?.length, 'attendance_sessions');
  } else {
    console.log('Timetables exist:', ttCount);
  }

  // === 13. Notifications ===
  const notifExists = await sb.from('notifications').select('*', { count: 'exact', head: true });
  if (!notifExists.count) {
    const { data: allUsers } = await sb.from('users').select('user_id, role_id').order('user_id');
    const teacherUids = (allUsers || []).filter(u => u.role_id === teacherRoleId).map(u => u.user_id);
    if (teacherUids.length) {
      await sb.from('notifications').insert([
        { sender_id: teacherUids[0], title: 'Thong bao lich hop', content: 'Hop phu huynh ngay 20/12/2025', target_type: 'all', created_at: new Date().toISOString() },
        { sender_id: teacherUids[0], title: 'Nhan nho bao cao diem', content: 'Cap nhat diem giua ky', target_type: 'teachers', created_at: new Date().toISOString() },
      ]);
      console.log('Notifications seeded');
    }
  }

  // === 14. Final counts ===
  console.log('\n=== Final counts ===');
  for (const t of ['users','students','teachers','classes','subjects','grade_types','grade_items','timetables','attendance_sessions','role_permissions','notifications']) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    console.log('  ' + t + ': ' + count);
  }
  console.log('\n=== Seed complete! ===');
}

main().catch(e => { console.error('Seed failed:', e); process.exit(1); });
