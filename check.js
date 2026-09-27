const fs = require('fs');
const lines = fs.readFileSync('public/app.js', 'utf8').split('\n');
let depth = 0;
for(let i=0; i<lines.length; i++) {
  const line = lines[i];
  let cleanLine = line.replace(/'.*?'/g, '').replace(/".*?"/g, '').replace(/`.*?`/g, '').replace(/\/\/.*/, '');
  for(let j=0; j<cleanLine.length; j++) {
    if (cleanLine[j] === '{') depth++;
    if (cleanLine[j] === '}') depth--;
  }
  if (depth === 0 && i > 0 && i < lines.length - 5) {
    console.log('Depth hit 0 at line', i+1);
  }
}
