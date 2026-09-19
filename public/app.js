(function () {
  const MAX_LEVEL = 52;
  const API = '/api/students';

  let students = [];
  let editingId = null;
  let pendingAvatar = null;
  let prevPositions = {}; // id -> {level, weeksStale} from the last render, to detect "just snapped back"
  let adminPasscode = sessionStorage.getItem('adminPasscode') || null;

  const grid = document.getElementById('grid');
  const emptyState = document.getElementById('emptyState');
  const editPanel = document.getElementById('editPanel');
  const modeBadge = document.getElementById('modeBadge');
  const footerNote = document.getElementById('footerNote');
  const trackEl = document.getElementById('track');
  const tooltip = document.getElementById('tooltip');
  const adminModal = document.getElementById('adminModal');
  const btnAdminToggle = document.getElementById('btnAdminToggle');
  const adminPassInput = document.getElementById('adminPassInput');
  const taglineEl = document.getElementById('motivationalTagline');

  const taglines = [
    "Learning is a journey, not a destination.",
    "Small steps every day lead to big results.",
    "Consistency is the key to mastery.",
    "Challenge yourself to grow.",
    "Knowledge is power.",
    "Keep pushing your limits."
  ];

  function updateTagline() {
    if (taglineEl) {
      taglineEl.textContent = `"${taglines[Math.floor(Math.random() * taglines.length)]}"`;
    }
  }
  
  // Initialize tagline and rotate every 10 minutes
  updateTagline();
  setInterval(updateTagline, 10 * 60 * 1000);

  function updateAdminUI() {
    if (adminPasscode) {
      btnAdminToggle.className = 'admin-badge unlocked';
      btnAdminToggle.textContent = '🔓 Admin Unlocked';
    } else {
      btnAdminToggle.className = 'admin-badge locked';
      btnAdminToggle.textContent = '🔒 Public View (Locked)';
    }
  }

  function promptAdminUnlock(onSuccess) {
    adminModal.classList.add('open');
    adminPassInput.value = '';
    adminPassInput.focus();
    window._adminSuccessCb = onSuccess;
  }
  function closeAdminModal() {
    adminModal.classList.remove('open');
    window._adminSuccessCb = null;
  }

  function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }
  function tierInfo(level) {
    if (level > 39) return { name: 'Master', color: 'var(--tier4)' };
    if (level > 26) return { name: 'Expert', color: 'var(--tier3)' };
    if (level > 13) return { name: 'Skilled', color: 'var(--tier2)' };
    return { name: 'Rookie', color: 'var(--tier1)' };
  }
  function initials(name) { return (name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] ? w[0].toUpperCase() : '').join(''); }
  function emojiFor(s) {
    if (s.justLeveledUp) return '🚀';
    if (s.weeksStale === 0) return '🙂';
    if (s.weeksStale === 1) return '😐';
    if (s.weeksStale === 2) return '😴';
    return '⚠️';
  }
  function streakLabel(s) {
    if (s.justLeveledUp) return 'Just leveled up';
    if (s.weeksStale === 0) return 'Active this week';
    return s.weeksStale + ' week' + (s.weeksStale === 1 ? '' : 's') + ' without an update';
  }

  async function api(path, opts = {}) {
    opts.headers = opts.headers || {};
    if (adminPasscode) {
      opts.headers['x-admin-passcode'] = adminPasscode;
    }
    const res = await fetch(path, opts);
    if (res.status === 401) {
      adminPasscode = null;
      sessionStorage.removeItem('adminPasscode');
      updateAdminUI();
      promptAdminUnlock();
      throw new Error('Admin passcode required');
    }
    if (!res.ok) {
      let msg = 'Request failed';
      try { const j = await res.json(); msg = j.error || msg; } catch (e) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function loadStudents() {
    students = await api(API);
    render();
  }

  async function init() {
    updateAdminUI();
    try {
      await loadStudents();
      modeBadge.textContent = 'Connected — changes save to the server';
      footerNote.textContent = 'Data is stored in the server\'s database and stays until a student is deleted.';
    } catch (e) {
      modeBadge.classList.add('ro');
      modeBadge.textContent = 'Could not reach the server';
      footerNote.textContent = 'Check that the Rank Board server is running.';
    }
  }

  function updateStats() {
    document.getElementById('statCount').textContent = students.length;
    const avg = students.length ? (students.reduce((a, s) => a + s.level, 0) / students.length) : 0;
    document.getElementById('statAvg').textContent = avg ? avg.toFixed(1) : '0';
    document.getElementById('statMax').textContent = students.filter(s => s.level >= MAX_LEVEL).length;
  }

  function showTooltip(target, s) {
    const tier = tierInfo(s.level);
    document.getElementById('ttName').textContent = s.name;
    const ttTier = document.getElementById('ttTier');
    ttTier.textContent = tier.name + ' · Level ' + s.level + ' / ' + MAX_LEVEL;
    ttTier.style.color = tier.color;
    document.getElementById('ttStreak').textContent = streakLabel(s);
    const ttDesc = document.getElementById('ttDesc');
    if (s.description && s.description.trim()) {
      ttDesc.textContent = 'Currently learning: ' + s.description;
      ttDesc.classList.remove('empty');
    } else {
      ttDesc.textContent = 'No current focus noted yet.';
      ttDesc.classList.add('empty');
    }
    const rect = target.getBoundingClientRect();
    tooltip.classList.add('show');
    const tw = 240;
    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    tooltip.style.left = left + 'px';
    tooltip.style.transform = 'translateY(-100%)';
    tooltip.style.top = (rect.top - 10) + 'px';
  }
  function hideTooltip() { tooltip.classList.remove('show'); }

  function renderTrack() {
    trackEl.innerHTML = '<div class="track-line"></div>';
    for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
      const pct = (lvl / MAX_LEVEL) * 100;
      const major = (lvl % 13 === 0);
      const tick = document.createElement('div');
      tick.className = 'track-tick' + (major ? ' major' : '');
      tick.style.left = pct + '%';
      trackEl.appendChild(tick);
      if (major) {
        const lbl = document.createElement('div');
        lbl.className = 'track-ticklabel';
        lbl.style.left = pct + '%';
        lbl.textContent = lvl;
        trackEl.appendChild(lbl);
      }
    }
    const byLevel = {};
    students.forEach(s => { (byLevel[s.level] = byLevel[s.level] || []).push(s); });

    Object.keys(byLevel).forEach(lvlKey => {
      const lvl = parseInt(lvlKey, 10);
      const pct = (lvl / MAX_LEVEL) * 100;
      byLevel[lvlKey].forEach((s, i) => {
        const tier = tierInfo(s.level);
        const sinkPerWeek = 16;
        const maxSink = 5;
        const sink = Math.min(s.weeksStale, maxSink) * sinkPerWeek;
        const stackOffset = i * -10;

        const wrap = document.createElement('div');
        wrap.className = 'track-marker-wrap';
        wrap.style.left = pct + '%';
        wrap.style.top = (14 + sink + stackOffset) + 'px';
        wrap.style.setProperty('--tier-color', tier.color);

        const prev = prevPositions[s.id];
        if (prev && prev.justLeveledUp !== s.justLeveledUp && s.justLeveledUp) {
          wrap.classList.add('snap');
        }

        wrap.innerHTML = `
          <div class="track-emoji">${emojiFor(s)}</div>
          <div class="track-avatar">${s.avatar ? `<img src="${s.avatar}" alt="">` : initials(s.name)}</div>
        `;
        wrap.addEventListener('mouseenter', () => showTooltip(wrap.querySelector('.track-avatar'), s));
        wrap.addEventListener('mouseleave', hideTooltip);
        trackEl.appendChild(wrap);

        prevPositions[s.id] = { justLeveledUp: s.justLeveledUp, weeksStale: s.weeksStale };
      });
    });
  }

  function renderCard(s) {
    const tier = tierInfo(s.level);
    const card = document.createElement('div');
    card.className = 'card';
    card.style.setProperty('--tier-color', tier.color);
    const pct = Math.round((s.level / MAX_LEVEL) * 100);
    let segs = '';
    for (let i = 0; i < 13; i++) {
      const thresh = (i + 1) * 4;
      segs += `<i class="${s.level >= thresh ? 'on' : ''}"></i>`;
    }
    card.innerHTML = `
      <div class="card-top">
        <div class="avatar" data-role="avatar">${s.avatar ? `<img src="${s.avatar}" alt="${escapeHtml(s.name)}">` : initials(s.name)}</div>
        <div class="who">
          <div class="name">${escapeHtml(s.name)}</div>
          <div class="tier-label">${tier.name}</div>
        </div>
      </div>
      <div class="level-row">
        <div class="level-num">${s.level}</div>
        <div class="level-max">/ ${MAX_LEVEL}</div>
      </div>
      <div class="bar-outer"><div class="bar-inner" style="width:${pct}%"></div></div>
      <div class="segments">${segs}</div>
      <div class="desc-line">${s.description ? escapeHtml(s.description) : ''}</div>
      <div class="card-controls">
        <div class="lvl-btns">
          <button data-act="dec" title="Level down">−</button>
          <button data-act="inc" title="Level up">+</button>
        </div>
        <div class="card-menu">
          <button class="small" data-act="edit">Edit</button>
          <button class="small danger" data-act="delete">Delete</button>
        </div>
      </div>
    `;
    const avatarEl = card.querySelector('[data-role="avatar"]');
    avatarEl.addEventListener('mouseenter', () => showTooltip(avatarEl, s));
    avatarEl.addEventListener('mouseleave', hideTooltip);

    card.querySelector('[data-act="inc"]').addEventListener('click', () => bump(s.id, 'up'));
    card.querySelector('[data-act="dec"]').addEventListener('click', () => bump(s.id, 'down'));
    card.querySelector('[data-act="delete"]').addEventListener('click', () => removeStudent(s));
    card.querySelector('[data-act="edit"]').addEventListener('click', () => openPanel(s));
    return card;
  }

  function render() {
    grid.innerHTML = '';
    if (students.length === 0) {
      emptyState.style.display = 'block';
    } else {
      emptyState.style.display = 'none';
      students.slice().sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
        .forEach(s => grid.appendChild(renderCard(s)));
    }
    renderTrack();
    updateStats();
  }

  async function bump(id, dir) {
    try {
      const updated = await api(`${API}/${id}/bump`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir })
      });
      students = students.map(s => s.id === id ? updated : s);
      render();
    } catch (e) { alert('Could not update level: ' + e.message); }
  }

  async function removeStudent(s) {
    if (adminPasscode) {
      if (!confirm(`Remove ${s.name} from the board? This can't be undone.`)) return;
      try {
        await api(`${API}/${s.id}`, { method: 'DELETE' });
        students = students.filter(x => x.id !== s.id);
        delete prevPositions[s.id];
        render();
      } catch (e) { alert('Could not delete: ' + e.message); }
    } else {
      if (!confirm(`Request admin to remove ${s.name} from the board?`)) return;
      try {
        const res = await fetch(`${API}/${s.id}/delete-request`, { method: 'POST' });
        if (res.ok) alert('Delete request sent to admin.');
        else alert('Could not send delete request.');
      } catch (e) { alert('Could not request: ' + e.message); }
    }
  }

  function fileToDataUrl(file, cb) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const img = new Image();
      img.onload = function () {
        const size = 160;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        cb(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  const panelTitle = document.getElementById('panelTitle');
  const avatarPicker = document.getElementById('avatarPicker');
  const avatarFile = document.getElementById('avatarFile');
  const fName = document.getElementById('fName');
  const fLevel = document.getElementById('fLevel');
  const fDesc = document.getElementById('fDesc');

  function openPanel(existing) {
    editingId = existing ? existing.id : null;
    panelTitle.textContent = existing ? 'Edit student' : 'New student';
    fName.value = existing ? existing.name : '';
    fLevel.value = existing ? existing.level : 1;
    fDesc.value = existing ? (existing.description || '') : '';
    pendingAvatar = existing ? (existing.avatar || null) : null;
    avatarPicker.innerHTML = pendingAvatar ? `<img src="${pendingAvatar}" alt="">` : 'Photo';
    editPanel.classList.add('open');
    fName.focus();
  }
  function closePanel() {
    editPanel.classList.remove('open');
    editingId = null; pendingAvatar = null;
    fName.value = ''; fLevel.value = 1; fDesc.value = '';
    avatarPicker.innerHTML = 'Photo';
  }
  document.getElementById('btnToggleAdd').addEventListener('click', () => {
    if (!adminPasscode && localStorage.getItem('hasCreatedProfile')) {
      alert('You have already created a student profile. Only one profile per visitor is allowed.');
      return;
    }
    editPanel.classList.contains('open') ? closePanel() : openPanel(null);
  });
  document.getElementById('btnCancel').addEventListener('click', closePanel);
  avatarPicker.addEventListener('click', () => avatarFile.click());
  avatarFile.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    fileToDataUrl(file, (dataUrl) => { pendingAvatar = dataUrl; avatarPicker.innerHTML = `<img src="${dataUrl}" alt="">`; });
  });

  document.getElementById('btnSave').addEventListener('click', async () => {
    const name = fName.value.trim();
    if (!name) { fName.focus(); return; }
    let lvl = parseInt(fLevel.value, 10);
    if (isNaN(lvl)) lvl = 1;
    lvl = Math.min(MAX_LEVEL, Math.max(1, lvl));
    const description = fDesc.value.trim();
    const payload = { name, level: lvl, description, avatar: pendingAvatar };
    try {
      if (editingId) {
        const updated = await api(`${API}/${editingId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        students = students.map(s => s.id === editingId ? updated : s);
      } else {
        const created = await api(API, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        students.push(created);
        if (!adminPasscode) localStorage.setItem('hasCreatedProfile', 'true');
      }
      closePanel(); render();
    } catch (e) { alert('Could not save: ' + e.message); }
  });
  fName.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('btnSave').click(); });

  document.getElementById('btnExport').addEventListener('click', () => {
    window.location.href = '/api/export';
  });
  const importFile = document.getElementById('importFile');
  document.getElementById('btnImportTrigger').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data)) throw new Error('bad format');
        const merge = confirm('Merge with current students? Cancel to replace the board entirely.');
        students = await api(`/api/import?mode=${merge ? 'merge' : 'replace'}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
        });
        render();
      } catch (err) { alert('That file could not be imported: ' + err.message); }
    };
    reader.readAsText(file);
    importFile.value = '';
  });

  btnAdminToggle.addEventListener('click', () => {
    if (adminPasscode) {
      if (confirm('Lock Admin Mode and return to Public View?')) {
        adminPasscode = null;
        sessionStorage.removeItem('adminPasscode');
        updateAdminUI();
      }
    } else {
      promptAdminUnlock();
    }
  });

  document.getElementById('btnAdminClose').addEventListener('click', closeAdminModal);

  async function performAdminUnlock() {
    const val = adminPassInput.value.trim();
    if (!val) return;
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: val })
      });
      if (!res.ok) throw new Error('Incorrect passcode');
      adminPasscode = val;
      sessionStorage.setItem('adminPasscode', val);
      updateAdminUI();
      const cb = window._adminSuccessCb;
      closeAdminModal();
      if (cb) cb();
    } catch (e) {
      alert('Unlock failed: ' + e.message);
    }
  }

  document.getElementById('btnAdminUnlock').addEventListener('click', performAdminUnlock);
  adminPassInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performAdminUnlock();
  });

  init();
  // Refresh periodically so streak/emoji state (and other people's edits) stay current
  setInterval(loadStudents, 30000);
})();
