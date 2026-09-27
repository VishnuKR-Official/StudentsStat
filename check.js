const fs = require('fs');
const code = fs.readFileSync('public/app.js', 'utf8');
let depth = 0;
let lines = code.split('\n');
for (let i=0; i<lines.length; i++) {
  let line = lines[i];
  for (let j=0; j<line.length; j++) {
    let char = line[j];
    if (char === '{') depth++;
    if (char === '}') depth--;
  }
  if (depth === 0 && i > 0 && i !== lines.length-2) {
    console.log('Depth hit 0 prematurely at line', i+1);
    break;
  }
}
console.log('Final depth:', depth);
