import sys
c = open('public/app.js', 'r', encoding='utf-8').read()
c = c.replace('currentUser.role === \'global_admin\'', 'currentUser.role === \'admin\'')
c = c.replace('currentUser.role === \'admin\'', '(currentUser.role === \'admin\' || currentUser.role === \'global_admin\')')
c = c.replace('(currentUser.role === \'admin\' || currentUser.role === \'global_admin\') || (currentUser.role === \'admin\' || currentUser.role === \'global_admin\')', '(currentUser.role === \'admin\' || currentUser.role === \'global_admin\')')
c = c.replace('if ((currentUser.role === \'admin\' || currentUser.role === \'global_admin\')) {', 'if (currentUser.role === \'admin\' || currentUser.role === \'global_admin\') {')
c = c.replace(/if \(\(currentUser\.role === 'admin' \|\| currentUser\.role === 'global_admin'\)\) \{[\s\S]*?\}\s*\}\s*\} else if/, '} else if')
open('public/app.js', 'w', encoding='utf-8').write(c)
