const MAPS = [
  {
    name: 'مدينة النور',
    grid: [
      ['school',   'road', 'hospital',   'road', 'pharmacy'],
      ['road',     'road', 'road',       'road', 'road'],
      ['house1',   'road', 'market',     'road', 'house2'],
      ['road',     'road', 'road',       'road', 'road'],
      ['factory',  'road', 'park',       'road', 'apartment'],
    ]
  },
  {
    name: 'قرية الخضراء',
    grid: [
      ['farm1',  'road', 'farm2',   'road', 'well'],
      ['road',   'road', 'road',    'road', 'road'],
      ['barn',   'road', 'mosque',  'road', 'house3'],
      ['road',   'road', 'road',    'road', 'road'],
      ['garden', 'road', 'school2', 'road', 'clinic'],
    ]
  },
  {
    name: 'المنطقة الصناعية',
    grid: [
      ['factory1', 'road', 'factory2',   'road', 'warehouse1'],
      ['road',     'road', 'road',       'road', 'road'],
      ['office',   'road', 'powerplant', 'road', 'warehouse2'],
      ['road',     'road', 'road',       'road', 'road'],
      ['garage',   'road', 'lab',        'road', 'security'],
    ]
  }
];

const CELLS = {
  school:     { i: '🏫', n: 'مدرسة النور' },
  hospital:   { i: '🏥', n: 'مستشفى الأمل' },
  pharmacy:   { i: '💊', n: 'صيدلية الشفاء' },
  house1:     { i: '🏠', n: 'منزل الورود' },
  market:     { i: '🏪', n: 'سوق الخير' },
  house2:     { i: '🏡', n: 'فيلا السلام' },
  factory:    { i: '🏭', n: 'مصنع الغد' },
  park:       { i: '🌳', n: 'حديقة النزهة' },
  apartment:  { i: '🏢', n: 'عمارة النيل' },
  farm1:      { i: '🌾', n: 'مزرعة الأمل' },
  farm2:      { i: '🌻', n: 'مزرعة السلام' },
  well:       { i: '💧', n: 'بئر القرية' },
  barn:       { i: '🐄', n: 'حظيرة الحيوانات' },
  mosque:     { i: '🕌', n: 'مسجد القرية' },
  house3:     { i: '🏘️', n: 'بيت الريف' },
  garden:     { i: '🌿', n: 'بستان الزيتون' },
  school2:    { i: '📚', n: 'مدرسة الريف' },
  clinic:     { i: '🩺', n: 'عيادة القرية' },
  factory1:   { i: '🏭', n: 'مصنع الصلب' },
  factory2:   { i: '⚙️', n: 'مصنع الكيماويات' },
  warehouse1: { i: '📦', n: 'مستودع أ' },
  office:     { i: '🏢', n: 'المكتب الرئيسي' },
  powerplant: { i: '⚡', n: 'محطة الكهرباء' },
  warehouse2: { i: '🗄️', n: 'مستودع ب' },
  garage:     { i: '🔧', n: 'ورشة الإصلاح' },
  lab:        { i: '🔬', n: 'المعمل' },
  security:   { i: '🛡️', n: 'مركز الأمن' },
  road:       { i: '', n: 'طريق' }
};

let peer = null, conn = null;
let G = {
  name: '', isHost: false, role: 'hider', mapIdx: 0,
  myScore: 0, opScore: 0, oppName: '؟',
  hidden: null, selected: null, attempts: 3,
  phase: 'lobby', timerV: 60, timerI: null
};

// ─── Screens ───────────────────────────────────────────────
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('s-' + id).classList.add('active');
}

function showErr(msg) {
  const e = document.getElementById('lobby-err');
  e.textContent = msg; e.style.display = 'block';
  setTimeout(() => e.style.display = 'none', 3500);
}

function getName() {
  const n = document.getElementById('inp-name').value.trim();
  if (!n) { showErr('من فضلك ادخل اسمك'); return null; }
  return n;
}

// ─── Lobby actions ─────────────────────────────────────────
function toggleJoin() {
  const b = document.getElementById('join-box');
  b.style.display = b.style.display === 'none' ? 'block' : 'none';
}

function codeFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return String(Math.abs(h) % 900000 + 100000);
}

function doCreate() {
  const name = getName(); if (!name) return;
  G.name = name; G.isHost = true; G.role = 'hider';
  peer = new Peer(undefined, { debug: 0 });
  peer.on('open', id => {
    const code = codeFromId(id);
    document.getElementById('show-code').textContent = code;
    show('wait');
  });
  peer.on('connection', c => {
    conn = c; setupConn();
    setConnected(true, 'متصل ✓');
  });
  peer.on('error', e => showErr('خطأ: ' + e.type));
}

function doJoin() {
  const name = getName(); if (!name) return;
  const code = document.getElementById('inp-code').value.trim();
  if (code.length !== 6 || isNaN(code)) { showErr('الكود لازم يكون 6 أرقام'); return; }
  G.name = name; G.isHost = false; G.role = 'seeker';
  peer = new Peer(undefined, { debug: 0 });
  peer.on('open', () => {
    show('wait');
    document.getElementById('show-code').textContent = code;
    setConnected(false, 'جاري البحث...');
    findAndConnect(code);
  });
  peer.on('error', e => showErr('خطأ: ' + e.type));
}

function findAndConnect(code) {
  peer.listAllPeers(peers => {
    const target = peers.find(id => codeFromId(id) === code);
    if (!target) { showErr('لم يتم العثور على الغرفة، تأكد من الكود'); show('lobby'); return; }
    conn = peer.connect(target, { reliable: true });
    conn.on('open', () => {
      setupConn(); setConnected(true, 'متصل ✓');
      send({ t: 'join', name: G.name });
    });
    conn.on('error', () => showErr('فشل الاتصال'));
  });
}

function setupConn() {
  conn.on('data', d => handleMsg(d));
  conn.on('close', () => setConnected(false, 'انقطع الاتصال'));
}

function setConnected(on, txt) {
  document.getElementById('conn-dot').className = 'conn-dot' + (on ? ' on' : '');
  document.getElementById('conn-txt').textContent = txt;
}

function send(data) { if (conn && conn.open) conn.send(data); }

function copyCode() {
  const code = document.getElementById('show-code').textContent;
  navigator.clipboard.writeText(code).catch(() => {});
}

// ─── Map selection ──────────────────────────────────────────
let selMapIdx = 0;
function pickMap(idx, el) {
  selMapIdx = idx; G.mapIdx = idx;
  document.querySelectorAll('.mopt').forEach(e => e.classList.remove('sel'));
  el.classList.add('sel');
}

// ─── Messages ──────────────────────────────────────────────
function handleMsg(m) {
  if (m.t === 'join') {
    G.oppName = m.name;
    send({ t: 'joined', name: G.name, mapIdx: selMapIdx });
    setTimeout(() => startGame(), 400);
  } else if (m.t === 'joined') {
    G.oppName = m.name; G.mapIdx = m.mapIdx;
    setTimeout(() => startGame(), 400);
  } else if (m.t === 'chat') {
    addChat(m.from, m.text);
  } else if (m.t === 'hidden') {
    G.hidden = m.cell; G.phase = 'seeking';
    updateUI(); setStatus('الكنز اتخبى ✓ — دورك تبحث!');
    startTimer();
  } else if (m.t === 'guess') {
    handleGuess(m.cell, m.attempt);
  } else if (m.t === 'result') {
    applyResult(m.found, m.cell, m.pts, m.hidden, m.attempt);
  } else if (m.t === 'next') {
    G.role = m.myRole; G.hidden = null; G.selected = null; G.attempts = 3;
    G.phase = 'hiding';
    document.getElementById('end-overlay').style.display = 'none';
    buildMap(); updateUI(); startTimer();
  }
}

// ─── Game start ─────────────────────────────────────────────
function startGame() {
  show('game'); buildMap(); updateUI();
  if (G.role === 'hider') startTimer();
  else setStatus('في انتظار المنافس يخفي الكنز...');
}

