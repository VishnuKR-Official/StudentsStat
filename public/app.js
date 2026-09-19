(function () {
  // ---- Background Animation ----
  const canvas = document.getElementById('bgCanvas');
  const ctx = canvas.getContext('2d');
  let width, height;
  let particles = [];
  let mouse = { x: null, y: null, radius: 150 };

  function initCanvas() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    particles = [];
    const numParticles = Math.floor((width * height) / 10000);
    for (let i = 0; i < numParticles; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 1,
        vy: (Math.random() - 0.5) * 1,
        size: Math.random() * 2 + 1
      });
    }
  }

  function animateCanvas() {
    requestAnimationFrame(animateCanvas);
    ctx.clearRect(0, 0, width, height);
    
    // Draw particles and lines
    ctx.fillStyle = 'rgba(0, 255, 204, 0.5)';
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.15)';
    ctx.lineWidth = 1;

    for (let i = 0; i < particles.length; i++) {
      let p = particles[i];
      p.x += p.vx;
      p.y += p.vy;

      // Bounce off edges
      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;

      // Mouse interaction
      if (mouse.x != null && mouse.y != null) {
        let dx = mouse.x - p.x;
        let dy = mouse.y - p.y;
        let distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < mouse.radius) {
          p.x -= dx * 0.05;
          p.y -= dy * 0.05;
        }
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();

      // Connect particles
      for (let j = i; j < particles.length; j++) {
        let p2 = particles[j];
        let dx = p.x - p2.x;
        let dy = p.y - p2.y;
        let dist = dx * dx + dy * dy;
        if (dist < 10000) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }
  }

  window.addEventListener('resize', initCanvas);
  window.addEventListener('mousemove', e => { mouse.x = e.x; mouse.y = e.y; });
  window.addEventListener('mouseout', () => { mouse.x = null; mouse.y = null; });
  
  initCanvas();
  animateCanvas();
  // ------------------------------

  const MAX_LEVEL = 52;
  const API = '/api/students';

  let students = [];
  let editingId = null;
  let pendingAvatar = null;
  let prevPositions = {};
  
  let authToken = localStorage.getItem('authToken') || null;
  let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

  const grid = document.getElementById('grid');
  const emptyState = document.getElementById('emptyState');
  const editPanel = document.getElementById('editPanel');
  const modeBadge = document.getElementById('modeBadge');
  const footerNote = document.getElementById('footerNote');
  const trackEl = document.getElementById('track');
  const tooltip = document.getElementById('tooltip');
  const taglineEl = document.getElementById('motivationalTagline');
  
  // Auth UI
  const btnJoinRace = document.getElementById('btnJoinRace');
  const btnLoginToggle = document.getElementById('btnLoginToggle');
  const btnLogout = document.getElementById('btnLogout');
  const authModal = document.getElementById('authModal');
  const authToggleMode = document.getElementById('authToggleMode');
  const authSubmit = document.getElementById('authSubmit');
  const authCancel = document.getElementById('authCancel');
  const authEmail = document.getElementById('authEmail');
  const authPassword = document.getElementById('authPassword');
  const authName = document.getElementById('authName');
  const authNameField = document.getElementById('authNameField');

  let authMode = 'login'; // 'login' or 'register'
  
  // Chart Elements
  const btnViewTrack = document.getElementById('btnViewTrack');
  const btnViewRace = document.getElementById('btnViewRace');
  const btnViewSteps = document.getElementById('btnViewSteps');
  const btnViewBar = document.getElementById('btnViewBar');
  const btnViewPie = document.getElementById('btnViewPie');
  const btnViewTrend = document.getElementById('btnViewTrend');
  
  const viewTrackContainer = document.getElementById('viewTrackContainer');
  const viewRaceContainer = document.getElementById('viewRaceContainer');
  const raceTrackEl = document.getElementById('raceTrack');
  const viewStepsContainer = document.getElementById('viewStepsContainer');
  const stepsToSuccessEl = document.getElementById('stepsToSuccess');
  const viewChartContainer = document.getElementById('viewChartContainer');
  const ctxChart = document.getElementById('statsChart').getContext('2d');
  
  let currentChart = null;
  let currentView = 'track';

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

  function updateAuthUI() {
    if (authToken && currentUser) {
      btnLoginToggle.style.display = 'none';
      btnLogout.style.display = 'inline-block';
      const userHasProfile = students.some(s => s.id === currentUser.id || s.email === currentUser.email);
      if (userHasProfile) {
        btnJoinRace.style.display = 'none';
      } else {
        btnJoinRace.style.display = 'inline-block';
      }
    } else {
      btnLoginToggle.style.display = 'inline-block';
      btnLogout.style.display = 'none';
      btnJoinRace.style.display = 'none';
    }
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
    if (authToken) {
      opts.headers['Authorization'] = 'Bearer ' + authToken;
    }
    const res = await fetch(path, opts);
    if (res.status === 401 || res.status === 403) {
      if (res.status === 401) {
        // Token expired or invalid
        authToken = null;
        currentUser = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        updateAuthUI();
      }
      throw new Error('Unauthorized');
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
    updateAuthUI();
    render();
  }

  async function init() {
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

  // Auth Handlers
  btnLoginToggle.addEventListener('click', () => {
    authMode = 'login';
    authModal.classList.add('open');
    authNameField.style.display = 'none';
    authToggleMode.textContent = 'Need an account? Register';
    authSubmit.textContent = 'Login';
    authEmail.focus();
  });
  
  authCancel.addEventListener('click', () => authModal.classList.remove('open'));
  
  authToggleMode.addEventListener('click', (e) => {
    e.preventDefault();
    if (authMode === 'login') {
      authMode = 'register';
      authNameField.style.display = 'block';
      authToggleMode.textContent = 'Have an account? Login';
      authSubmit.textContent = 'Register';
    } else {
      authMode = 'login';
      authNameField.style.display = 'none';
      authToggleMode.textContent = 'Need an account? Register';
      authSubmit.textContent = 'Login';
    }
  });

  authSubmit.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    const password = authPassword.value;
    if (!email || !password) return alert('Email and Password required');

    try {
      if (authMode === 'register') {
        const name = authName.value.trim();
        if (!name) return alert('Name required');
        
        // Register creates a student directly in this simplified flow
        await api('/api/students', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name, level: 1 })
        });
        
        // Auto-login after register
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        if (!res.ok) throw new Error('Auto-login failed');
        const data = await res.json();
        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
      } else {
        // Login
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        if (!res.ok) {
          const j = await res.json();
          throw new Error(j.error || 'Login failed');
        }
        const data = await res.json();
        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
      }
      authModal.classList.remove('open');
      authEmail.value = '';
      authPassword.value = '';
      await loadStudents();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });

  btnLogout.addEventListener('click', () => {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    updateAuthUI();
    render();
  });

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
    let canEdit = currentUser && (currentUser.role === 'admin' || currentUser.id === s.id);
    
    card.innerHTML = `
      <div class="card-top">
        <div class="avatar" data-role="avatar">${s.avatar ? `<img src="${s.avatar}" alt="${escapeHtml(s.name)}">` : initials(s.name)}</div>
        <div class="who">
          <div class="name">${escapeHtml(s.name)}</div>
          <div class="tier-label">${tier.name}</div>
          <div class="domain-label" style="font-size:0.8rem;color:var(--color-text-muted);">${escapeHtml(s.domain || 'MERN')}</div>
        </div>
      </div>
      <div class="level-row">
        <div class="level-num">${s.level}</div>
        <div class="level-max">/ ${MAX_LEVEL}</div>
      </div>
      <div class="bar-outer"><div class="bar-inner" style="width:${pct}%"></div></div>
      <div class="segments">${segs}</div>
      <div class="desc-line">${s.description ? escapeHtml(s.description) : ''}</div>
      ${canEdit ? `
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
      ` : ''}
    `;
    const avatarEl = card.querySelector('[data-role="avatar"]');
    avatarEl.addEventListener('mouseenter', () => showTooltip(avatarEl, s));
    avatarEl.addEventListener('mouseleave', hideTooltip);

    if (canEdit) {
      card.querySelector('[data-act="inc"]').addEventListener('click', () => bump(s.id, 'up'));
      card.querySelector('[data-act="dec"]').addEventListener('click', () => bump(s.id, 'down'));
      card.querySelector('[data-act="delete"]').addEventListener('click', () => removeStudent(s));
      card.querySelector('[data-act="edit"]').addEventListener('click', () => openPanel(s));
    }
    return card;
  }

  // --- Custom Tooltip ---
  let tooltipEl = null;
  function showTooltip(e, content) {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.style.position = 'absolute';
      tooltipEl.style.background = 'rgba(0, 0, 0, 0.85)';
      tooltipEl.style.color = '#fff';
      tooltipEl.style.padding = '8px 12px';
      tooltipEl.style.borderRadius = '6px';
      tooltipEl.style.border = '1px solid rgba(0, 255, 204, 0.4)';
      tooltipEl.style.boxShadow = '0 0 10px rgba(0, 255, 204, 0.2)';
      tooltipEl.style.pointerEvents = 'none';
      tooltipEl.style.zIndex = '9999';
      tooltipEl.style.fontSize = '0.85rem';
      tooltipEl.style.display = 'flex';
      tooltipEl.style.alignItems = 'center';
      tooltipEl.style.gap = '10px';
      document.body.appendChild(tooltipEl);
    }
    tooltipEl.innerHTML = content;
    tooltipEl.style.display = 'flex';
    tooltipEl.style.left = (e.pageX + 15) + 'px';
    tooltipEl.style.top = (e.pageY + 15) + 'px';
  }
  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }
  document.addEventListener('mousemove', e => {
    if (tooltipEl && tooltipEl.style.display !== 'none') {
      tooltipEl.style.left = (e.pageX + 15) + 'px';
      tooltipEl.style.top = (e.pageY + 15) + 'px';
    }
  });
  // ----------------------

  function renderRaceTrack() {
    raceTrackEl.innerHTML = '';
    
    // Draw finish line marker at top
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.position = 'relative';
    header.style.height = '20px';
    header.style.marginBottom = '10px';
    header.style.borderBottom = '1px dashed var(--color-border)';
    
    const finishLine = document.createElement('div');
    finishLine.textContent = '🏁 Level 52';
    finishLine.style.position = 'absolute';
    finishLine.style.right = '0';
    finishLine.style.bottom = '5px';
    finishLine.style.fontSize = '0.8rem';
    finishLine.style.color = 'var(--color-text-muted)';
    header.appendChild(finishLine);
    raceTrackEl.appendChild(header);

    const sorted = students.slice().sort((a, b) => b.level - a.level);
    sorted.forEach(s => {
      const lane = document.createElement('div');
      lane.style.position = 'relative';
      lane.style.height = '40px';
      lane.style.backgroundColor = 'rgba(0, 255, 204, 0.05)';
      lane.style.borderRadius = '20px';
      lane.style.border = '1px solid rgba(0, 255, 204, 0.2)';
      lane.style.boxShadow = 'inset 0 0 10px rgba(0, 255, 204, 0.1)';
      lane.style.display = 'flex';
      lane.style.alignItems = 'center';
      
      const pct = Math.max(2, (s.level / MAX_LEVEL) * 100);
      
      const runner = document.createElement('div');
      runner.style.position = 'absolute';
      runner.style.left = `calc(${pct}% - 30px)`;
      runner.style.transition = 'left 1s ease-out';
      runner.style.display = 'flex';
      runner.style.alignItems = 'center';
      runner.style.gap = '8px';
      runner.style.cursor = 'pointer';
      
      const avatarHtml = s.avatar 
        ? `<img src="${s.avatar}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;">`
        : `<div style="width:30px;height:30px;border-radius:50%;background:${tierInfo(s.level).color};display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:bold;">${initials(s.name)}</div>`;
      
      const avatar = document.createElement('div');
      avatar.style.boxShadow = `0 0 15px ${tierInfo(s.level).color}`;
      avatar.style.borderRadius = '50%';
      avatar.innerHTML = avatarHtml;
      
      const nameTag = document.createElement('span');
      nameTag.textContent = `${s.name}`;
      nameTag.style.fontSize = '0.8rem';
      nameTag.style.whiteSpace = 'nowrap';
      
      runner.addEventListener('mouseenter', e => {
        showTooltip(e, `${avatarHtml} <div><b>${s.name}</b><br/>Level ${s.level} - ${tierInfo(s.level).name}</div>`);
      });
      runner.addEventListener('mouseleave', hideTooltip);

      runner.appendChild(avatar);
      runner.appendChild(nameTag);
      lane.appendChild(runner);
      raceTrackEl.appendChild(lane);
    });
  }

  function renderStepsToSuccess() {
    stepsToSuccessEl.innerHTML = '';
    
    // Build the staircase
    const stepHeight = 25; // taller for horizontal layout
    
    // Group students by level
    const byLevel = {};
    students.forEach(s => {
      byLevel[s.level] = byLevel[s.level] || [];
      byLevel[s.level].push(s);
    });

    for (let lvl = MAX_LEVEL; lvl >= 1; lvl--) { // Draw from top to bottom
      const stepEl = document.createElement('div');
      stepEl.style.width = '100%';
      stepEl.style.height = `${stepHeight}px`;
      stepEl.style.backgroundColor = (lvl % 5 === 0) ? 'rgba(255, 0, 255, 0.2)' : 'rgba(0, 255, 204, 0.05)';
      stepEl.style.borderBottom = (lvl % 5 === 0) ? '1px solid rgba(255, 0, 255, 0.8)' : '1px solid rgba(0, 255, 204, 0.3)';
      stepEl.style.display = 'flex';
      stepEl.style.alignItems = 'center';
      stepEl.style.paddingLeft = '10px';
      
      const lbl = document.createElement('div');
      lbl.textContent = `Lvl ${lvl}`;
      lbl.style.width = '50px';
      lbl.style.color = 'rgba(255,255,255,0.5)';
      lbl.style.fontSize = '0.8rem';
      stepEl.appendChild(lbl);
      
      const avatarContainer = document.createElement('div');
      avatarContainer.style.display = 'flex';
      avatarContainer.style.gap = '8px';
      avatarContainer.style.flex = '1';
      avatarContainer.style.alignItems = 'center';

      if (byLevel[lvl]) {
        byLevel[lvl].forEach(s => {
          const avatarHtml = s.avatar 
            ? `<img src="${s.avatar}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;">`
            : `<div style="width:20px;height:20px;border-radius:50%;background:${tierInfo(s.level).color};display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:bold;">${initials(s.name)}</div>`;
          
          const avatar = document.createElement('div');
          avatar.style.borderRadius = '50%';
          avatar.style.boxShadow = `0 0 10px ${tierInfo(s.level).color}`;
          avatar.style.cursor = 'pointer';
          avatar.innerHTML = avatarHtml;
          
          avatar.addEventListener('mouseenter', e => {
            showTooltip(e, `${avatarHtml} <div><b>${s.name}</b><br/>Level ${s.level} - ${tierInfo(s.level).name}</div>`);
          });
          avatar.addEventListener('mouseleave', hideTooltip);

          avatarContainer.appendChild(avatar);
        });
      }
      
      stepEl.appendChild(avatarContainer);
      stepsToSuccessEl.appendChild(stepEl);
    }
  }

  function renderCharts() {
    if (currentChart) {
      currentChart.destroy();
      currentChart = null;
    }
    
    viewTrackContainer.style.display = 'none';
    viewRaceContainer.style.display = 'none';
    viewStepsContainer.style.display = 'none';
    viewChartContainer.style.display = 'none';
    
    // Remove background images, just clear them
    viewTrackContainer.style.backgroundImage = 'none';
    viewRaceContainer.style.backgroundImage = 'none';
    viewStepsContainer.style.backgroundImage = 'none';
    viewChartContainer.style.backgroundImage = 'none';

    if (currentView === 'track') {
      viewTrackContainer.style.display = 'block';
    } else if (currentView === 'race') {
      viewRaceContainer.style.display = 'block';
      viewRaceContainer.style.backgroundColor = '#050b14'; // Dark cyberpunk bg
      viewRaceContainer.style.boxShadow = 'inset 0 0 50px rgba(0, 255, 204, 0.1)';
      viewRaceContainer.style.borderRadius = '10px';
      viewRaceContainer.style.padding = '20px';
      viewRaceContainer.style.border = '1px solid rgba(0, 255, 204, 0.3)';
      renderRaceTrack();
    } else if (currentView === 'steps') {
      viewStepsContainer.style.display = 'block';
      viewStepsContainer.style.backgroundColor = '#050b14';
      viewStepsContainer.style.boxShadow = 'inset 0 0 50px rgba(255, 0, 255, 0.1)';
      viewStepsContainer.style.borderRadius = '10px';
      viewStepsContainer.style.border = '1px solid rgba(255, 0, 255, 0.3)';
      renderStepsToSuccess();
    } else {
      viewChartContainer.style.display = 'block';

      if (currentView === 'trend') {
        viewChartContainer.style.backgroundColor = '#050b14';
        viewChartContainer.style.boxShadow = 'inset 0 0 50px rgba(0, 255, 204, 0.1)';
        viewChartContainer.style.borderRadius = '10px';
        viewChartContainer.style.padding = '20px';
        viewChartContainer.style.border = '1px solid rgba(0, 255, 204, 0.3)';
      }

      if (currentView === 'bar') {
        const ranges = { 'Rookie (1-13)': 0, 'Skilled (14-26)': 0, 'Expert (27-39)': 0, 'Master (40-52)': 0 };
        students.forEach(s => {
          if (s.level <= 13) ranges['Rookie (1-13)']++;
          else if (s.level <= 26) ranges['Skilled (14-26)']++;
          else if (s.level <= 39) ranges['Expert (27-39)']++;
          else ranges['Master (40-52)']++;
        });
        
        currentChart = new Chart(ctxChart, {
          type: 'bar',
          data: {
            labels: Object.keys(ranges),
            datasets: [{
              label: 'Number of Students',
              data: Object.values(ranges),
              backgroundColor: ['#e2e8f0', '#94a3b8', '#64748b', '#0f172a']
            }]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });
      } else if (currentView === 'pie') {
        const domains = {};
        students.forEach(s => {
          const d = (s.domain || 'MERN').trim();
          domains[d] = (domains[d] || 0) + 1;
        });
        
        currentChart = new Chart(ctxChart, {
          type: 'pie',
          data: {
            labels: Object.keys(domains),
            datasets: [{
              data: Object.values(domains),
              backgroundColor: ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#64748b']
            }]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });
      } else if (currentView === 'trend') {
        viewChartContainer.style.backgroundColor = '#050b14';
        viewChartContainer.style.boxShadow = 'inset 0 0 50px rgba(0, 255, 204, 0.1)';
        viewChartContainer.style.borderRadius = '10px';
        viewChartContainer.style.padding = '20px';
        viewChartContainer.style.border = '1px solid rgba(0, 255, 204, 0.3)';
        
        // LIMIT TO TOP 15 STUDENTS TO REDUCE CLUTTER
        const topStudents = students.slice().sort((a,b) => b.level - a.level).slice(0, 15);
        
        const labels = topStudents.map(s => s.name);
        const data = topStudents.map(s => s.level);
        const dates = topStudents.map(s => {
          // get most recent date from history, or fallback
          const history = s.history || [];
          if (history.length > 0) {
            const last = history[history.length - 1];
            return new Date(last.at).toLocaleDateString();
          }
          return new Date(s.last_level_up_at || s.created_at || Date.now()).toLocaleDateString();
        });
        
        const backgroundColors = topStudents.map((s, i) => `hsl(${(i * 137.5) % 360}, 70%, 50%)`);

        currentChart = new Chart(ctxChart, {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [{
              label: 'Current Level',
              data: data,
              backgroundColor: backgroundColors,
              borderRadius: 4
            }]
          },
          options: { 
            indexAxis: 'y', // Makes it horizontal
            responsive: true, 
            maintainAspectRatio: false,
            plugins: {
              title: {
                display: true,
                text: 'Student Levels (Top 15)',
                color: 'rgba(255, 255, 255, 0.7)'
              },
              legend: {
                display: false
              },
              tooltip: {
                callbacks: {
                  afterLabel: function(context) {
                    const idx = context.dataIndex;
                    return `Reached on: ${dates[idx]}`;
                  }
                }
              }
            },
            scales: {
              x: { 
                min: 0, 
                max: MAX_LEVEL, 
                ticks: { color: 'rgba(255,255,255,0.5)' },
                title: { display: true, text: 'Modules (Level 1-52)', color: 'rgba(255,255,255,0.7)' }
              },
              y: { 
                ticks: { color: 'rgba(255,255,255,0.5)' } 
              }
            }
          }
        });
      }
    }
  }

  function setView(view) {
    currentView = view;
    btnViewTrack.classList.toggle('active', view === 'track');
    btnViewRace.classList.toggle('active', view === 'race');
    btnViewSteps.classList.toggle('active', view === 'steps');
    btnViewBar.classList.toggle('active', view === 'bar');
    btnViewPie.classList.toggle('active', view === 'pie');
    btnViewTrend.classList.toggle('active', view === 'trend');
    renderCharts();
  }

  btnViewTrack.addEventListener('click', () => setView('track'));
  btnViewRace.addEventListener('click', () => setView('race'));
  btnViewSteps.addEventListener('click', () => setView('steps'));
  btnViewBar.addEventListener('click', () => setView('bar'));
  btnViewPie.addEventListener('click', () => setView('pie'));
  btnViewTrend.addEventListener('click', () => setView('trend'));

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
    renderCharts();
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
    if (!confirm(`Are you sure you want to permanently delete ${s.name}?`)) return;
    try {
      await api(`${API}/${s.id}`, { 
        method: 'DELETE'
      });
      students = students.filter(x => x.id !== s.id);
      delete prevPositions[s.id];
      render();
    } catch (e) { alert('Could not delete: ' + e.message); }
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
  const fDomain = document.getElementById('fDomain');
  const fDesc = document.getElementById('fDesc');

  function openPanel(existing) {
    if (!existing) return; // Edit panel is now strictly for updating existing profiles
    editingId = existing.id;
    panelTitle.textContent = 'Edit Profile';
    fName.value = existing.name;
    fLevel.value = existing.level;
    fDomain.value = existing.domain || '';
    fDesc.value = existing.description || '';
    pendingAvatar = existing.avatar || null;
    avatarPicker.innerHTML = pendingAvatar ? `<img src="${pendingAvatar}" alt="">` : 'Photo';
    editPanel.classList.add('open');
    fName.focus();
  }
  function closePanel() {
    editPanel.classList.remove('open');
    editingId = null; pendingAvatar = null;
    fName.value = ''; fLevel.value = 1; fDesc.value = ''; fDomain.value = '';
    avatarPicker.innerHTML = 'Photo';
  }
  
  if (btnJoinRace) {
    btnJoinRace.addEventListener('click', () => {
      authMode = 'register';
      authModal.classList.add('open');
      authNameField.style.display = 'block';
      authToggleMode.textContent = 'Have an account? Login';
      authSubmit.textContent = 'Join Race (Register)';
      authEmail.focus();
    });
  }

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
    const domain = fDomain.value.trim();
    const description = fDesc.value.trim();
    const payload = { name, level: lvl, description, domain, avatar: pendingAvatar };
    
    try {
      if (editingId) {
        const updated = await api(`${API}/${editingId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        students = students.map(s => s.id === editingId ? updated : s);
        closePanel(); render();
      }
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
