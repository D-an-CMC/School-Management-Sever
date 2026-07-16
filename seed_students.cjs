const { createClient } = require('@supabase/supabase-js');

const URL = 'https://akurubwwxfgeduyxazyl.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrdXJ1Ynd3eGZnZWR1eXhhenlsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjcyNTc1NSwiZXhwIjoyMDk4MzAxNzU1fQ.N958cFmRxMqEDDHjBh_vvWqPdmDLzN5YBSKsqLr36pI';

const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const LAST_NAMES = ['Nguyen', 'Tran', 'Le', 'Pham', 'Vo', 'Dang', 'Hoang', 'Bui', 'Do', 'Ngo', 'Huynh', 'Phan', 'Vu', 'Truong', 'Dao'];
const MALE_FN = ['Minh', 'Kiet', 'Tuan', 'Binh', 'Duc', 'Hai', 'Nam', 'Huy', 'Tien', 'Khai', 'Thang', 'Vu', 'Luan', 'Quan', 'Dat', 'Canh', 'Duy', 'Loc', 'Phat', 'Sang'];
const FEMALE_FN = ['Thu', 'Mai', 'Lan', 'Huong', 'Nga', 'An', 'Linh', 'Hoa', 'Phuong', 'Trang', 'Ngoc', 'Khanh', 'Diep', 'Tram', 'Nhu', 'Yen', 'Chi', 'Ngan', 'Thy', 'Uyen'];
const PARENT_NAMES = ['Nguyen Van A', 'Tran Thi B', 'Le Van C', 'Pham Thi D', 'Vo Van E', 'Dang Thi F', 'Hoang Van G', 'Bui Thi H', 'Do Van K', 'Ngo Thi L'];

let counter = 0;

async function main() {
  const { data: roles } = await sb.from('roles').select('*');
  const roleMap = {};
  roles?.forEach(r => roleMap[r.role_name] = r.role_id);
  const studentRoleId = roleMap['HocSinh-PhuHuynh'];

  const { data: classes } = await sb.from('classes').select('class_id, class_name, grade_level').order('class_id');

  let inserted = 0, skipped = 0;

  for (const cls of classes) {
    const { count } = await sb.from('students').select('*', { count: 'exact', head: true }).eq('class_id', cls.class_id);
    const current = count || 0;
    const need = 5 - current;
    if (need <= 0) continue;
    console.log(`Class ${cls.class_name}: ${current} HS, need ${need}`);

    for (let n = 0; n < need; n++) {
      const gender = Math.random() > 0.5 ? 'Nam' : 'Nu';
      const ln = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
      const fn = (gender === 'Nam' ? MALE_FN : FEMALE_FN)[Math.floor(Math.random() * (gender === 'Nam' ? MALE_FN.length : FEMALE_FN.length))];
      const fullName = ln + ' ' + fn;
      counter++;

      // Use counter-based code to avoid collision
      const code = `${cls.class_name}-${String(n + 1).padStart(2, '0')}`;
      const email = `hs${String(counter).padStart(4, '0')}.${code.replace(/[^a-zA-Z0-9]/g, '')}@student.cmc.edu.vn`;
      const year = 2009 + Math.floor(Math.random() * 4);
      const dob = `${year}-${String(1 + Math.floor(Math.random() * 12)).padStart(2,'0')}-${String(1 + Math.floor(Math.random() * 28)).padStart(2,'0')}`;
      const parent = PARENT_NAMES[Math.floor(Math.random() * PARENT_NAMES.length)];
      const parentPhone = '09' + String(Math.floor(Math.random() * 90000000 + 10000000));

      const { data: newAuth, error: authErr } = await sb.auth.admin.createUser({
        email, password: '12345a', email_confirm: true, user_metadata: { full_name: fullName },
      });
      if (authErr || !newAuth?.user) {
        console.error('  Auth fail:', email, authErr?.message);
        skipped++;
        await sleep(500);
        continue;
      }

      const { data: userRec, error: userErr } = await sb.from('users').insert({
        auth_id: newAuth.user.id, email, username: fullName + ' ' + counter, role_id: studentRoleId, is_active: true,
      }).select().single();

      if (userErr || !userRec) {
        console.error('  User fail:', userErr?.message);
        skipped++;
        await sleep(300);
        continue;
      }

      const { error: stErr } = await sb.from('students').insert({
        user_id: userRec.user_id, class_id: cls.class_id, student_code: code, full_name: fullName, gender, date_of_birth: dob, address: 'Ha Noi', enrollment_date: `${year + 10}-09-01`, parent_full_name: parent, parent_phone: parentPhone, parent_email: parent.toLowerCase().replace(/\s+/g, '.') + '@gmail.com', parent_relationship: 'Cha',
      });

      if (stErr) {
        console.error('  Stu fail:', stErr.message);
        skipped++;
      } else {
        console.log(`  + ${fullName} (${code}) -> ${cls.class_name}`);
        inserted++;
      }
      await sleep(300);
    }
  }

  console.log('\n=== Fill done: inserted=' + inserted + ' skipped=' + skipped + ' ===');
}

main().catch(e => console.error('FATAL:', e));
