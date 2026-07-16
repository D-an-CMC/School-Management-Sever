import http from 'http';

const BASE = 'http://localhost:3001';

function req(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

    const r = http.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  // Login
  const login = await req('POST', '/api/auth/login', null, { email: 'admin01@cmc.edu.vn', password: 'admin123' });
  console.log('LOGIN:', login.status, login.data.success ? 'OK' : login.data.error);
  const token = login.data.data.token;

  const tests = [
    ['/api/auth/me'],
    ['/api/users?page=1&limit=2'],
    ['/api/users/1'],
    ['/api/students?page=1&limit=2'],
    ['/api/students/63'],
    ['/api/students/stats/count'],
    ['/api/teachers?page=1&limit=2'],
    ['/api/teachers/6'],
    ['/api/teachers/stats/summary'],
    ['/api/classes?page=1&limit=2'],
    ['/api/classes/1'],
    ['/api/classes/stats/by-grade'],
    ['/api/grades/class/1'],
    ['/api/grades/types'],
    ['/api/attendance/sessions?page=1&limit=2'],
    ['/api/timetables/timetables?page=1&limit=2'],
    ['/api/timetables/exam-schedules?classId=1'],
    ['/api/timetables/subjects'],
    ['/api/timetables/semesters'],
    ['/api/ai/risk-warnings/stats'],
    ['/api/ai/risk-warnings?classId=1'],
    ['/api/ai/chat/conversations'],
    ['/api/notifications/my?page=1&limit=2'],
    ['/api/permissions/roles'],
    ['/api/permissions/permissions'],
    ['/api/activities?page=1&limit=2'],
    ['/api/users/public/accounts'],  // no auth needed
  ];

  let pass = 0, fail = 0;
  for (const path of tests) {
    try {
      const r = await req('GET', path[0], token);
      const ok = r.status === 200 && r.data.success;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${r.status} ${path[0]}`, ok ? '' : JSON.stringify(r.data).slice(0, 120));
      ok ? pass++ : fail++;
    } catch (e) {
      console.log('ERROR', path[0], e.message);
      fail++;
    }
  }

  // Test write endpoints
  const writeTests = [
    ['PUT', '/api/users/1', { username: 'admin01_updated' }],
    ['PUT', '/api/grades/items/1', { score: 8.5 }],
    ['POST', '/api/attendance/sessions', { sessionDate: '2025-07-10' }],
    ['POST', '/api/ai/chat/conversations'],
  ];

  for (const [method, path, body] of writeTests) {
    try {
      const r = await req(method, path, token, body);
      const ok = r.status < 300;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${r.status} ${method} ${path}`, ok ? '' : JSON.stringify(r.data).slice(0, 120));
      ok ? pass++ : fail++;
    } catch (e) {
      console.log('ERROR', method, path, e.message);
      fail++;
    }
  }

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
}

main();
