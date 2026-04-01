const SUPABASE_URL = 'https://uamhxhmrwcugoroeplln.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhbWh4aG1yd2N1Z29yb2VwbGxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2MzY3NzQsImV4cCI6MjA4MjIxMjc3NH0.IQ8G73Swnc8Q9VoQdi9TOj-fKYcKd2K50SuIXBuuR64';

const MAPS = [
  { name: 'مدينة النور', grid: [
    ['school','road','hospital','road','pharmacy'],
    ['road','road','road','road','road'],
    ['house1','road','market','road','house2'],
    ['road','road','road','road','road'],
    ['factory','road','park','road','apartment']
  ]},
  { name: 'قرية الخضراء', grid: [
    ['farm1','road','farm2','road','well'],
    ['road','road','road','road','road'],
    ['barn','road','mosque','road','house3'],
    ['road','road','road','road','road'],
    ['garden','road','school2','road','clinic']
  ]},
  { name: 'المنطقة الصناعية', grid: [
    ['factory1','road','factory2','road','warehouse1'],
    ['road','road','road','road','road'],
    ['office','road','powerplant','road','warehouse2'],
    ['road','road','road','road','road'],
    ['garage','road','lab','road','security']
  ]}
];

const CELLS = {
  school:{i:'🏫',n:'مدرسة النور'}, hospital:{i:'🏥',n:'مستشفى الأمل'}, pharmacy:{i:'💊',n:'صيدلية الشفاء'},
  house1:{i:'🏠',n:'منزل الورود'}, market:{i:'🏪',n:'سوق الخير'}, house2:{i:'🏡',n:'فيلا السلام'},
  factory:{i:'🏭',n:'مصنع الغد'}, park:{i:'🌳',n:'حديقة النزهة'}, apartment:{i:'🏢',n:'عمارة النيل'},
  farm1:{i:'🌾',n:'مزرعة الأمل'}, farm2:{i:'🌻',n:'مزرعة السلام'}, well:{i:'💧',n:'بئر القرية'},
  barn:{i:'🐄',n:'حظيرة الحيوانات'}, mosque:{i:'🕌',n:'مسجد القرية'}, house3:{i:'🏘️',n:'بيت الريف'},
  garden:{i:'🌿',n:'بستان الزيتون'}, school2:{i:'📚',n:'مدرسة الريف'}, clinic:{i:'🩺',n:'عيادة القرية'},
  factory1:{i:'🏭',n:'مصنع الصلب'}, factory2:{i:'⚙️',n:'مصنع الكيماويات'}, warehouse1:{i:'📦',n:'مستودع أ'},
  office:{i:'🏢',n:'المكتب الرئيسي'}, powerplant:{i:'⚡',n:'محطة الكهرباء'}, warehouse2:{i:'🗄️',n:'مستودع ب'},
  garage:{i:'🔧',n:'ورشة الإصلاح'}, lab:{i:'🔬',n:'المعمل'}, security:{i:'🛡️',n:'مركز الأمن'},
  road:{i:'',n:'طريق'}
};

let sb = null, realtimeChannel = null;
let G = {
  name:'', isHost:false, role:'hider', mapIdx:0,
  myScore:0, opScore:0, oppName:'؟', roomCode:'',
  hidden:null, selected:null, attempts:3,
  phase:'lobby', timerV:60, timerI:null
};

function initSB() {
  if (!sb) sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

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
function toggleJoin() {
  const b = document.getElementById('join-box');
  b.style.display = b.style.display === 'none' ? 'block' : 'none';
}
function genCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function doCreate() {
  const name = getName(); if (!name) return;
  initSB();
  G.name = name; G.isHost = true; G.role = 'hider';
  G.roomCode = genCode();
  const { error } = await sb.from('game_rooms').insert({
    code: G.roomCode, host_name: name, status: 'waiting', map_idx: 0
  });
  if (error) { showErr('خطأ في إنشاء الغرفة'); return; }
  document.getElementById('show-code').textContent = G.roomCode;
  show('wait');
  subscribeToRoom(G.roomCode);
  setConnected(false, 'في انتظار اللاعب الثاني...');
}

async function doJoin() {
  const name = getName(); if (!name) return;
  const code = document.getElementById('inp-code').value.trim();
  if (code.length !== 6 || isNaN(code)) { showErr('الكود لازم يكون 6 أرقام'); return; }
  initSB();
  G.name = name; G.isHost = false; G.role = 'seeker'; G.roomCode = code;
  const { data, error } = await sb.from('game_rooms')
    .select('*').eq('code', code).eq('status', 'waiting').single();
  if (error || !data) { showErr('الغرفة مش موجودة أو امتلأت'); return; }
  G.oppName = data.host_name;
  G.mapIdx = data.map_idx || 0;
  await sb.from('game_rooms').update({ guest_name: name, status: 'playing' }).eq('code', code);
  document.getElementById('show-code').textContent = code;
  show('wait');
  subscribeToRoom(code);
  setConnected(true, 'متصل ✓');
  await sendEvent({ t: 'join', name: G.name, mapIdx: G.mapIdx });
  setTimeout(() => startGame(), 400);
}

function subscribeToRoom(code) {
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel('room_' + code)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'game_events',
      filter: `room_code=eq.${code}`
    }, ({ new: row }) => {
      if (row.sender !== G.name) handleMsg(row.event_type, row.payload || {});
    })
    .subscribe();
}

