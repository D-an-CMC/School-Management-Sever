const { createClient } = require('@supabase/supabase-js');

const URL = 'https://akurubwwxfgeduyxazyl.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrdXJ1Ynd3eGZnZWR1eXhhenlsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjcyNTc1NSwiZXhwIjoyMDk4MzAxNzU1fQ.N958cFmRxMqEDDHjBh_vvWqPdmDLzN5YBSKsqLr36pI';

const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MISSING = [
  { code: '7A3-04', clsId: null, grade: 7 },
  { code: '8A2-05', clsId: null, grade: 8 },
  { code: '8A5-03', clsId: null, grade: 8 },
  { code: '9A1-04', clsId: null, grade: 9 },
  { code: '9A2-05', clsId: null, grade: 9 },
  { code: '9A3-02', clsId: null, grade: 9 },
  { code: '9A4-05', clsId: null, grade: 9 },
  { code: '9A5-05', clsId: null, grade: 9 },
];

async function main() {
  const { data: roles } = await sb.from('roles').select('*');
  const roleMap = {};
  roles?.forEach(r => roleMap[r.role_name] = r.role_id);
  const studentRoleId = roleMap['HocSinh-PhuHuynh'];

  const { data: classes } = await sb.from('classes').select('class_id, class_name').order('class_id');
  const clsMap = {};
  classes?.forEach(c => clsMap[c.class_name] = c.class_id);

  const names = [
    ['Hoang', 'Minh', 'Nam'], ['Nguyen', 'Ngoc', 'Nu'], ['Pham', 'Binh', 'Nam'],
    ['Vo', 'Linh', 'Nu'], ['Truong', 'Duc', 'Nam'], ['Dao', 'Hoa', 'Nu'], ['Bui', 'Khai', 'Nam'], ['Do', 'Thu', 'Nu'],
  ];

  const parents = ['Nguyen Van X', 'Tran Thi Y', 'Le Van Z', 'Pham Thi W', 'Vo Van V', 'Dang Thi U', 'Hoang Van T', 'Bui Thi S'];

  let inserted = 0;
  for (let i = 0; i < MISSING.length; i++) {
    const m = MISSING[i];
    m.clsId = clsMap[m.code.split('-')[0]];
    if (!m.clsId) { console.log('No class for', m.code); continue; }

    const n = names[i];
    const gender = n[2];
    const fullName = n[0] + ' ' + n[1];
    const email = `hs.fill${i + 1}.${m.code.replace(/[^a-zA-Z0-9]/g, '')}@student.cmc.edu.vn`;
    const year = 2009;
    const dob = `${year}-${String(5 + i).padStart(2,'0')}-${String(10 + i).padStart(2,'0')}`;
    const parent = parents[i];
    const parentPhone = '0912' + String(345600 + i * 1000);

    const { data: newAuth, error: authErr } = await sb.auth.admin.createUser({
      email, password: '12345a', email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (authErr || !newAuth?.user) {
      console.error('Auth fail:', authErr?.message);
      await sleep(500);
      continue;
    }

    const { data: userRec, error: userErr } = await sb.from('users').insert({
      auth_id: newAuth.user.id, email, username: fullName + '-fill' + i, role_id: studentRoleId, is_active: true,
    }).select().single();
    if (userErr) { console.error('User fail:', userErr.message); continue; }

    const { error: stErr } = await sb.from('students').insert({
      user_id: userRec.user_id, class_id: m.clsId, student_code: m.code, full_name: fullName, gender, date_of_birth: dob, address: 'Ha Noi', enrollment_date: `${year + 10}-09-01`, parent_full_name: parent, parent_phone: parentPhone, parent_email: parent.toLowerCase().replace(/\s+/g, '.') + '@gmail.com', parent_relationship: 'Cha',
    });
    if (stErr) { console.error('Stu fail:', m.code, stErr.message); }
    else { console.log(`+ ${fullName} (${m.code})`); inserted++; }
    await sleep(400);
  }
  console.log('\nInserted:', inserted);
}

main().catch(e => console.error(e));
