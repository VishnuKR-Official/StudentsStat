(function () {
  let authToken = localStorage.getItem('authToken') || null;
  let currentUser = null;
  try { currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch(e) { localStorage.removeItem('currentUser'); }
  
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
    const isLanding = !authToken || !currentUser;
    ctx.fillStyle = isLanding ? 'rgba(231, 183, 64, 0.5)' : 'rgba(0, 255, 204, 0.5)';
    ctx.strokeStyle = isLanding ? 'rgba(231, 183, 64, 0.15)' : 'rgba(0, 255, 204, 0.15)';
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

  
  let unreadGroupCount = 0;
  let unreadDMCounts = {};
  try { unreadDMCounts = JSON.parse(localStorage.getItem('unreadDMCounts') || '{}'); } catch(e) {}
  
  let lastReadGroup = parseInt(localStorage.getItem('lastReadGroup') || '0');
  let lastReadDMs = {};
  try { lastReadDMs = JSON.parse(localStorage.getItem('lastReadDMs') || '{}'); } catch(e) {}
  
  window.saveBadges = function() {
    localStorage.setItem('lastReadGroup', lastReadGroup);
    localStorage.setItem('lastReadDMs', JSON.stringify(lastReadDMs));
    window.updateBadgeUI();
  }

  
  window.updateBadgeUI = function() {
    const groupBadge = document.getElementById('groupChatBadge');
    if (groupBadge) {
      if (unreadGroupCount > 0) {
        groupBadge.style.display = 'flex';
        groupBadge.textContent = unreadGroupCount;
      } else {
        groupBadge.style.display = 'none';
      }
    }
    
    let totalDMs = 0;
    for (const uid in unreadDMCounts) {
      const count = unreadDMCounts[uid];
      totalDMs += count;
      const cardBadge = document.getElementById('cardBadge_' + uid);
      if (cardBadge) {
        if (count > 0) {
          cardBadge.style.display = 'flex';
          cardBadge.textContent = count;
        } else {
          cardBadge.style.display = 'none';
        }
      }
    }
    
    const dmBadgeTab = document.getElementById('dmBadge');
    if (dmBadgeTab) {
      if (totalDMs > 0) {
        dmBadgeTab.style.display = 'flex';
        dmBadgeTab.textContent = totalDMs;
      } else {
        dmBadgeTab.style.display = 'none';
      }
    }
  }

  let editingId = null;
  let pendingAvatar = null;
  let prevPositions = {};
  
  let currentView = 'track'; // 'track', 'race', 'steps', 'bar', 'pie', 'trend'


  // Handle invite links in URL
  const urlParams = new URLSearchParams(window.location.search);
  const inviteCodeParam = urlParams.get('invite');

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
  const authToggleVisibility = document.getElementById('authToggleVisibility');
  const authName = document.getElementById('authName');
  const authNameField = document.getElementById('authNameField');

  let authMode = 'login'; // 'login' or 'register'
  
  // Batch UI
  const btnInviteCode = document.getElementById('btnInviteCode');
  const btnManageApprovals = document.getElementById('btnManageApprovals');
  const batchSetupModal = document.getElementById('batchSetupModal');
  const joinBatchCode = document.getElementById('joinBatchCode');
  const btnSubmitJoinBatch = document.getElementById('btnSubmitJoinBatch');
  const createBatchName = document.getElementById('createBatchName');
  const btnSubmitCreateBatch = document.getElementById('btnSubmitCreateBatch');
  const manageApprovalsModal = document.getElementById('manageApprovalsModal');
  const pendingUsersList = document.getElementById('pendingUsersList');
  const btnManageApprovalsClose = document.getElementById('btnManageApprovalsClose');
  
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

  const adminBadge = document.getElementById('adminBadge');

  const messageModal = document.getElementById('messageModal');
  const messageTitle = document.getElementById('messageTitle');
  const messageBody = document.getElementById('messageBody');
  document.getElementById('btnMessageClose').addEventListener('click', () => {
    messageModal.classList.remove('open');
  });

  function showMessage(title, text) {
    messageTitle.textContent = title;
    messageBody.textContent = text;
    messageModal.classList.add('open');
  }

  const confirmModal = document.getElementById('confirmModal');
  const confirmTitle = document.getElementById('confirmTitle');
  const confirmMessage = document.getElementById('confirmMessage');
  const btnConfirmNo = document.getElementById('btnConfirmNo');
  const btnConfirmYes = document.getElementById('btnConfirmYes');

  function askConfirm(title, text) {
    return new Promise(resolve => {
      confirmTitle.textContent = title;
      confirmMessage.textContent = text;
      confirmModal.classList.add('open');

      const handleYes = () => { cleanup(); resolve(true); };
      const handleNo = () => { cleanup(); resolve(false); };

      const cleanup = () => {
        confirmModal.classList.remove('open');
        btnConfirmYes.removeEventListener('click', handleYes);
        btnConfirmNo.removeEventListener('click', handleNo);
      };

      btnConfirmYes.addEventListener('click', handleYes);
      btnConfirmNo.addEventListener('click', handleNo);
    });
  }

  const btnLeaveBatch = document.getElementById('btnLeaveBatch');
  const landingHero = document.getElementById('landingHero');
  const appContent = document.getElementById('appContent');
  const btnLandingLogin = document.getElementById('btnLandingLogin');
  
  if (btnLandingLogin) {
    btnLandingLogin.addEventListener('click', () => {
      authMode = 'login';
      authModal.classList.add('open');
      authNameField.style.display = 'none';
      authToggleMode.textContent = 'Need an account? Register';
      authSubmit.textContent = 'Login';
      authEmail.focus();
    });
  }

  function updateAuthUI() {
    // Reset displays
    btnLoginToggle.style.display = 'inline-block';
    btnLogout.style.display = 'none';
    btnJoinRace.style.display = 'none';
    btnInviteCode.style.display = 'none';
    btnManageApprovals.style.display = 'none';
    if (btnLeaveBatch) btnLeaveBatch.style.display = 'none';
    batchSetupModal.classList.remove('open');
    if (adminBadge) adminBadge.style.display = 'none';
    
    if (authToken && currentUser) {
      if (landingHero) landingHero.style.display = 'none';
      if (appContent) appContent.style.display = 'block';
      
      btnLoginToggle.style.display = 'none';
      btnLogout.style.display = 'inline-block';
      
      if (!currentUser.batch_id) {
        batchSetupModal.classList.add('open');
        if (currentUser.role === 'global_admin') {
          const gaSection = document.getElementById('globalAdminBatchesSection');
          const gaList = document.getElementById('globalAdminBatchesList');
          if (gaSection && gaList) {
            gaSection.style.display = 'block';
            api('/api/admin/batches').then(batches => {
              gaList.innerHTML = batches.map(b => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg); padding:5px; border-radius:4px;">
                  <span>${escapeHtml(b.name)}</span>
                  <button class="small" onclick="enterGlobalBatch('${b.id}')">Enter</button>
                </div>
              `).join('');
            }).catch(e => showMessage('Error', 'Could not load batches'));
          }
        }
      } else if (currentUser.batch_status === 'pending') {
        batchSetupModal.classList.remove('open');
        showMessage('Pending Approval', 'Your request to join the batch is pending admin approval.');
      } else if (currentUser.batch_status === 'approved') {
        batchSetupModal.classList.remove('open');
        btnInviteCode.style.display = 'inline-block';
        if (btnLeaveBatch) btnLeaveBatch.style.display = 'inline-block';
        const btnOpenGroupChat = document.getElementById('btnOpenGroupChat');
        if (btnOpenGroupChat) btnOpenGroupChat.style.display = 'inline-block';
        
        if (currentUser.role === 'admin') {
          if (adminBadge) adminBadge.style.display = 'inline-block';
          btnManageApprovals.style.display = 'inline-block';
        }
        
        const userHasProfile = students.some(s => s.id === currentUser.id || s.email === currentUser.email);
        if (userHasProfile || currentUser.role === 'admin') {
          btnJoinRace.style.display = 'none';
        } else {
          btnJoinRace.style.display = 'inline-block';
        }
      }
    } else {
      if (landingHero) landingHero.style.display = 'flex';
      if (appContent) appContent.style.display = 'none';
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
    try {
      if (authToken) {
        students = await api(API);
        if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'global_admin') && currentUser.batch_id) {
          try {
            const pending = await api('/api/batches/pending');
            const count = pending ? pending.length : 0;
            const b = document.getElementById('approvalsBadge');
            if (b) {
              b.style.display = count > 0 ? 'flex' : 'none';
              b.textContent = count;
            }
          } catch(e) {}
        }
      } else {
        students = [];
      }
    } catch (e) {
      console.warn('Failed to load students:', e);
      students = [];
    }
    updateAuthUI();
    render();
  }

  async function init() {
    try {
      if (authToken) {
        try {
          const data = await api('/api/me');
          if (data && data.token) {
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
          }
        } catch (e) {
          console.warn('Failed to refresh token', e);
        }
      }

      await loadStudents();
      let editIcon = (currentUser && currentUser.role === 'admin') ? ` <i class="fas fa-edit" id="btnEditBatchName" style="cursor:pointer;" title="Edit Batch Name"></i>` : '';
      const batchDisplay = currentUser && currentUser.batch_name ? ` (Batch: ${escapeHtml(currentUser.batch_name)}${editIcon})` : '';
      modeBadge.innerHTML = 'Connected' + batchDisplay;

      setTimeout(() => {
        const btnEditBatchName = document.getElementById('btnEditBatchName');
        if (btnEditBatchName) {
          btnEditBatchName.addEventListener('click', async () => {
            const newName = prompt('Enter new batch name:', currentUser.batch_name);
            if (newName && newName.trim() !== currentUser.batch_name) {
              try {
                await api(`/api/batches/${currentUser.batch_id}/name`, {
                  method: 'PUT', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: newName.trim() })
                });
                currentUser.batch_name = newName.trim();
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                init();
  setTimeout(() => { if (window.updateBadgeUI) window.updateBadgeUI(); }, 1000);
              } catch(e) { showMessage('Error', e.message); }
            }
          });
        }
      }, 50);
      footerNote.textContent = 'Data is stored in the server\'s database and stays until a student is deleted.';
      
      if (inviteCodeParam && !authToken) {
        authMode = 'register';
        authToggleMode.textContent = 'Already have an account? Login';
        authNameField.style.display = 'block';
        authSubmit.textContent = 'Register & Join Batch';
        authModal.classList.add('open');
      }
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
  
  if (authToggleVisibility) {
    authToggleVisibility.addEventListener('click', () => {
      const isPass = authPassword.type === 'password';
      authPassword.type = isPass ? 'text' : 'password';
      const eyeIcon = document.getElementById('eyeIcon');
      if (eyeIcon) {
        eyeIcon.className = isPass ? 'fas fa-eye-slash' : 'fas fa-eye';
      }
    });
  }
  
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

  const authAdminLogin = document.getElementById('authAdminLogin');
  if (authAdminLogin) {
    authAdminLogin.addEventListener('click', async (e) => {
      e.preventDefault();
      const pwd = prompt('Enter System Admin Password:');
      if (!pwd) return;
      try {
        const res = await api('/api/admin/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd })
        });
        authToken = res.token;
        currentUser = res.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        authModal.classList.remove('open');
        updateAuthUI();
        init();
  setTimeout(() => { if (window.updateBadgeUI) window.updateBadgeUI(); }, 1000);
        showMessage('Success', 'Logged in as Global Admin');
      } catch (e) { showMessage('Error', 'Invalid Admin Password'); }
    });
  }

  authSubmit.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    const password = authPassword.value;
    if (!email || !password) return showMessage('Error', 'Email and Password required');

    try {
      if (authMode === 'register') {
        const name = authName.value.trim();
        if (!name) return showMessage('Error', 'Name required');
        
        // Use the proper register endpoint
        const regRes = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name, inviteCode: inviteCodeParam })
        });
        if (!regRes.ok) {
          const j = await regRes.json();
          throw new Error(j.error || 'Registration failed');
        }
        
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
        
        showMessage("Welcome", "Registration successful! You have been automatically logged in.");
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
        
        showMessage("Welcome Back", "Login successful!");
      }
      authModal.classList.remove('open');
      authEmail.value = '';
      authPassword.value = '';
      await loadStudents();
    } catch (e) {
      showMessage("Error", e.message);
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

  // Move modals out of appContent so they can be visible when appContent is hidden
  const modalsToMove = ['authModal', 'batchSetupModal', 'manageApprovalsModal', 'messageModal', 'confirmModal'];
  modalsToMove.forEach(id => {
    const modal = document.getElementById(id);
    if (modal) document.body.appendChild(modal);
  });

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
    let isOtherUser = currentUser && currentUser.id !== s.id;
    let isAdminViewer = currentUser && currentUser.role === 'admin';
    let showAdminControls = isAdminViewer && isOtherUser;
    
    card.innerHTML = `
      <div class="card-top">
        <div class="avatar" data-role="avatar">${s.avatar ? `<img src="${s.avatar}" alt="${escapeHtml(s.name)}">` : initials(s.name)}</div>
        <div class="who">
          <div class="name">${escapeHtml(s.name)} ${s.role === 'admin' ? '👑' : ''}</div>
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
      <div class="social-icons">
        ${s.github ? `<a href="${escapeHtml(s.github)}" target="_blank" title="GitHub"><i class="fab fa-github"></i></a>` : ''}
        ${s.linkedin ? `<a href="${escapeHtml(s.linkedin)}" target="_blank" title="LinkedIn"><i class="fab fa-linkedin"></i></a>` : ''}
        ${s.x_account ? `<a href="${escapeHtml(s.x_account)}" target="_blank" title="X (Twitter)"><i class="fab fa-x-twitter"></i></a>` : ''}
        ${isOtherUser ? `<button class="btn-dm" data-act="dm" title="Direct Message" style="position:relative;"><i class="fas fa-comment"></i> One to One Chat <span id="cardBadge_\" class="badge" style="display:none; top:-8px; right:-8px; width:20px; height:20px; font-size:0.65rem;">0</span></button>` : ''}
      </div>
      ${canEdit ? `
      <div class="card-controls" style="flex-direction: column; align-items: stretch; gap: 8px; margin-top: 10px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="lvl-btns">
            <button data-act="dec" title="Level down">−</button>
            <button data-act="inc" title="Level up">+</button>
          </div>
          <div class="card-menu">
            <button class="small" data-act="edit">Edit</button>
            <button class="small danger" data-act="delete">Delete</button>
          </div>
        </div>
        ${showAdminControls ? `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <button class="small ghost" data-act="role">${s.role === 'admin' ? 'Revoke Admin' : 'Make Admin'}</button>
          <button class="small danger" data-act="block">Block</button>
        </div>
        ` : ''}
      </div>
      ` : ''}
    `;
    const avatarEl = card.querySelector('[data-role="avatar"]');
    avatarEl.addEventListener('mouseenter', () => showTooltip(avatarEl, s));
    avatarEl.addEventListener('mouseleave', hideTooltip);
    
    const dmBtn = card.querySelector('[data-act="dm"]');
    if (dmBtn) {
      dmBtn.addEventListener('click', () => {
        // Open chat panel, select DM tab, set recipient
        const chatSidebar = document.getElementById('chatSidebar');
        if (chatSidebar) {
          chatSidebar.classList.add('open');
          
          
          const tabDMs = document.getElementById('tabDMs');
          const tabGroupChat = document.getElementById('tabGroupChat');
          const dmChatView = document.getElementById('dmChatView');
          const groupChatView = document.getElementById('groupChatView');
          
          lastReadDMs[s.id] = Date.now();
          unreadDMCounts[s.id] = 0;
          saveBadges();

          
          if (tabDMs && dmChatView) {
            tabDMs.classList.add('active');
            tabGroupChat.classList.remove('active');
            dmChatView.classList.add('active');
            groupChatView.classList.remove('active');
          }
          
          const dmRecipientSelect = document.getElementById('dmRecipientSelect');
          if (dmRecipientSelect) {
            dmRecipientSelect.value = s.id;
            // update chat history view for new selection
            dmRecipientSelect.dispatchEvent(new Event('change'));
          }
        }
      });
    }

    if (canEdit) {
      card.querySelector('[data-act="inc"]').addEventListener('click', () => bump(s.id, 'up'));
      card.querySelector('[data-act="dec"]').addEventListener('click', () => bump(s.id, 'down'));
      card.querySelector('[data-act="delete"]').addEventListener('click', () => removeStudent(s));
      card.querySelector('[data-act="edit"]').addEventListener('click', () => openPanel(s));
      
      const roleBtn = card.querySelector('[data-act="role"]');
      if (roleBtn) {
        roleBtn.addEventListener('click', async () => {
          if (!(await askConfirm('Change Role', `Are you sure you want to ${s.role === 'admin' ? 'revoke' : 'grant'} admin privileges for ${s.name}?`))) return;
          try {
            await api(`/api/students/${s.id}/role`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: s.role === 'admin' ? 'student' : 'admin' })
            });
            loadStudents();
          } catch(e) { showMessage('Error', e.message); }
        });
      }

      const blockBtn = card.querySelector('[data-act="block"]');
      if (blockBtn) {
        blockBtn.addEventListener('click', async () => {
          if (!(await askConfirm('Block User', `Are you sure you want to permanently block ${s.name}? They will be removed from this batch and cannot join again.`))) return;
          try {
            await api(`/api/students/${s.id}/block`, { method: 'POST' });
            loadStudents();
          } catch(e) { showMessage('Error', e.message); }
        });
      }
    }
    return card;
  }

  // --- Custom Tooltip ---
  let tooltipEl = null;
  function showGraphTooltip(e, content) {
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
  function hideGraphTooltip() {
    if (tooltipEl) {
      tooltipEl.style.display = 'none';
    }
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
        showGraphTooltip(e, `${avatarHtml} <div><b>${s.name}</b><br/>Level ${s.level} - ${tierInfo(s.level).name}</div>`);
      });
      runner.addEventListener('mouseleave', hideGraphTooltip);

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
            showGraphTooltip(e, `${avatarHtml} <div><b>${s.name}</b><br/>Level ${s.level} - ${tierInfo(s.level).name}</div>`);
          });
          avatar.addEventListener('mouseleave', hideGraphTooltip);

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

  const searchBar = document.getElementById('searchBar');
  if (searchBar) {
    searchBar.addEventListener('input', render);
  }

  function render() {
    grid.innerHTML = '';
    const q = searchBar ? searchBar.value.toLowerCase() : '';
    let filtered = students.slice();
    if (q) {
      filtered = filtered.filter(s => 
        s.name.toLowerCase().includes(q) || 
        s.level.toString().includes(q) || 
        (s.domain && s.domain.toLowerCase().includes(q)) || 
        (s.description && s.description.toLowerCase().includes(q))
      );
    }
    
    if (filtered.length === 0) {
      emptyState.style.display = 'block';
      if (students.length > 0) emptyState.innerHTML = '<h3>No matches found</h3>';
      else emptyState.innerHTML = '<h3>No students yet</h3><div>Add your first student to start tracking levels.</div>';
    } else {
      emptyState.style.display = 'none';
      filtered.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
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
    } catch (e) { showMessage('Could not update level', e.message); }
  }

  async function removeStudent(s) {
    if (!(await askConfirm('Delete User', `Are you sure you want to permanently delete ${s.name}?`))) return;
    try {
      await api(`${API}/${s.id}`, { 
        method: 'DELETE'
      });
      if (currentUser && currentUser.id === s.id) {
        // If the user deleted themselves, log them out.
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        authToken = null;
        currentUser = null;
        updateAuthUI();
        window.location.reload();
        return;
      }
      students = students.filter(x => x.id !== s.id);
      render();
    } catch (e) { showMessage('Could not delete', e.message); }
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
  const fGithub = document.getElementById('fGithub');
  const fLinkedin = document.getElementById('fLinkedin');
  const fTwitter = document.getElementById('fTwitter');

  function openPanel(existing) {
    if (!existing) return; // Edit panel is now strictly for updating existing profiles
    editingId = existing.id;
    panelTitle.textContent = 'Edit Profile';
    fName.value = existing.name;
    fLevel.value = existing.level;
    fDomain.value = existing.domain || '';
    fDesc.value = existing.description || '';
    fGithub.value = existing.github || '';
    fLinkedin.value = existing.linkedin || '';
    fTwitter.value = existing.x_account || '';
    pendingAvatar = existing.avatar || null;
    avatarPicker.innerHTML = pendingAvatar ? `<img src="${pendingAvatar}" alt="">` : 'Photo';
    editPanel.classList.add('open');
    fName.focus();
  }
  function closePanel() {
    editPanel.classList.remove('open');
    editingId = null; pendingAvatar = null;
    fName.value = ''; fLevel.value = 1; fDesc.value = ''; fDomain.value = '';
    fGithub.value = ''; fLinkedin.value = ''; fTwitter.value = '';
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
    const github = fGithub.value.trim();
    const linkedin = fLinkedin.value.trim();
    const x_account = fTwitter.value.trim();
    const payload = { name, level: lvl, description, domain, github, linkedin, x_account, avatar: pendingAvatar };
    
    try {
      if (editingId) {
        const updated = await api(`${API}/${editingId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        students = students.map(s => s.id === editingId ? updated : s);
        closePanel(); render();
      }
    } catch (e) { showMessage('Error', e.message); }
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
        const merge = await askConfirm('Import Option', 'Merge with current students? Cancel to replace the board entirely.');
        students = await api(`/api/import?mode=${merge ? 'merge' : 'replace'}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
        });
        render();
      } catch (err) { showMessage('Import Error', 'That file could not be imported: ' + err.message); }
    };
    reader.readAsText(file);
    importFile.value = '';
  });

  if (btnLeaveBatch) {
    btnLeaveBatch.addEventListener('click', async () => {
      if (!(await askConfirm('Leave Batch', 'Are you sure you want to leave this batch?'))) return;
      try {
        await api('/api/batches/leave', { method: 'POST' });
        currentUser.batch_id = null;
        currentUser.batch_status = null;
        if (currentUser.role !== 'global_admin') {
          currentUser.role = 'student';
        }
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        window.location.reload();
      } catch(e) {
        showMessage('Error', e.message);
      }
    });
  }


  // Batch Event Listeners
  btnSubmitCreateBatch.addEventListener('click', async () => {
    const name = createBatchName.value.trim();
    if (!name) return showMessage('Error', 'Batch name required');
    try {
      const data = await api('/api/batches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
      });
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('authToken', authToken);
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      updateAuthUI();
      loadStudents();
      showMessage('Success', `Batch created! Invite code: ${data.invite_code}`);
    } catch(e) {
      showMessage('Error', e.message);
    }
  });

  btnSubmitJoinBatch.addEventListener('click', async () => {
    const code = joinBatchCode.value.trim();
    if (!code) return showMessage('Error', 'Invite code required');
    try {
      const data = await api('/api/batches/join', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteCode: code })
      });
      currentUser.batch_status = 'pending';
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      updateAuthUI();
      showMessage('Success', data.message);
    } catch(e) {
      showMessage('Error', e.message);
    }
  });

  btnInviteCode.addEventListener('click', async () => {
    try {
      const b = await api('/api/batches/my-batch');
      const url = `${window.location.origin}/?invite=${b.invite_code}`;
      await navigator.clipboard.writeText(url);
      showMessage('Copied!', `Invite link copied to clipboard:\n\n${url}`);
    } catch(e) {
      showMessage('Error', e.message);
    }
  });

  btnManageApprovals.addEventListener('click', async () => {
    try {
      const pending = await api('/api/batches/pending');
      pendingUsersList.innerHTML = '';
      if (pending.length === 0) {
        pendingUsersList.innerHTML = '<p style="color:var(--muted);text-align:center;">No pending requests.</p>';
      } else {
        pending.forEach(u => {
          const div = document.createElement('div');
          div.style = 'display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:10px; border-radius:5px;';
          div.innerHTML = `
            <div><strong>${escapeHtml(u.name)}</strong> <small>(${escapeHtml(u.email)})</small></div>
            <div>
              <button class="primary small btn-approve" data-id="${u.id}">Approve</button>
              <button class="ghost small btn-reject" data-id="${u.id}">Reject</button>
            </div>
          `;
          pendingUsersList.appendChild(div);
        });
        
        pendingUsersList.querySelectorAll('.btn-approve').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            await api(`/api/batches/approve/${e.target.dataset.id}`, { method: 'POST' });
            e.target.closest('div').parentElement.remove();
            loadStudents();
          });
        });
        pendingUsersList.querySelectorAll('.btn-reject').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            await api(`/api/batches/reject/${e.target.dataset.id}`, { method: 'POST' });
            e.target.closest('div').parentElement.remove();
          });
        });
      }
      manageApprovalsModal.classList.add('open');
    } catch(e) {
      showMessage('Error', e.message);
    }
  });

  btnManageApprovalsClose.addEventListener('click', () => {
    manageApprovalsModal.classList.remove('open');
  });

  // --- CHAT LOGIC ---
  let socket = null;
  
  function initChat() {
    if (socket) {
      socket.disconnect();
    }
    
    if (!authToken || !currentUser || !currentUser.batch_id) return;
    
    // Check if io is defined (from the script tag)
    if (typeof io === 'undefined') return;
    
    socket = io({ auth: { token: authToken } });
    
    const chatSidebar = document.getElementById('chatSidebar');
    const btnCloseChat = document.getElementById('btnCloseChat');
    const tabGroupChat = document.getElementById('tabGroupChat');
    const tabDMs = document.getElementById('tabDMs');
    const groupChatView = document.getElementById('groupChatView');
    const dmChatView = document.getElementById('dmChatView');
    const dmRecipientSelect = document.getElementById('dmRecipientSelect');
    
    const groupMessages = document.getElementById('groupMessages');
    const dmMessages = document.getElementById('dmMessages');
    
    const groupMsgInput = document.getElementById('groupMsgInput');
    const btnSendGroup = document.getElementById('btnSendGroup');
    const dmMsgInput = document.getElementById('dmMsgInput');
    const btnSendDm = document.getElementById('btnSendDm');
    
    let allMessages = [];
    
    function renderMessages() {
      // Group Chat
      groupMessages.innerHTML = '';
      const groupMsgs = allMessages.filter(m => !m.receiver_id);
      groupMsgs.forEach(m => {
        const div = document.createElement('div');
        div.className = `chat-message ${m.sender_id === currentUser.id ? 'sent' : 'received'}`;
        const sender = students.find(s => s.id === m.sender_id);
        div.innerHTML = `<strong>${m.sender_id === currentUser.id ? 'You' : escapeHtml(sender ? sender.name : 'Unknown')}</strong>: ${escapeHtml(m.content)}`;
        groupMessages.appendChild(div);
      });
      groupMessages.scrollTop = groupMessages.scrollHeight;
      
      // DMs
      dmMessages.innerHTML = '';
      const selectedUserId = dmRecipientSelect.value;
      if (selectedUserId) {
        dmMsgInput.disabled = false;
        btnSendDm.disabled = false;
        const privateMsgs = allMessages.filter(m => 
          (m.sender_id === currentUser.id && m.receiver_id === selectedUserId) ||
          (m.sender_id === selectedUserId && m.receiver_id === currentUser.id)
        );
        privateMsgs.forEach(m => {
          const div = document.createElement('div');
          div.className = `chat-message ${m.sender_id === currentUser.id ? 'sent' : 'received'}`;
          const sender = students.find(s => s.id === m.sender_id);
          div.innerHTML = `<strong>${m.sender_id === currentUser.id ? 'You' : escapeHtml(sender ? sender.name : 'Unknown')}</strong>: ${escapeHtml(m.content)}`;
          dmMessages.appendChild(div);
        });
        dmMessages.scrollTop = dmMessages.scrollHeight;
      } else {
        dmMsgInput.disabled = true;
        btnSendDm.disabled = true;
        dmMessages.innerHTML = '<div style="text-align:center; color:var(--muted); margin-top:20px;">Select a user to message</div>';
      }
    }
    
    function populateDMSelect() {
      const currentVal = dmRecipientSelect.value;
      dmRecipientSelect.innerHTML = '<option value="">Select a user...</option>';
      students.forEach(s => {
        if (s.id !== currentUser.id) {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name;
          dmRecipientSelect.appendChild(opt);
        }
      });
      if (currentVal) dmRecipientSelect.value = currentVal;
    }
    
    // Need to trigger populate on student list updates
    const oldRender = render;
    render = function() {
      oldRender();
      if (dmRecipientSelect) populateDMSelect();
    };
    
    
    dmRecipientSelect.addEventListener('change', () => {
      if (dmRecipientSelect.value) {
        lastReadDMs[dmRecipientSelect.value] = Date.now();
        unreadDMCounts[dmRecipientSelect.value] = 0;
        saveBadges();
      }
      renderMessages();
    });

    
    socket.on('connect', () => {
      socket.emit('fetch_messages');
    });
    
    
    socket.on('recent_messages', (msgs) => {
      allMessages = msgs;
      
      // Calculate unread from history
      unreadGroupCount = 0;
      unreadDMCounts = {};
      const isSidebarOpen = chatSidebar.classList.contains('open');
      const isGroupTab = tabGroupChat.classList.contains('active');
      const isDMTab = tabDMs.classList.contains('active');
      
      msgs.forEach(m => {
        if (m.sender_id === currentUser.id) return;
        const msgTime = new Date(m.created_at).getTime();
        if (m.receiver_id) {
          const lr = lastReadDMs[m.sender_id] || 0;
          if (msgTime > lr) {
             if (!isSidebarOpen || !isDMTab || dmRecipientSelect.value !== m.sender_id) {
               unreadDMCounts[m.sender_id] = (unreadDMCounts[m.sender_id] || 0) + 1;
             } else {
               lastReadDMs[m.sender_id] = Date.now(); // update as read
             }
          }
        } else {
          if (msgTime > lastReadGroup) {
             if (!isSidebarOpen || !isGroupTab) {
               unreadGroupCount++;
             } else {
               lastReadGroup = Date.now();
             }
          }
        }
      });
      saveBadges();
      renderMessages();
    });

    
    
    socket.on('new_message', (m) => {
      allMessages.push(m);
      const isSidebarOpen = chatSidebar.classList.contains('open');
      const isGroupTab = tabGroupChat.classList.contains('active');
      const isDMTab = tabDMs.classList.contains('active');
      
      if (m.receiver_id) {
        if (!isSidebarOpen || !isDMTab || dmRecipientSelect.value !== m.sender_id) {
          if (m.sender_id !== currentUser.id) {
            unreadDMCounts[m.sender_id] = (unreadDMCounts[m.sender_id] || 0) + 1;
            saveBadges();
          }
        } else {
          lastReadDMs[m.sender_id] = Date.now();
          saveBadges();
          renderMessages();
        }
      } else {
        if (!isSidebarOpen || !isGroupTab) {
          if (m.sender_id !== currentUser.id) {
            unreadGroupCount++;
            saveBadges();
          }
        } else {
          lastReadGroup = Date.now();
          saveBadges();
          renderMessages();
        }
      }
    });

    
    function sendMsg(content, receiver_id = null) {
      if (!content) return;
      socket.emit('send_message', { content, receiver_id });
    }
    
    btnSendGroup.addEventListener('click', () => {
      sendMsg(groupMsgInput.value.trim());
      groupMsgInput.value = '';
    });
    groupMsgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnSendGroup.click();
    });
    
    btnSendDm.addEventListener('click', () => {
      sendMsg(dmMsgInput.value.trim(), dmRecipientSelect.value);
      dmMsgInput.value = '';
    });
    dmMsgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnSendDm.click();
    });
    
    // UI Toggles
    
    const btnOpenGroupChat = document.getElementById('btnOpenGroupChat');
    if (btnOpenGroupChat) {
      btnOpenGroupChat.addEventListener('click', () => {
        lastReadGroup = Date.now();
        unreadGroupCount = 0;
        saveBadges();
        chatSidebar.classList.add('open');

        tabGroupChat.click();
      });
    }
    
    btnCloseChat.addEventListener('click', () => {
      chatSidebar.classList.remove('open');
    });
    
    
    tabGroupChat.addEventListener('click', () => {
      lastReadGroup = Date.now();
      unreadGroupCount = 0;
      saveBadges();
      tabGroupChat.classList.add('active');

      tabDMs.classList.remove('active');
      groupChatView.classList.add('active');
      dmChatView.classList.remove('active');
      renderMessages();
    });
    
    tabDMs.addEventListener('click', () => {
      tabDMs.classList.add('active');
      tabGroupChat.classList.remove('active');
      dmChatView.classList.add('active');
      groupChatView.classList.remove('active');
      renderMessages();
    });
  }

  // Hook initChat into the startup sequence
  const oldInit = init;
  init = async function() {
    await oldInit();
    initChat();
  };
  
  // Also re-init chat when auth token changes
  const oldUpdateAuth = updateAuthUI;
  updateAuthUI = function() {
    oldUpdateAuth();
    if (authToken && currentUser && currentUser.batch_id) {
       // Only init if socket isn't already connected to the right batch
       if (!socket || !socket.connected) {
         initChat();
       }
    } else {
      if (socket) socket.disconnect();
      const chatSidebar = document.getElementById('chatSidebar');
      if (chatSidebar) chatSidebar.classList.remove('open');
      const groupMessages = document.getElementById('groupMessages');
      if (groupMessages) groupMessages.innerHTML = '';
      const dmMessages = document.getElementById('dmMessages');
      if (dmMessages) dmMessages.innerHTML = '';
    }
  };

  init();
  setTimeout(() => { if (window.updateBadgeUI) window.updateBadgeUI(); }, 1000);
  // Refresh periodically so streak/emoji state (and other people's edits) stay current
  setInterval(loadStudents, 30000);

  // --- Landing Canvas Animation ---
  const landingCanvas = document.getElementById('landingCanvas');
  if (landingCanvas) {
    const lctx = landingCanvas.getContext('2d');
    let lnodes = [];
    let lmx = -1000, lmy = -1000;
    
    function initLandingCanvas() {
      landingCanvas.width = window.innerWidth;
      landingCanvas.height = window.innerHeight;
      lnodes = [];
      const numNodes = Math.floor((landingCanvas.width * landingCanvas.height) / 10000);
      for (let i = 0; i < numNodes; i++) {
        lnodes.push({
          x: Math.random() * landingCanvas.width,
          y: Math.random() * landingCanvas.height,
          vx: (Math.random() - 0.5) * 1.5,
          vy: (Math.random() - 0.5) * 1.5,
          radius: Math.random() * 2 + 1
        });
      }
    }
    
    window.addEventListener('resize', () => {
      if (landingHero && landingHero.style.display !== 'none') initLandingCanvas();
    });
    
    landingCanvas.addEventListener('mousemove', (e) => {
      lmx = e.clientX; lmy = e.clientY;
    });
    landingCanvas.addEventListener('mouseleave', () => {
      lmx = -1000; lmy = -1000;
    });

    function drawLanding() {
      if (landingHero && landingHero.style.display === 'none') {
        requestAnimationFrame(drawLanding);
        return;
      }
      
      lctx.clearRect(0, 0, landingCanvas.width, landingCanvas.height);
      
      // Update nodes
      for (let n of lnodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > landingCanvas.width) n.vx *= -1;
        if (n.y < 0 || n.y > landingCanvas.height) n.vy *= -1;
        
        // Mouse repel
        const dx = lmx - n.x;
        const dy = lmy - n.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 150) {
          n.x -= (dx / dist) * 2;
          n.y -= (dy / dist) * 2;
        }
        
        lctx.beginPath();
        lctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        lctx.fillStyle = 'rgba(62, 214, 160, 0.8)';
        lctx.fill();
      }
      
      // Draw connections
      for (let i = 0; i < lnodes.length; i++) {
        for (let j = i + 1; j < lnodes.length; j++) {
          const dx = lnodes[i].x - lnodes[j].x;
          const dy = lnodes[i].y - lnodes[j].y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < 120) {
            lctx.beginPath();
            lctx.moveTo(lnodes[i].x, lnodes[i].y);
            lctx.lineTo(lnodes[j].x, lnodes[j].y);
            lctx.strokeStyle = `rgba(62, 214, 160, ${1 - dist/120})`;
            lctx.stroke();
          }
        }
      }
      
      requestAnimationFrame(drawLanding);
    }
    
    initLandingCanvas();
    drawLanding();
  }
})();

window.enterGlobalBatch = async function(batch_id) {
  try {
    let authToken = localStorage.getItem('authToken');
    const res = await fetch('/api/admin/enter-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
      body: JSON.stringify({ batch_id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    localStorage.setItem('authToken', data.token);
    localStorage.setItem('currentUser', JSON.stringify(data.user));
    window.location.reload();
  } catch(e) {
    alert(e.message);
  }
};