async function sendEvent(payload) {
  const { t, ...rest } = payload;
  await sb.from('game_events').insert({
    room_code: G.roomCode, sender: G.name, event_type: t, payload: rest
  });
}

function handleMsg(type, data) {
  if (type === 'join') {
    G.oppName = data.name;
    G.mapIdx = data.mapIdx !== undefined ? data.mapIdx : selMapIdx;
    setConnected(true, 'متصل ✓');
    setTimeout(() => startGame(), 300);
  } else if (type === 'chat') {
    addChat(data.from, data.text);
  } else if (type === 'hidden') {
    G.hidden = data.cell; G.phase = 'seeking';
    updateUI(); setStatus('الكنز اتخبى ✓ — دورك تبحث!');
    startTimer();
  } else if (type === 'guess') {
    handleGuess(data.cell, data.attempt);
  } else if (type === 'result') {
    applyResult(data.found, data.cell, data.pts, data.hidden, data.attempt);
  } else if (type === 'next') {
    G.role = data.senderRole === 'hider' ? 'seeker' : 'hider';
    G.hidden = null; G.selected = null; G.attempts = 3; G.phase = 'hiding';
    document.getElementById('end-overlay').style.display = 'none';
    buildMap(); updateUI(); startTimer();
  }
}

let selMapIdx = 0;
function pickMap(idx, el) {
  selMapIdx = idx; G.mapIdx = idx;
  if (sb && G.roomCode) sb.from('game_rooms').update({ map_idx: idx }).eq('code', G.roomCode);
  document.querySelectorAll('.mopt').forEach(e => e.classList.remove('sel'));
  el.classList.add('sel');
}

function setConnected(on, txt) {
  document.getElementById('conn-dot').className = 'conn-dot' + (on ? ' on' : '');
  document.getElementById('conn-txt').textContent = txt;
}
function copyCode() { navigator.clipboard.writeText(G.roomCode).catch(() => {}); }

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

async function confirmHide() {
  if (!G.selected) return;
  G.hidden = G.selected; G.phase = 'waiting';
  await sendEvent({ t: 'hidden', cell: G.hidden });
  updateUI(); setStatus('تم إخفاء الكنز ✓ — في انتظار المنافس...'); stopTimer();
}

async function confirmGuess() {
  if (!G.selected || G.attempts <= 0) return;
  G.attempts--;
  const attempt = 3 - G.attempts;
  await sendEvent({ t: 'guess', cell: G.selected, attempt });
  document.getElementById('btn-guess').disabled = true;
  updateDots(); setStatus('في انتظار النتيجة...');
  G.selected = null;
  document.querySelectorAll('.cell.selected').forEach(e => e.classList.remove('selected'));
}

async function handleGuess(guessCell, attempt) {
  const found = guessCell === G.hidden;
  let pts = 0;
  if (found) pts = attempt === 1 ? 20 : attempt === 2 ? 10 : 5;
  else markCell(guessCell, 'wrong');
  await sendEvent({ t: 'result', found, cell: guessCell, pts, hidden: G.hidden, attempt });
  if (!found && attempt >= 3) { G.opScore += 20; updateScores(); showEnd(false, false, 0); }
  else if (found) { showEnd(false, true, pts); }
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
    document.getElementById('btn-guess').disabled = false; updateBadge();
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
  document.getElementById('ov-icon').textContent = found ? '🎉' : '😅';
  document.getElementById('ov-title').textContent = found
    ? (isSeeker ? 'وجدت الكنز!' : 'اتكشفت!')
    : (isSeeker ? 'لم تجد الكنز' : 'ربحت الجولة!');
  document.getElementById('ov-msg').textContent = found
    ? (isSeeker ? `ربحت ${pts} نقطة!` : 'المنافس وجد الكنز')
    : (isSeeker ? 'فشلت في إيجاد الكنز' : 'المنافس فشل — ربحت 20 نقطة!');
  document.getElementById('end-overlay').style.display = 'flex';
  saveScore();
}

