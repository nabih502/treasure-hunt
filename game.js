const SUPABASE_URL = 'https://uamhxhmrwcugoroeplln.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhbWh4aG1yd2N1Z29yb2VwbGxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2MzY3NzQsImV4cCI6MjA4MjIxMjc3NH0.IQ8G73Swnc8Q9VoQdi9TOj-fKYcKd2K50SuIXBuuR64';

const BTYPES = {
  HOSPITAL: { color: 0xffffff, accent: 0xef4444, nameAr: 'مستشفى الأمل' },
  SCHOOL:   { color: 0xfacc15, accent: 0x1e40af, nameAr: 'مدرسة النور' },
  FACTORY:  { color: 0x475569, accent: 0x1e293b, nameAr: 'مصنع الغد' },
  MALL:     { color: 0xec4899, accent: 0xbe185d, nameAr: 'مول الخليج' },
  MOSQUE:   { color: 0x10b981, accent: 0x065f46, nameAr: 'مسجد القرية' },
  TOWER:    { color: 0x334155, accent: 0x60a5fa, nameAr: 'برج سكني' },
  HOUSE:    { color: 0xf1f5f9, accent: 0x991b1b, nameAr: 'منزل سكني' },
};

// ─── Seeded random (Mulberry32) ───────────────────────────────
// بيضمن إن نفس الـ seed يطلع نفس المدينة عند المضيف والزائر
function makeRng(seed) {
  let s = seed >>> 0;
  return function() {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

let rng = Math.random; // افتراضي — هيتغير لما تيجي الـ seed

let sb = null, realtimeChannel = null;
let G = { name:'', role:'host', myScore:0, opScore:0, oppName:'؟', roomCode:'', hidden:null, selected:null, attempts:3, phase:'lobby', timerV:60, timerI:null, citySeed:0 };
let scene, camera, renderer, cityGroup, raycaster, mouse;
let selectableBuildings = [], cars = [];
let isMouseDown = false, targetRotX = 0.55, targetRotY = -0.4;
let lastMX = 0, lastMY = 0, highlightedMesh = null;

function initSB() { if (!sb) sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); }

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('s-' + id).classList.add('active');
  if (id === 'game') setTimeout(initThreeJS, 100);
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

function genCode() { return Math.floor(100000 + Math.random() * 900000).toString(); }
function copyCode() { navigator.clipboard.writeText(G.roomCode).catch(() => {}); }

async function doCreate() {
  const name = getName(); if (!name) return;
  initSB();
  G.name = name; G.role = 'host'; G.roomCode = genCode();
  // المضيف يولّد الـ seed وبيحفظه في قاعدة البيانات
  G.citySeed = Math.floor(Math.random() * 2147483647);
  const { error } = await sb.from('game_rooms').insert({
    code: G.roomCode, host_name: name, status: 'waiting', map_idx: G.citySeed, phase: 'hiding'
  });
  if (error) { showErr('خطأ في إنشاء الغرفة'); return; }
  document.getElementById('show-code').textContent = G.roomCode;
  show('wait');
  subscribeToRoom(G.roomCode);
  setConnected(false, 'في انتظار الزائر...');
}

async function doJoin() {
  const name = getName(); if (!name) return;
  const code = document.getElementById('inp-code').value.trim();
  if (code.length !== 6 || isNaN(code)) { showErr('6 أرقام'); return; }
  initSB();
  G.name = name; G.role = 'guest'; G.roomCode = code;
  const { data, error } = await sb.from('game_rooms').select('*').eq('code', code).eq('status', 'waiting').single();
  if (error || !data) { showErr('الغرفة مش موجودة'); return; }
  G.oppName = data.host_name;
  // الزائر بياخد نفس الـ seed من قاعدة البيانات
  G.citySeed = data.map_idx || 1;
  await sb.from('game_rooms').update({ guest_name: name, status: 'playing' }).eq('code', code);
  document.getElementById('show-code').textContent = code;
  show('wait');
  subscribeToRoom(code);
  setConnected(true, 'متصل ✓');
  await sendEvent({ t: 'guest_joined', name: G.name, seed: G.citySeed });
  setTimeout(() => startGame(), 400);
}

function subscribeToRoom(code) {
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel('room_' + code)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_events', filter: 'room_code=eq.' + code },
      ({ new: row }) => { if (row.sender !== G.name) handleMsg(row.event_type, row.payload || {}); })
    .subscribe();
}

