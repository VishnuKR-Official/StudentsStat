const fs = require('fs');
const code = fs.readFileSync('public/app.js', 'utf8');
const cleanCode = code.replace(/'.*?'/g, '').replace(/".*?"/g, '').replace(/`.*?`/g, '').replace(/\/\/.*/g, '');
let parens = 0;
for(let i=0; i<cleanCode.length; i++) {
  if (cleanCode[i] === '(') parens++;
  if (cleanCode[i] === ')') parens--;
}
console.log('Parens depth:', parens);
