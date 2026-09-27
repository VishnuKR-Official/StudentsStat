const fs = require('fs');
const code = fs.readFileSync('public/app.js', 'utf8');
const lines = code.split('\n');

let initChatStart = lines.findIndex(l => l.includes('function initChat() {'));
let depth = 0;
for(let i = initChatStart; i < lines.length; i++) {
  const line = lines[i];
  let cleanLine = line.replace(/'.*?'/g, '').replace(/".*?"/g, '').replace(/`.*?`/g, '').replace(/\/\/.*/g, '');
  for(let j=0; j<cleanLine.length; j++) {
    if (cleanLine[j] === '{') depth++;
    if (cleanLine[j] === '}') depth--;
  }
  if (depth === 0) {
    console.log('initChat depth hit 0 at line', i+1);
    break;
  }
}
