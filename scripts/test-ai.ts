/**
 * Smoke test cho AI core (không cần DATABASE_URL):
 * - SQL sandbox: validate, whitelist, scope injection, limit
 * - NIM LLM: tool-calling roundtrip (nếu NVIDIA_API_KEY có)
 * - NIM embedding: 1 lần embed (nếu NVIDIA_API_KEY có)
 */
import 'dotenv/config';
import {
  validateSelect,
  extractTables,
  scopePredicate,
  injectScope,
  enforceLimit,
} from '../src/ai/tools/sql.tool';
import { callChat } from '../src/ai/llm/nim.client';
import { embedNim } from '../src/ai/rag/embedding';

const checks: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function testSqlSandbox() {
  console.log('── SQL sandbox ──');

  check('chặn INSERT', !validateSelect('INSERT INTO students VALUES (1)', 'Admin').ok);
  check('chặn DELETE', !validateSelect('DELETE FROM students WHERE id = 1', 'Admin').ok);
  check('chặn DROP', !validateSelect('DROP TABLE students', 'Admin').ok);
  check('chặn ;', !validateSelect('SELECT * FROM students; SELECT 1', 'Admin').ok);
  check('chặn comment', !validateSelect('SELECT * FROM students -- xem', 'Admin').ok);
  check('chặn pg_ internal', !validateSelect('SELECT * FROM pg_user', 'Admin').ok);
  check(
    'chặn information_schema',
    !validateSelect('SELECT * FROM information_schema.tables', 'Admin').ok
  );
  check('cho phép SELECT đơn giản', validateSelect('SELECT * FROM students LIMIT 5', 'Admin').ok);

  const st = validateSelect('SELECT * FROM unknown_table', 'Admin');
  check('chặn bảng không tồn tại', !st.ok, st.ok ? undefined : (st as any).reason);

  const s1 = validateSelect('SELECT * FROM users', 'HocSinh-PhuHuynh');
  check('student không truy cập users', !s1.ok, s1.ok ? undefined : (s1 as any).reason);

  const s2 = validateSelect(
    'SELECT s.student_id FROM attendances s -- join',
    'GiaoVien'
  );
  check('teacher không dùng comment', !s2.ok);

  const s3 = validateSelect('SELECT subject_results.* FROM subject_results', 'HocSinh-PhuHuynh');
  check('student được phép subject_results', s3.ok);

  console.log('── Scope injection ──');
  const scoped = injectScope(
    'SELECT student_id FROM students WHERE class_id = 5 ORDER BY student_id',
    'students.user_id = $1'
  );
  check('inject scope vào WHERE sẵn có', scoped.includes('AND (students.user_id = $1)'), scoped);

  const scoped2 = injectScope('SELECT * FROM students ORDER BY student_id', 'students.user_id = $1');
  check('inject scope khi chưa có WHERE', scoped2.includes('WHERE (students.user_id = $1)'), scoped2);

  const limited = enforceLimit('SELECT * FROM students WHERE a = 1', 200);
  check('thêm LIMIT', /limit 200$/i.test(limited), limited);
  const limited2 = enforceLimit('SELECT * FROM students LIMIT 1000', 200);
  check('cap LIMIT 1000 → 200', /limit 200$/i.test(limited2), limited2);

  console.log('── Scope predicate ──');
  check(
    'student: students',
    (scopePredicate('students', 'HocSinh-PhuHuynh') ?? '').includes('user_id = $1')
  );
  check(
    'student: timetables theo lớp của mình',
    (scopePredicate('timetables', 'HocSinh-PhuHuynh') ?? '').includes('class_id IN (SELECT class_id FROM students WHERE user_id = $1)')
  );
  check(
    'teacher: classes (chủ nhiệm + dạy)',
    (scopePredicate('classes', 'GiaoVien') ?? '').includes('homeroom_teacher_id = $2')
  );
  check('admin: không scope', scopePredicate('users', 'Admin') === null);

  console.log('── extractTables ──');
  const tables = extractTables(
    'SELECT s.student_id FROM subject_results sr JOIN students s ON s.student_id = sr.student_id WHERE sr.semester_id = 1'
  );
  check('phát hiện 2 bảng', tables.includes('subject_results') && tables.includes('students'), tables.join(', '));
}

async function testNim() {
  if (!process.env.NVIDIA_API_KEY) {
    console.log('  ⏭  Bỏ qua NIM (thiếu NVIDIA_API_KEY)');
    return;
  }
  console.log('── NVIDIA NIM ──');
  try {
    const resp = await callChat(
      [
        {
          role: 'system',
          content:
            'Bạn là trợ lý trường học. Trả lời bằng tiếng Việt, tối đa 1 câu.',
        },
        { role: 'user', content: 'Xin chào! Nói cho tôi biết bạn là ai nhé.' },
      ],
      [],
      { maxTokens: 200 }
    );
    check(
      'LLM chat completions phản hồi',
      resp.content.length > 0,
      resp.content.slice(0, 120).replace(/\n/g, ' ')
    );
  } catch (e: any) {
    if ((e as any)?.status === 401) {
      console.log(
        '  ⚠️  NVIDIA key trả về 401 khi inference — key có thể chưa được cấp quyền cho model (vào trang model trên build.nvidia.com → Get API Key).'
      );
    } else {
      check('LLM chat completions phản hồi', false, `${e?.status}: ${e?.message}`);
    }
  }

  try {
    const vectors = await embedNim(['Hệ thống quản lý trường học là gì?'], 'query');
    check('embedding 1 text', vectors.length === 1 && vectors[0].length === 2048, `dim=${vectors[0]?.length}`);
  } catch (e: any) {
    if ((e as any)?.status === 401) {
      console.log(
        '  ⚠️  NVIDIA key trả về 401 khi embed — key có thể chưa được cấp quyền cho model embed (vào trang model trên build.nvidia.com → Get API Key).'
      );
    } else {
      check('embedding 1 text', false, `${e?.status}: ${e?.message}`);
    }
  }
}

async function main() {
  await testSqlSandbox();
  await testNim();

  const failed = checks.filter((c) => !c.pass);
  console.log(`\nKết quả: ${checks.length - failed.length}/${checks.length} PASS`);
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error('TEST LỖI:', e?.message ?? e);
  process.exit(1);
});