async function sendEvent(payload) {
  const { t, ...rest } = payload;
  await sb.from('game_events').insert({ room_code: G.roomCode, sender: G.name, event_type: t, payload: rest });
}

function handleMsg(type, data) {
  if (type === 'guest_joined') {
    G.oppName = data.name;
    setConnected(true, 'الزائر اتصل ✓');
    setTimeout(() => startGame(), 300);
  } else if (type === 'start_search') {
    G.hidden = data.cell; G.phase = 'seeking';
    updateUI();
    setStatus('المضيف أخفى الكنز — دورك تبحث! اضغط على مبنى');
    document.getElementById('seeker-ctrl').style.display = 'block';
    document.getElementById('hider-ctrl').style.display = 'none';
    document.getElementById('att-row').style.display = 'flex';
    updateDots(); updateBadge(); startTimer();
  } else if (type === 'guess') {
    handleGuess(data.cell, data.attempt);
  } else if (type === 'result') {
    applyResult(data.found, data.cell, data.pts, data.hidden, data.attempt);
  } else if (type === 'next_round') {
    startNextRound(data);
  } else if (type === 'chat') {
    addChat(data.from, data.text);
  }
}

function startGame() {
  show('game');
  if (G.role === 'host') {
    G.phase = 'hiding'; updateUI();
    setStatus('اختر مبنى من المدينة واضغط تأكيد الإخفاء');
  } else {
    G.phase = 'waiting_host'; updateUI();
    setStatus('في انتظار المضيف...');
  }
}

async function confirmHide() {
  if (!G.selected) return;
  G.hidden = G.selected; G.phase = 'ready_to_search'; updateUI();
  const b = selectableBuildings.find(x => x.id === G.selected);
  if (b) { b.mesh.material.color.setHex(0xffd700); b.grp.userData.marked = true; }
  setStatus('تم تحديد: ' + (b ? b.nameAr : '') + ' — اضغط ابدأ البحث');
  document.getElementById('btn-hide').disabled = true;
  document.getElementById('btn-start-search').style.display = 'block';
}

async function startSearch() {
  if (!G.hidden) return;
  await sendEvent({ t: 'start_search', cell: G.hidden });
  G.phase = 'host_waiting'; updateUI();
  setStatus('الزائر بيبحث... انتظر');
  document.getElementById('btn-start-search').style.display = 'none';
  document.getElementById('hider-ctrl').style.display = 'none';
}

async function confirmGuess() {
  if (!G.selected || G.attempts <= 0) return;
  G.attempts--;
  const attempt = 3 - G.attempts;
  await sendEvent({ t: 'guess', cell: G.selected, attempt });
  document.getElementById('btn-guess').disabled = true;
  updateDots();
  setStatus('في انتظار النتيجة...');
  G.selected = null;
}

async function handleGuess(guessCell, attempt) {
  const found = guessCell === G.hidden;
  let pts = 0;
  if (found) pts = attempt === 1 ? 20 : attempt === 2 ? 10 : 5;
  else markBuilding(guessCell, 'wrong');
  await sendEvent({ t: 'result', found, cell: guessCell, pts, hidden: G.hidden, attempt });
  if (!found && attempt >= 3) { G.opScore += 20; updateScores(); showEnd(false, false, 0); }
  else if (found) showEnd(false, true, pts);
}

function applyResult(found, guessCell, pts, hiddenCell, attempt) {
  if (!found) markBuilding(guessCell, 'wrong');
  if (found) {
    G.myScore += pts; updateScores();
    if (hiddenCell) markBuilding(hiddenCell, 'found');
    showEnd(true, true, pts);
  } else if (G.attempts <= 0) {
    if (hiddenCell) markBuilding(hiddenCell, 'found');
    showEnd(true, false, 0);
  } else {
    setStatus('خطأ! ' + G.attempts + ' محاولات باقية');
    document.getElementById('btn-guess').disabled = false;
    updateBadge();
  }
  stopTimer();
}

