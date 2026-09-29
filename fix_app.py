c = open('public/app.js', 'r', encoding='utf-8').read()
c = c.replace('currentUser.role === \'admin\'', '(currentUser.role === \'admin\' || currentUser.role === \'global_admin\')')
c = c.replace('((currentUser.role === \'admin\' || currentUser.role === \'global_admin\') || currentUser.role === \'global_admin\')', '(currentUser.role === \'admin\' || currentUser.role === \'global_admin\')')
open('public/app.js', 'w', encoding='utf-8').write(c)
