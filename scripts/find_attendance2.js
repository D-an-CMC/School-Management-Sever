const fs = require('fs');
const content = fs.readFileSync('c:/Users/phucn/Desktop/project/School-Management-Sever/src/services/student-self.service.ts', 'utf8');
const lines = content.split('\n');
lines.forEach((line, i) => {
  if (line.toLowerCase().includes('attendance')) {
    console.log(`Line ${i + 1}: ${line.trim()}`);
  }
});