function showEnd(isSeeker, found, pts) {
  stopTimer();
  const isGuest = G.role === 'guest';
  document.getElementById('ov-icon').textContent = found ? '🎉' : '😅';
  document.getElementById('ov-title').textContent = found
    ? (isGuest ? 'وجدت الكنز!' : 'الزائر وجد الكنز')
    : (isGuest ? 'لم تجد الكنز' : 'ربحت الجولة!');
  document.getElementById('ov-msg').textContent = found
    ? (isGuest ? 'ربحت ' + pts + ' نقطة!' : 'الزائر اكتشف المخبأ')
    : (isGuest ? 'فشلت في إيجاد الكنز' : 'الزائر فشل — ربحت 20 نقطة!');
  document.getElementById('end-overlay').style.display = 'flex';
  saveScore();
}

async function nextRound() {
  // seed جديد للجولة الجديدة
  const newSeed = Math.floor(Math.random() * 2147483647);
  G.citySeed = newSeed;
  await sendEvent({ t: 'next_round', newSeed, newHostRole: G.role === 'host' ? 'guest' : 'host' });
  applyNextRound(G.role === 'host' ? 'guest' : 'host', newSeed);
}

function startNextRound(data) {
  const newSeed = data.newSeed || G.citySeed;
  G.citySeed = newSeed;
  applyNextRound(G.role === 'host' ? 'guest' : 'host', newSeed);
}

function applyNextRound(newRole, newSeed) {
  G.role = newRole;
  G.hidden = null; G.selected = null; G.attempts = 3;
  G.phase = newRole === 'host' ? 'hiding' : 'waiting_host';
  document.getElementById('end-overlay').style.display = 'none';
  document.getElementById('btn-start-search').style.display = 'none';
  document.getElementById('btn-hide').disabled = true;
  // يولّد المدينة بالـ seed الجديد
  if (newSeed) G.citySeed = newSeed;
  rng = makeRng(G.citySeed);
  resetBuildingColors();
  generateCity();
  updateUI();
  if (G.role === 'host') setStatus('دورك تخفي الكنز — اختر مبنى');
  else setStatus('في انتظار المضيف...');
}

function updateUI() {
  const rb = document.getElementById('role-banner');
  document.getElementById('my-lbl').textContent = G.name || 'أنا';
  document.getElementById('op-lbl').textContent = G.oppName;
  document.getElementById('hider-ctrl').style.display = 'none';
  document.getElementById('seeker-ctrl').style.display = 'none';
  document.getElementById('att-row').style.display = 'none';
  document.getElementById('btn-start-search').style.display = 'none';
  if (G.role === 'host') {
    rb.className = 'role-banner role-hide';
    rb.textContent = '🏠 أنت المضيف — دورك الإخفاء';
    if (G.phase === 'hiding') document.getElementById('hider-ctrl').style.display = 'block';
  } else {
    rb.className = 'role-banner role-seek';
    rb.textContent = '🚶 أنت الزائر — دورك البحث';
    if (G.phase === 'seeking') {
      document.getElementById('seeker-ctrl').style.display = 'block';
      document.getElementById('att-row').style.display = 'flex';
      updateDots(); updateBadge();
    }
  }
  updateScores();
}

function updateScores() { document.getElementById('my-sc').textContent = G.myScore; document.getElementById('op-sc').textContent = G.opScore; }
function updateDots() { const u = 3 - G.attempts; document.querySelectorAll('#att-dots .dot').forEach((d, i) => d.className = 'dot ' + (i < u ? 'used' : 'left')); }
function updateBadge() { const u = 3 - G.attempts; const b = document.getElementById('pts-badge'); b.textContent = [20, 10, 5][u] + ' نقطة'; b.className = 'badge ' + (u === 0 ? 'bg' : u === 1 ? 'ba' : 'br'); }
function setStatus(txt) { const el = document.getElementById('status-bar'); if (el) el.textContent = txt; }
function setConnected(on, txt) { document.getElementById('conn-dot').className = 'conn-dot' + (on ? ' on' : ''); document.getElementById('conn-txt').textContent = txt; }

