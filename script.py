import sys
c = open('public/index.html', 'r', encoding='utf-8').read()
c = c.replace('<div style=\"margin-top: 20px; text-align: center;\">', '<div style=\"margin-top: 20px; display: flex; flex-direction: column; gap: 10px; align-items: center;\">')
open('public/index.html', 'w', encoding='utf-8').write(c)