function buildMap() {
  const m = MAPS[G.mapIdx];
  const g = document.getElementById('game-map');
  g.innerHTML = '';
  const cols = m.grid[0].length;
  g.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  m.grid.forEach((row, r) => row.forEach((type, c) => {
    const el = document.createElement('div');
    const cd = CELLS[type] || { i: '?', n: type };
    el.className = 'cell' + (type === 'road' ? ' road' : '');
    if (type !== 'road') {
      el.innerHTML = `<div class="cell-icon">${cd.i}</div><div class="cell-name">${cd.n}</div>`;
      el.dataset.key = `${r}_${c}`;
      el.onclick = () => cellClick(r, c, el);
    }
    g.appendChild(el);
  }));
}

function cellClick(r, c, el) {
  const key = `${r}_${c}`;
  document.querySelectorAll('.cell.selected').forEach(e => e.classList.remove('selected'));
  if (G.role === 'hider' && G.phase === 'hiding') {
    G.selected = key; el.classList.add('selected');
    document.getElementById('btn-hide').disabled = false;
  } else if (G.role === 'seeker' && G.phase === 'seeking' && G.attempts > 0) {
    G.selected = key; el.classList.add('selected');
    document.getElementById('btn-guess').disabled = false;
  }
}

// ─── Actions ────────────────────────────────────────────────
function confirmHide() {
  if (!G.selected) return;
  G.hidden = G.selected; G.phase = 'waiting';
  send({ t: 'hidden', cell: G.hidden });
  updateUI(); setStatus('تم إخفاء الكنز ✓ — في انتظار المنافس...');
  stopTimer();
}

function confirmGuess() {
  if (!G.selected || G.attempts <= 0) return;
  G.attempts--;
  const attempt = 3 - G.attempts;
  send({ t: 'guess', cell: G.selected, attempt });
  document.getElementById('btn-guess').disabled = true;
  updateDots();
  setStatus('في انتظار النتيجة...');
  G.selected = null;
  document.querySelectorAll('.cell.selected').forEach(e => e.classList.remove('selected'));
}

function handleGuess(guessCell, attempt) {
  const found = guessCell === G.hidden;
  let pts = 0;
  if (found) pts = attempt === 1 ? 20 : attempt === 2 ? 10 : 5;
  else markCell(guessCell, 'wrong');
  send({ t: 'result', found, cell: guessCell, pts, hidden: G.hidden, attempt });
  if (!found && attempt >= 3) {
    G.opScore += 20; updateScores();
    showEnd(false, false, 0);
  } else if (found) {
    showEnd(false, true, pts);
  }
}

function applyResult(found, guessCell, pts, hiddenCell, attempt) {
  if (!found) markCell(guessCell, 'wrong');
  if (found) {
    G.myScore += pts; updateScores();
    if (hiddenCell) markCell(hiddenCell, 'found');
    showEnd(true, true, pts);
  } else if (G.attempts <= 0) {
    if (hiddenCell) markCell(hiddenCell, 'found');
    showEnd(true, false, 0);
  } else {
    setStatus(`خطأ! ${G.attempts} محاولات باقية`);
    document.getElementById('btn-guess').disabled = false;
    updateBadge();
  }
  stopTimer();
}

function markCell(key, cls) {
  document.querySelectorAll(`[data-key="${key}"]`).forEach(el => {
    el.classList.add(cls); el.classList.remove('selected');
  });
}

function showEnd(isSeeker, found, pts) {
  stopTimer();
  const icon = document.getElementById('ov-icon');
  const title = document.getElementById('ov-title');
  const msg = document.getElementById('ov-msg');
  if (found) {
    icon.textContent = '🎉';
    title.textContent = isSeeker ? 'وجدت الكنز!' : 'اتكشفت!';
    msg.textContent = isSeeker ? `ربحت ${pts} نقطة!` : 'المنافس وجد الكنز';
  } else {
    icon.textContent = '😅';
    title.textContent = isSeeker ? 'لم تجد الكنز' : 'ربحت الجولة!';
    msg.textContent = isSeeker ? 'فشلت في إيجاد الكنز' : 'المنافس فشل — ربحت 20 نقطة!';
  }
  document.getElementById('end-overlay').style.display = 'flex';
  saveScore();
}