function startTimer() {
  G.timerV = 60; stopTimer();
  const el = document.getElementById('timer-el');
  G.timerI = setInterval(() => {
    G.timerV--; el.textContent = G.timerV;
    el.className = 'timer' + (G.timerV <= 15 ? ' warn' : '');
    if (G.timerV <= 0) { stopTimer(); if (G.role === 'guest' && G.phase === 'seeking') { if (G.hidden) markBuilding(G.hidden, 'found'); showEnd(true, false, 0); } }
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
  const el = document.createElement('div'); el.className = 'chat-msg';
  el.innerHTML = '<span class="who">' + from + ':</span> ' + text;
  box.appendChild(el); box.scrollTop = box.scrollHeight;
}

async function saveScore() {
  if (!G.name || G.myScore === 0) return;
  await sb.from('leaderboard').upsert({ player_name: G.name, score: G.myScore, updated_at: new Date().toISOString() }, { onConflict: 'player_name' });
  loadLB();
}
async function loadLB() {
  initSB();
  const { data } = await sb.from('leaderboard').select('player_name,score').order('score', { ascending: false }).limit(5);
  const tbody = document.getElementById('lb-body');
  if (!data || !data.length) { tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">لا يوجد بيانات بعد</td></tr>'; return; }
  tbody.innerHTML = data.map((e, i) => '<tr><td>' + (i + 1) + '</td><td>' + e.player_name + '</td><td>' + e.score + '</td></tr>').join('');
}

function initThreeJS() {
  const container = document.getElementById('city-canvas');
  if (!container || container.querySelector('canvas')) return;
  if (!window.THREE) { return setTimeout(initThreeJS, 500); }
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);
  scene.fog = new THREE.Fog(0x0f172a, 250, 700);
  camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 1, 2000);
  camera.position.set(130, 110, 130); camera.lookAt(0, 0, 0);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const sun = new THREE.DirectionalLight(0xfff7ed, 1.2);
  sun.position.set(200, 400, 100); sun.castShadow = true; scene.add(sun);
  raycaster = new THREE.Raycaster(); mouse = new THREE.Vector2();
  cityGroup = new THREE.Group(); scene.add(cityGroup);
  // استخدم الـ seed المحفوظ لتوليد المدينة
  rng = makeRng(G.citySeed || 42);
  generateCity();
  setupCityInteraction(container);
  animateCity();
  window.addEventListener('resize', () => {
    if (!container || !renderer) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}

function generateCity() {
  selectableBuildings = []; cars = [];
  while (cityGroup.children.length > 0) cityGroup.remove(cityGroup.children[0]);
  const size = 200, grid = 50;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x14532d }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; cityGroup.add(ground);
  for (let i = -size; i <= size; i += grid) {
    addRoad(new THREE.Vector3(0, 0.02, i), size * 2, 14, true);
    addRoad(new THREE.Vector3(i, 0.02, 0), size * 2, 14, false);
  }
  let idx = 0;
  for (let x = -size + grid / 2; x < size; x += grid) {
    for (let z = -size + grid / 2; z < size; z += grid) {
      const r = rng(); // seeded random بدل Math.random
      const id = 'b' + idx++;
      if (r < 0.09) addSpecial(x, z, grid * 0.75, BTYPES.HOSPITAL, id);
      else if (r < 0.18) addSpecial(x, z, grid * 0.75, BTYPES.SCHOOL, id);
      else if (r < 0.27) addSpecial(x, z, grid * 0.8, BTYPES.FACTORY, id);
      else if (r < 0.36) addSpecial(x, z, grid * 0.75, BTYPES.MALL, id);
      else if (r < 0.44) addSpecial(x, z, grid * 0.7, BTYPES.MOSQUE, id);
      else if (r < 0.68) addTower(x, z, grid * 0.6, id);
      else addHouses(x, z, grid * 0.7, id);
    }
  }
}

function addRoad(pos, length, width, isH) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(isH ? length : width, isH ? width : length), new THREE.MeshStandardMaterial({ color: 0x1e293b }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.copy(pos); mesh.receiveShadow = true; cityGroup.add(mesh);
  for (let i = 0; i < 2; i++) spawnCar(pos, isH);
}

function addSpecial(x, z, size, type, id) {
  const h = type === BTYPES.FACTORY ? 14 : 20;
  const grp = new THREE.Group();
  grp.userData = { id, nameAr: type.nameAr, origColor: type.color, marked: false };
  const mat = new THREE.MeshStandardMaterial({ color: type.color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(size, h, size), mat);
  body.position.y = h / 2; body.castShadow = true; body.userData = { selId: id }; grp.add(body);
  selectableBuildings.push({ mesh: body, id, nameAr: type.nameAr, grp });
  const acc = new THREE.Mesh(new THREE.BoxGeometry(size + 0.5, 2, size + 0.5), new THREE.MeshStandardMaterial({ color: type.accent }));
  acc.position.y = h - 1; grp.add(acc);
  if (type === BTYPES.FACTORY) {
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2, 8), new THREE.MeshStandardMaterial({ color: 0x334155 }));
    ch.position.set(size / 3, h + 4, size / 3); grp.add(ch);
  }
  if (type === BTYPES.MOSQUE) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(size / 4, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffd700 }));
    dome.position.set(0, h + size / 4, 0); grp.add(dome);
  }
  grp.position.set(x, 0, z); cityGroup.add(grp);
}

