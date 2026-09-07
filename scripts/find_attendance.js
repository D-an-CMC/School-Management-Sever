const fs = require('fs');
const content = fs.readFileSync('c:/Users/phucn/Desktop/project/School-Management-Client/lib/api.ts', 'utf8');
const lines = content.split('\n');
lines.forEach((line, i) => {
  if (line.includes('getMyAttendance') || line.includes('Attendance')) {
    console.log(`Line ${i + 1}: ${line.trim()}`);
  }
});