async function nextRound() {
  await sendEvent({ t: 'next', senderRole: G.role });
  G.role = G.role === 'hider' ? 'seeker' : 'hider';
  G.hidden = null; G.selected = null; G.attempts = 3; G.phase = 'hiding';
  document.getElementById('end-overlay').style.display = 'none';
  buildMap(); updateUI(); startTimer();
}

function updateUI() {
  const rb = document.getElementById('role-banner');
  document.getElementById('my-lbl').textContent = G.name || 'أنا';
  document.getElementById('op-lbl').textContent = G.oppName;
  if (G.role === 'hider') {
    rb.className = 'role-banner role-hide'; rb.textContent = '🎩 دورك: اخفي الكنز';
    document.getElementById('hider-ctrl').style.display = 'block';
    document.getElementById('seeker-ctrl').style.display = 'none';
    document.getElementById('att-row').style.display = 'none';
  } else {
    rb.className = 'role-banner role-seek'; rb.textContent = '🔍 دورك: ابحث عن الكنز';
    document.getElementById('hider-ctrl').style.display = 'none';
    document.getElementById('seeker-ctrl').style.display = 'block';
    document.getElementById('att-row').style.display = 'flex';
    updateDots(); updateBadge();
  }
  updateScores();
}

function updateScores() {
  document.getElementById('my-sc').textContent = G.myScore;
  document.getElementById('op-sc').textContent = G.opScore;
}
function updateDots() {
  const used = 3 - G.attempts;
  document.querySelectorAll('#att-dots .dot').forEach((d, i) =>
    d.className = 'dot ' + (i < used ? 'used' : 'left'));
}
function updateBadge() {
  const used = 3 - G.attempts;
  const b = document.getElementById('pts-badge');
  b.textContent = [20,10,5][used] + ' نقطة';
  b.className = 'badge ' + (used===0?'bg':used===1?'ba':'br');
}
function setStatus(txt) { document.getElementById('status-bar').textContent = txt; }

function startTimer() {
  G.timerV = 60; stopTimer();
  const el = document.getElementById('timer-el');
  G.timerI = setInterval(() => {
    G.timerV--; el.textContent = G.timerV;
    el.className = 'timer' + (G.timerV <= 15 ? ' warn' : '');
    if (G.timerV <= 0) {
      stopTimer();
      if (G.role === 'seeker' && G.phase === 'seeking') { markCell(G.hidden,'found'); showEnd(true,false,0); }
    }
  }, 1000);
}
function stopTimer() { if (G.timerI) { clearInterval(G.timerI); G.timerI = null; } }

async function sendChat() {
  const inp = document.getElementById('chat-inp');
  const txt = inp.value.trim(); if (!txt) return;
  addChat(G.name, txt);
  await sendEvent({ t: 'chat', from: G.name, text: txt });
  inp.value = '';
}
function addChat(from, text) {
  const box = document.getElementById('chat-el');
  const el = document.createElement('div');
  el.className = 'chat-msg';
  el.innerHTML = `<span class="who">${from}:</span> ${text}`;
  box.appendChild(el); box.scrollTop = box.scrollHeight;
}

async function saveScore() {
  if (!G.name || G.myScore === 0) return;
  await sb.from('leaderboard').upsert(
    { player_name: G.name, score: G.myScore, updated_at: new Date().toISOString() },
    { onConflict: 'player_name' }
  );
  loadLB();
}

async function loadLB() {
  initSB();
  const { data } = await sb.from('leaderboard')
    .select('player_name, score').order('score', { ascending: false }).limit(5);
  const tbody = document.getElementById('lb-body');
  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">لا يوجد بيانات بعد</td></tr>'; return;
  }
  tbody.innerHTML = data.map((e, i) =>
    `<tr><td>${i+1}</td><td>${e.player_name}</td><td>${e.score}</td></tr>`).join('');
}

loadLB();