function addTower(x, z, size, id) {
  const h = 40 + rng() * 80; // seeded
  const grp = new THREE.Group();
  grp.userData = { id, nameAr: 'برج سكني', origColor: 0x334155, marked: false };
  const mat = new THREE.MeshStandardMaterial({ color: 0x334155 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(size, h, size), mat);
  body.position.y = h / 2; body.castShadow = true; body.userData = { selId: id }; grp.add(body);
  selectableBuildings.push({ mesh: body, id, nameAr: 'برج سكني', grp });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(size + 0.2, h * 0.9, size + 0.2), new THREE.MeshPhysicalMaterial({ color: 0x60a5fa, transmission: 0.3, thickness: 1 }));
  glass.position.y = h / 2; grp.add(glass);
  grp.position.set(x, 0, z); cityGroup.add(grp);
}

function addHouses(x, z, size, baseId) {
  const sub = size / 2.5; let i = 0;
  for (let a = -1; a <= 1; a += 2) {
    for (let b2 = -1; b2 <= 1; b2 += 2) {
      const hx = x + a * sub, hz = z + b2 * sub;
      const h = 6 + rng() * 4; // seeded
      const id = baseId + '_' + i++;
      const grp = new THREE.Group();
      grp.userData = { id, nameAr: 'منزل سكني', origColor: 0xf1f5f9, marked: false };
      const mat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9 });
      const house = new THREE.Mesh(new THREE.BoxGeometry(8, h, 8), mat);
      house.position.y = h / 2; house.castShadow = true; house.userData = { selId: id }; grp.add(house);
      selectableBuildings.push({ mesh: house, id, nameAr: 'منزل سكني', grp });
      const roof = new THREE.Mesh(new THREE.BoxGeometry(9, 1, 9), new THREE.MeshStandardMaterial({ color: 0x991b1b }));
      roof.position.y = h; grp.add(roof);
      grp.position.set(hx, 0, hz); cityGroup.add(grp);
    }
  }
}

function spawnCar(pos, isH) {
  const grp = new THREE.Group();
  const col = [0x3b82f6, 0xef4444, 0x10b981, 0xffffff][Math.floor(Math.random() * 4)];
  grp.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 3), new THREE.MeshStandardMaterial({ color: col })));
  const lane = Math.random() > 0.5 ? 3.5 : -3.5;
  if (isH) { grp.position.set((Math.random() - 0.5) * 400, 0.6, pos.z + lane); grp.rotation.y = Math.PI / 2; }
  else { grp.position.set(pos.x + lane, 0.6, (Math.random() - 0.5) * 400); }
  cars.push({ mesh: grp, horizontal: isH, speed: (0.3 + Math.random() * 0.4) * (lane > 0 ? 1 : -1) });
  cityGroup.add(grp);
}