function nextRound() {
  const newRole = G.role === 'hider' ? 'seeker' : 'hider';
  send({ t: 'next', myRole: G.role });
  G.role = newRole; G.hidden = null; G.selected = null; G.attempts = 3;
  G.phase = 'hiding';
  document.getElementById('end-overlay').style.display = 'none';
  buildMap(); updateUI(); startTimer();
}

// ─── UI helpers ──────────────────────────────────────────────
function updateUI() {
  const rb = document.getElementById('role-banner');
  const hc = document.getElementById('hider-ctrl');
  const sc = document.getElementById('seeker-ctrl');
  const ar = document.getElementById('att-row');
  document.getElementById('my-lbl').textContent = G.name || 'أنا';
  document.getElementById('op-lbl').textContent = G.oppName;
  if (G.role === 'hider') {
    rb.className = 'role-banner role-hide';
    rb.textContent = '🎩 دورك: اخفي الكنز';
    hc.style.display = 'block'; sc.style.display = 'none'; ar.style.display = 'none';
  } else {
    rb.className = 'role-banner role-seek';
    rb.textContent = '🔍 دورك: ابحث عن الكنز';
    hc.style.display = 'none'; sc.style.display = 'block'; ar.style.display = 'flex';
    updateDots(); updateBadge();
  }
  updateScores();
}

function updateScores() {
  document.getElementById('my-sc').textContent = G.myScore;
  document.getElementById('op-sc').textContent = G.opScore;
}

function updateDots() {
  const dots = document.querySelectorAll('#att-dots .dot');
  const used = 3 - G.attempts;
  dots.forEach((d, i) => d.className = 'dot ' + (i < used ? 'used' : 'left'));
}

function updateBadge() {
  const used = 3 - G.attempts;
  const pts = [20, 10, 5];
  const b = document.getElementById('pts-badge');
  if (used < 3) { b.textContent = pts[used] + ' نقطة'; b.className = 'badge ' + (used === 0 ? 'bg' : used === 1 ? 'ba' : 'br'); }
}

function setStatus(txt) { document.getElementById('status-bar').textContent = txt; }

// ─── Timer ──────────────────────────────────────────────────
function startTimer() {
  G.timerV = 60; stopTimer();
  const el = document.getElementById('timer-el');
  G.timerI = setInterval(() => {
    G.timerV--;
    el.textContent = G.timerV;
    el.className = 'timer' + (G.timerV <= 15 ? ' warn' : '');
    if (G.timerV <= 0) {
      stopTimer();
      if (G.role === 'seeker' && G.phase === 'seeking') {
        markCell(G.hidden, 'found');
        showEnd(true, false, 0);
      }
    }
  }, 1000);
}
function stopTimer() { if (G.timerI) { clearInterval(G.timerI); G.timerI = null; } }

// ─── Chat ───────────────────────────────────────────────────
function sendChat() {
  const inp = document.getElementById('chat-inp');
  const txt = inp.value.trim(); if (!txt) return;
  addChat(G.name, txt);
  send({ t: 'chat', from: G.name, text: txt });
  inp.value = '';
}
function addChat(from, text) {
  const box = document.getElementById('chat-el');
  const el = document.createElement('div');
  el.className = 'chat-msg';
  el.innerHTML = `<span class="who">${from}:</span> ${text}`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

// ─── Leaderboard ────────────────────────────────────────────
function saveScore() {
  if (!G.name || G.myScore === 0) return;
  try {
    const lb = JSON.parse(localStorage.getItem('tlb') || '[]');
    const ex = lb.find(e => e.n === G.name);
    if (ex) { if (G.myScore > ex.s) ex.s = G.myScore; } else lb.push({ n: G.name, s: G.myScore });
    localStorage.setItem('tlb', JSON.stringify(lb));
    loadLB();
  } catch (e) {}
}
function loadLB() {
  try {
    const lb = JSON.parse(localStorage.getItem('tlb') || '[]').sort((a, b) => b.s - a.s).slice(0, 5);
    const tbody = document.getElementById('lb-body');
    if (!lb.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">لا يوجد بيانات بعد</td></tr>';
      return;
    }
    tbody.innerHTML = lb.map((e, i) => `<tr><td>${i + 1}</td><td>${e.n}</td><td>${e.s}</td></tr>`).join('');
  } catch (e) {}
}

loadLB();
