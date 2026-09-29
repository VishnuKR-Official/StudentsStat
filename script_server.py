import sys
c = open('server.js', 'r', encoding='utf-8').read()
c = c.replace('      await pool.query(
        \'UPDATE students SET batch_id = , batch_status =  WHERE id = \',
        [req.params.id, \'pending\', req.user.id]
      );
      res.json({ message: \'Request to join sent. Waiting for admin approval.\' });', '      const status = req.user.role === \'global_admin\' ? \'approved\' : \'pending\';
      await pool.query(
        \'UPDATE students SET batch_id = , batch_status =  WHERE id = \',
        [req.params.id, status, req.user.id]
      );
      res.json({ message: status === \'approved\' ? \'Joined successfully.\' : \'Request to join sent. Waiting for admin approval.\' });')
c = c.replace(c[c.find('// Enter Batch (Global Admin)'):c.find('// Batch Name Edit')], '')
open('server.js', 'w', encoding='utf-8').write(c)
