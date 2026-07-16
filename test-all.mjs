import http from 'http';

const BASE = 'http://localhost:3001';

function req(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ s: res.statusCode, d: JSON.parse(d) }); }
        catch { resolve({ s: res.statusCode, d }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  const login = await req('POST', '/api/auth/login', null, { email: 'admin01@cmc.edu.vn', password: '12345a' });
  const token = login.d.data.token;

  const authTests = [
    ['GET', '/api/auth/me'],
    ['GET', '/api/users?limit=2'],
    ['GET', '/api/users/1'],
    ['GET', '/api/students?limit=2'],
    ['GET', '/api/students/63'],
    ['GET', '/api/students/stats/count'],
    ['GET', '/api/teachers?limit=2'],
    ['GET', '/api/teachers/6'],
    ['GET', '/api/teachers/stats/summary'],
    ['GET', '/api/classes?limit=2'],
    ['GET', '/api/classes/1'],
    ['GET', '/api/classes/stats/by-grade'],
    ['GET', '/api/grades/class/224'],
    ['GET', '/api/grades/types'],
    ['GET', '/api/attendance/sessions?limit=2'],
    ['GET', '/api/timetables/timetables?limit=2'],
    ['GET', '/api/timetables/subjects'],
    ['GET', '/api/timetables/semesters'],
    ['GET', '/api/ai/risk-warnings/stats'],
    ['GET', '/api/ai/risk-warnings'],
    ['GET', '/api/ai/chat/conversations'],
    ['GET', '/api/notifications/my?limit=2'],
    ['GET', '/api/permissions/roles'],
    ['GET', '/api/permissions/permissions'],
    ['GET', '/api/permissions/roles/1/permissions'],
    ['GET', '/api/activities?limit=2'],
    ['GET', '/api/users/public/accounts'],
  ];

  let pass = 0, fail = 0;
  for (const [method, path] of authTests) {
    try {
      const r = await req(method, path, token);
      const ok = r.s === 200 && r.d.success;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${r.s} ${method} ${path}${ok ? '' : ' -> ' + JSON.stringify(r.d).slice(0,100)}`);
      ok ? pass++ : fail++;
    } catch (e) {
      console.log('ERR', method, path, e.message);
      fail++;
    }
  }

  const writeTests = [
    ['PUT', '/api/users/1', { username: 'admin_test' }],
    ['PUT', '/api/grades/items/1', { score: 8.5 }],
    ['POST', '/api/notifications', { title: 'Test', content: 'Test content' }],
    ['PUT', '/api/permissions/roles/1/permissions', { permissionIds: [1,2,3] }],
    ['POST', '/api/ai/chat/conversations'],
  ];

  for (const [method, path, body] of writeTests) {
    try {
      const r = await req(method, path, token, body);
      const ok = r.s < 300;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${r.s} ${method} ${path}${ok ? '' : ' -> ' + JSON.stringify(r.d).slice(0,100)}`);
      ok ? pass++ : fail++;
    } catch (e) {
      console.log('ERR', method, path, e.message);
      fail++;
    }
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
}

main();