function setupCityInteraction(container) {
  container.addEventListener('mousedown', e => { isMouseDown = true; lastMX = e.clientX; lastMY = e.clientY; });
  container.addEventListener('mouseup', e => {
    if (Math.abs(e.clientX - lastMX) < 6 && Math.abs(e.clientY - lastMY) < 6) onCityClick(e, container);
    isMouseDown = false;
  });
  container.addEventListener('mousemove', e => {
    if (isMouseDown) { targetRotY += e.movementX * 0.005; targetRotX += e.movementY * 0.005; }
    else onCityHover(e, container);
  });
  container.addEventListener('wheel', e => {
    camera.position.multiplyScalar(1 + e.deltaY * 0.001);
    const d = camera.position.length();
    if (d < 40) camera.position.normalize().multiplyScalar(40);
    if (d > 500) camera.position.normalize().multiplyScalar(500);
  });
  let lTX = 0, lTY = 0, tS = 0;
  container.addEventListener('touchstart', e => { lTX = e.touches[0].clientX; lTY = e.touches[0].clientY; tS = Date.now(); });
  container.addEventListener('touchmove', e => {
    targetRotY += (e.touches[0].clientX - lTX) * 0.005;
    targetRotX += (e.touches[0].clientY - lTY) * 0.005;
    lTX = e.touches[0].clientX; lTY = e.touches[0].clientY; e.preventDefault();
  }, { passive: false });
  container.addEventListener('touchend', e => { if (Date.now() - tS < 250) onCityClick(e.changedTouches[0], container); });
}

function getHit(event, container) {
  const rect = container.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(selectableBuildings.map(b => b.mesh));
  if (hits.length) return selectableBuildings.find(b => b.mesh === hits[0].object);
  return null;
}

function onCityHover(event, container) {
  const b = getHit(event, container);
  if (highlightedMesh) {
    const prev = selectableBuildings.find(x => x.mesh === highlightedMesh);
    if (prev && !prev.grp.userData.marked && prev.id !== G.selected)
      highlightedMesh.material.color.setHex(prev.grp.userData.origColor);
    highlightedMesh = null;
  }
  if (b && !b.grp.userData.marked) {
    b.mesh.material.color.setHex(0xffd700);
    highlightedMesh = b.mesh;
    container.style.cursor = 'pointer';
  } else container.style.cursor = 'grab';
}

function onCityClick(event, container) {
  const b = getHit(event, container); if (!b) return;
  const canHide = G.role === 'host' && G.phase === 'hiding';
  const canGuess = G.role === 'guest' && G.phase === 'seeking' && G.attempts > 0;
  if (!canHide && !canGuess) return;
  if (G.selected && G.selected !== b.id) {
    const prev = selectableBuildings.find(x => x.id === G.selected);
    if (prev && !prev.grp.userData.marked) prev.mesh.material.color.setHex(prev.grp.userData.origColor);
  }
  G.selected = b.id;
  b.mesh.material.color.setHex(0x00ff88);
  setStatus('اخترت: ' + b.nameAr);
  if (canHide) document.getElementById('btn-hide').disabled = false;
  else document.getElementById('btn-guess').disabled = false;
}

function markBuilding(id, state) {
  const b = selectableBuildings.find(x => x.id === id); if (!b) return;
  b.grp.userData.marked = true;
  b.mesh.material.color.setHex(state === 'found' ? 0xfac775 : 0xe24b4a);
}

function resetBuildingColors() {
  selectableBuildings.forEach(b => { b.grp.userData.marked = false; b.mesh.material.color.setHex(b.grp.userData.origColor); });
  G.selected = null;
}

function animateCity() {
  requestAnimationFrame(animateCity);
  if (!renderer || !scene || !camera) return;
  cityGroup.rotation.y += (targetRotY - cityGroup.rotation.y) * 0.08;
  cityGroup.rotation.x += (targetRotX - cityGroup.rotation.x) * 0.08;
  cityGroup.rotation.x = Math.max(0.05, Math.min(cityGroup.rotation.x, 1.2));
  cars.forEach(c => {
    if (c.horizontal) { c.mesh.position.x += c.speed; if (Math.abs(c.mesh.position.x) > 300) c.mesh.position.x *= -1; }
    else { c.mesh.position.z += c.speed; if (Math.abs(c.mesh.position.z) > 300) c.mesh.position.z *= -1; }
  });
  renderer.render(scene, camera);
}

loadLB();
