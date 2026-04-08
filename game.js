const SUPABASE_URL='https://uamhxhmrwcugoroeplln.supabase.co';
const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhbWh4aG1yd2N1Z29yb2VwbGxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2MzY3NzQsImV4cCI6MjA4MjIxMjc3NH0.IQ8G73Swnc8Q9VoQdi9TOj-fKYcKd2K50SuIXBuuR64';

const BTYPES={
  HOSPITAL:{color:0xffffff,accent:0xef4444,nameAr:'مستشفى الأمل',desc:'مبنى أبيض طويل',colorName:'أبيض',street:'شارع الصحة'},
  SCHOOL:{color:0xfacc15,accent:0x1e40af,nameAr:'مدرسة النور',desc:'مبنى أصفر',colorName:'أصفر',street:'شارع التعليم'},
  FACTORY:{color:0x475569,accent:0x1e293b,nameAr:'مصنع الغد',desc:'مبنى رمادي بمدخنة',colorName:'رمادي',street:'شارع الصناعة'},
  MALL:{color:0xec4899,accent:0xbe185d,nameAr:'مول الخليج',desc:'مبنى وردي لامع',colorName:'وردي',street:'شارع التجارة'},
  MOSQUE:{color:0x10b981,accent:0x065f46,nameAr:'مسجد القرية',desc:'مبنى أخضر بقبة ذهبية',colorName:'أخضر',street:'شارع المسجد'},
  TOWER:{color:0x334155,accent:0x60a5fa,nameAr:'برج سكني',desc:'برج زجاجي شاهق',colorName:'رمادي زجاجي',street:'شارع الأبراج'},
  HOUSE:{color:0xf1f5f9,accent:0x991b1b,nameAr:'منزل سكني',desc:'منزل أبيض بسطح أحمر',colorName:'أبيض',street:'شارع المساكن'}
};

function makeRng(seed){let s=seed>>>0;return function(){s+=0x6D2B79F5;let t=Math.imul(s^s>>>15,1|s);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}
let rng=Math.random;
let sb=null,realtimeChannel=null;
let G={
  name:'',role:'host',myScore:0,opScore:0,oppName:'؟',roomCode:'',
  hidden:null,selected:null,attempts:3,helpAsks:3,
  phase:'lobby',timerV:60,timerI:null,citySeed:0,
  guessing:false,lastHandledAttempt:-1,lastHandledGuess:-1,
  hiddenBuildingData:null // بيانات المبنى المختار لتوليد الـ hints
};

// توليد الـ hints من بيانات المبنى
function generateHints(b, hiddenId){
  const num=parseInt(hiddenId.replace(/D/g,''))||0;
  const hints=[
    '🏗️ نوع المبنى: '+b.nameAr,
    '🎨 لون المبنى: '+b.colorName,
    '🚦 المبنى في: '+(b.street||'منطقة متنوعة'),
    '🔢 رقم المبنى يحتوي على الرقم '+(num%10),
    '📍 المبنى رقمه '+hiddenId.replace('b','')+' في المدينة'
  ];
  return hints;
}

let scene,camera,renderer,cityGroup,raycaster,mouse;
let selectableBuildings=[],cars=[],markers=[];
let isMouseDown=false,targetRotX=0.55,targetRotY=-0.4;
let lastMX=0,lastMY=0,highlightedMesh=null;

function initSB(){if(!sb)sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);}
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById('s-'+id).classList.add('active');if(id==='game')setTimeout(initThreeJS,100);}
function showErr(msg){const e=document.getElementById('lobby-err');e.textContent=msg;e.style.display='block';setTimeout(()=>e.style.display='none',3500);}
function getName(){const n=document.getElementById('inp-name').value.trim();if(!n){showErr('من فضلك ادخل اسمك');return null;}return n;}
function toggleJoin(){const b=document.getElementById('join-box');b.style.display=b.style.display==='none'?'block':'none';}
function genCode(){return Math.floor(100000+Math.random()*900000).toString();}
function copyCode(){navigator.clipboard.writeText(G.roomCode).catch(()=>{});}

async function doCreate(){const name=getName();if(!name)return;initSB();G.name=name;G.role='host';G.roomCode=genCode();G.citySeed=Math.floor(Math.random()*2147483647);const{error}=await sb.from('game_rooms').insert({code:G.roomCode,host_name:name,status:'waiting',map_idx:G.citySeed,phase:'hiding'});if(error){showErr('خطأ في إنشاء الغرفة');return;}document.getElementById('show-code').textContent=G.roomCode;show('wait');subscribeToRoom(G.roomCode);setConnected(false,'في انتظار الزائر...');}
async function doJoin(){const name=getName();if(!name)return;const code=document.getElementById('inp-code').value.trim();if(code.length!==6||isNaN(code)){showErr('6 أرقام');return;}initSB();G.name=name;G.role='guest';G.roomCode=code;const{data,error}=await sb.from('game_rooms').select('*').eq('code',code).eq('status','waiting').single();if(error||!data){showErr('الغرفة مش موجودة');return;}G.oppName=data.host_name;G.citySeed=data.map_idx||1;await sb.from('game_rooms').update({guest_name:name,status:'playing'}).eq('code',code);document.getElementById('show-code').textContent=code;show('wait');subscribeToRoom(code);setConnected(true,'متصل ✓');await sendEvent({t:'guest_joined',name:G.name,seed:G.citySeed});setTimeout(()=>startGame(),400);}

function subscribeToRoom(code){if(realtimeChannel)sb.removeChannel(realtimeChannel);realtimeChannel=sb.channel('room_'+code).on('postgres_changes',{event:'INSERT',schema:'public',table:'game_events',filter:'room_code=eq.'+code},({new:row})=>{if(row.sender!==G.name)handleMsg(row.event_type,row.payload||{});}).subscribe();}
async function sendEvent(payload){const{t,...rest}=payload;await sb.from('game_events').insert({room_code:G.roomCode,sender:G.name,event_type:t,payload:rest});}

function handleMsg(type,data){
  if(type==='guest_joined'){G.oppName=data.name;setConnected(true,'الزائر اتصل ✓');setTimeout(()=>startGame(),300);}
  else if(type==='start_search'){G.hidden=data.cell;G.phase='seeking';G.lastHandledAttempt=-1;updateUI();setStatus('المضيف أخفى الكنز — دورك تبحث! اضغط على مبنى');document.getElementById('seeker-ctrl').style.display='block';document.getElementById('hider-ctrl').style.display='none';document.getElementById('att-row').style.display='flex';hideBuildingInfo();updateDots();updateBadge();updateHelpBtns();startTimer();}
  else if(type==='guess'){
    if(data.attempt===G.lastHandledGuess)return;
    G.lastHandledGuess=data.attempt;
    handleGuess(data.cell,data.attempt);
  }
  else if(type==='result'){
    if(data.attempt===G.lastHandledAttempt)return;
    G.lastHandledAttempt=data.attempt;
    applyResult(data.found,data.cell,data.pts,data.hidden,data.attempt);
  }
  else if(type==='help_request'){
    // المضيف يتلقى طلب استغاثة
    showHintPanel(data.hintIndex);
  }
  else if(type==='hint_sent'){
    // الزائر يتلقى التلميح
    showHintToGuest(data.hint);
  }
  else if(type==='next_round'){startNextRound(data);}
  else if(type==='chat'){addChat(data.from,data.text);}
}

function startGame(){show('game');if(G.role==='host'){G.phase='hiding';updateUI();setStatus('اختر مبنى من المدينة واضغط تأكيد الإخفاء');}else{G.phase='waiting_host';updateUI();setStatus('في انتظار المضيف...');}}

async function confirmHide(){
  if(!G.selected)return;
  G.hidden=G.selected;
  // بيانات المبنى لتوليد الـ hints
  const b=selectableBuildings.find(x=>x.id===G.selected);
  if(b){G.hiddenBuildingData={nameAr:b.nameAr,desc:b.desc,colorName:b.colorName,street:b.type?b.type.street:'',id:b.id};}
  G.phase='ready_to_search';updateUI();
  if(b){b.mesh.material.color.setHex(0xffd700);b.grp.userData.marked=true;addGemMarker(b);showBuildingInfo(b,true);}
  setStatus('تم تحديد مخبأ الكنز ✔️ — اضغط ابدأ البحث');
  document.getElementById('btn-hide').disabled=true;
  document.getElementById('btn-start-search').style.display='block';
}

async function startSearch(){
  if(!G.hidden)return;
  await sendEvent({t:'start_search',cell:G.hidden});
  G.phase='host_waiting';G.lastHandledGuess=-1;updateUI();
  setStatus('الزائر بيبحث... انتظر');
  document.getElementById('btn-start-search').style.display='none';
  document.getElementById('hider-ctrl').style.display='none';
  hideBuildingInfo();
}

async function confirmGuess(){
  if(!G.selected||G.attempts<=0||G.guessing)return;
  G.guessing=true;
  G.attempts--;
  const attempt=3-G.attempts;
  document.getElementById('btn-guess').disabled=true;
  document.getElementById('btn-guess').textContent='يتم الإرسال...';
  await sendEvent({t:'guess',cell:G.selected,attempt});
  updateDots();
  setStatus('في انتظار النتيجة...');
  G.selected=null;
  hideBuildingInfo();
}

// ─── HELP SYSTEM ──────────────────────────────────────────
async function askForHelp(){
  if(G.helpAsks<=0||G.phase!=='seeking')return;
  G.helpAsks--;
  updateHelpBtns();
  const hintIndex=2-G.helpAsks; // 0,1,2
  await sendEvent({t:'help_request',hintIndex});
  setStatus('❔ طلبت استغاثة — انتظر رد المضيف...');
  document.getElementById('btn-help').textContent='✅ تم الطلب';
  document.getElementById('btn-help').disabled=true;
}

// المضيف يبعت التلميح
async function showHintPanel(hintIndex){
  if(!G.hiddenBuildingData&&G.hidden){
    const b=selectableBuildings.find(x=>x.id===G.hidden);
    if(b)G.hiddenBuildingData={nameAr:b.nameAr,colorName:b.colorName,id:b.id,street:b.type?b.type.street:''};
  }
  if(!G.hiddenBuildingData)return;
  const hints=generateHints(G.hiddenBuildingData,G.hidden);
  const hint=hints[hintIndex]||hints[0];
  // المضيف بيشوف التلميح بتاعه برضو + بيوديه للزائر
  showHostHintConfirm(hint, hintIndex);
}

function showHostHintConfirm(hint, hintIndex){
  const panel=document.getElementById('hint-host-panel');
  panel.innerHTML=
    '<div class="hint-host-box">'
    +'<div class="hint-host-title">🚨 الزائر طلب مساعدة!</div>'
    +'<div class="hint-preview">'+hint+'</div>'
    +'<div class="hint-host-btns">'
    +'<button class="btn primary" onclick="sendHint('' + hint.replace(/'/g,"\'")+"',"+hintIndex+')">✅ أرسل هذا التلميح</button>'
    +'<button class="btn" onclick="dismissHintPanel()">❌ تجاهل</button>'
    +'</div></div>';
  panel.style.display='block';
}

async function sendHint(hint, hintIndex){
  await sendEvent({t:'hint_sent',hint,hintIndex});
  document.getElementById('hint-host-panel').style.display='none';
  setStatus('✅ تم إرسال التلميح للزائر');
}

function dismissHintPanel(){
  document.getElementById('hint-host-panel').style.display='none';
  setStatus('رفضت إرسال التلميح');
}

function showHintToGuest(hint){
  const box=document.getElementById('hint-guest-box');
  box.innerHTML='<div class="hint-received">💡 <strong>تلميح:</strong> '+hint+'</div>';
  box.style.display='block';
  setStatus('💡 وصلك تلميح — استخدمه للبحث');
  document.getElementById('btn-help').textContent='🚨 استغاثة ('+(G.helpAsks)+')';
  if(G.helpAsks>0)document.getElementById('btn-help').disabled=false;
}

function updateHelpBtns(){
  const btn=document.getElementById('btn-help');
  if(!btn)return;
  btn.textContent='🚨 استغاثة ('+G.helpAsks+')';
  btn.disabled=G.helpAsks<=0||G.phase!=='seeking';
  btn.className='btn help-btn'+(G.helpAsks<=0?' disabled':'');
}

// ─── GAME LOGIC ──────────────────────────────────────────
async function handleGuess(guessCell,attempt){
  const found=guessCell===G.hidden;
  let pts=0;
  if(found)pts=attempt===1?20:attempt===2?10:5;
  if(!found)markBuilding(guessCell,'wrong');
  await sendEvent({t:'result',found,cell:guessCell,pts,hidden:G.hidden,attempt});
  if(!found&&attempt>=3){G.opScore+=20;updateScores();showEnd(false,false,0);}
  else if(found){showEnd(false,true,pts);}
}

function applyResult(found,guessCell,pts,hiddenCell,attempt){
  G.guessing=false;
  if(!found){
    markBuildingX(guessCell);
    const b=selectableBuildings.find(x=>x.id===guessCell);
    if(b)showBuildingInfo(b,false,true);
  }
  if(found){
    G.myScore+=pts;updateScores();
    if(hiddenCell)markBuilding(hiddenCell,'found');
    showEnd(true,true,pts);
  } else if(attempt>=3){
    if(hiddenCell)markBuilding(hiddenCell,'found');
    showEnd(true,false,0);
  } else {
    const remaining=3-attempt;
    setStatus('خطأ! تبقى '+remaining+' محاولة — اختر مبنى تاني');
    document.getElementById('btn-guess').textContent='🔍 تأكيد التخمين';
    document.getElementById('btn-guess').disabled=false;
    updateBadge();
  }
  stopTimer();
}

function showEnd(isSeeker,found,pts){
  stopTimer();
  const isGuest=G.role==='guest';
  document.getElementById('hint-guest-box').style.display='none';
  document.getElementById('hint-host-panel').style.display='none';
  document.getElementById('ov-icon').textContent=found?'🎉':'😅';
  if(found){document.getElementById('ov-title').textContent=isGuest?'وجدت الكنز! 🎉':'الزائر وجد الكنز';document.getElementById('ov-msg').textContent=isGuest?'ربحت '+pts+' نقطة!':'الزائر اكتشف المخبأ';}
  else{document.getElementById('ov-title').textContent=isGuest?'لم تجد الكنز 😅':'ربحت الجولة! 🏆';document.getElementById('ov-msg').textContent=isGuest?'فشلت في إيجاد الكنز':'الزائر فشل — ربحت 20 نقطة!';}
  document.getElementById('end-overlay').style.display='flex';
  hideBuildingInfo();
  saveScore();
}

async function nextRound(){const newSeed=Math.floor(Math.random()*2147483647);G.citySeed=newSeed;await sendEvent({t:'next_round',newSeed,newHostRole:G.role==='host'?'guest':'host'});applyNextRound(G.role==='host'?'guest':'host',newSeed);}
function startNextRound(data){applyNextRound(G.role==='host'?'guest':'host',data.newSeed||G.citySeed);}
function applyNextRound(newRole,newSeed){
  G.role=newRole;G.hidden=null;G.selected=null;G.attempts=3;G.helpAsks=3;
  G.guessing=false;G.lastHandledAttempt=-1;G.lastHandledGuess=-1;
  G.hiddenBuildingData=null;
  G.phase=newRole==='host'?'hiding':'waiting_host';
  document.getElementById('end-overlay').style.display='none';
  document.getElementById('btn-start-search').style.display='none';
  document.getElementById('btn-hide').disabled=true;
  document.getElementById('btn-guess').disabled=true;
  document.getElementById('btn-guess').textContent='🔍 تأكيد التخمين';
  document.getElementById('hint-guest-box').style.display='none';
  document.getElementById('hint-host-panel').style.display='none';
  if(newSeed)G.citySeed=newSeed;
  rng=makeRng(G.citySeed);clearMarkers();resetBuildingColors();generateCity();updateUI();hideBuildingInfo();
  if(G.role==='host')setStatus('دورك تخفي الكنز — اختر مبنى');
  else setStatus('في انتظار المضيف...');
}

// ─── UI ────────────────────────────────────────────────────
function showBuildingInfo(b,isHidden,isWrong){const panel=document.getElementById('building-info');const colorHex='#'+(b.grp.userData.origColor||0x888888).toString(16).padStart(6,'0');let icon='🏙️';if(b.nameAr.includes('مستشف'))icon='🏥';else if(b.nameAr.includes('مدرس'))icon='🏫';else if(b.nameAr.includes('مصنع'))icon='🏷️';else if(b.nameAr.includes('مول'))icon='🛍️';else if(b.nameAr.includes('مسجد'))icon='🕌';else if(b.nameAr.includes('برج'))icon='🏙️';else if(b.nameAr.includes('منزل'))icon='🏠';let statusBadge='';if(isHidden)statusBadge='<span class="info-badge gem">💎 مخبأ الكنز</span>';if(isWrong)statusBadge='<span class="info-badge wrong">❌ ليس هنا</span>';panel.innerHTML='<div class="info-row"><span class="info-icon">'+icon+'</span><div class="info-content"><div class="info-name">'+b.nameAr+' '+statusBadge+'</div><div class="info-desc">'+(b.desc||'')+'</div><div class="info-color"><span class="color-dot" style="background:'+colorHex+'"></span>'+(b.colorName||'')+'</div></div></div>';panel.style.display='block';}
function hideBuildingInfo(){const p=document.getElementById('building-info');if(p)p.style.display='none';}

function updateUI(){const rb=document.getElementById('role-banner');document.getElementById('my-lbl').textContent=G.name||'أنا';document.getElementById('op-lbl').textContent=G.oppName;document.getElementById('hider-ctrl').style.display='none';document.getElementById('seeker-ctrl').style.display='none';document.getElementById('att-row').style.display='none';document.getElementById('btn-start-search').style.display='none';document.getElementById('help-row').style.display='none';if(G.role==='host'){rb.className='role-banner role-hide';rb.textContent='🏠 أنت المضيف — دورك الإخفاء';if(G.phase==='hiding')document.getElementById('hider-ctrl').style.display='block';}else{rb.className='role-banner role-seek';rb.textContent='🚶 أنت الزائر — دورك البحث';if(G.phase==='seeking'){document.getElementById('seeker-ctrl').style.display='block';document.getElementById('att-row').style.display='flex';document.getElementById('help-row').style.display='flex';updateDots();updateBadge();updateHelpBtns();}}updateScores();}
function updateScores(){document.getElementById('my-sc').textContent=G.myScore;document.getElementById('op-sc').textContent=G.opScore;}
function updateDots(){const u=3-G.attempts;document.querySelectorAll('#att-dots .dot').forEach((d,i)=>d.className='dot '+(i<u?'used':'left'));}
function updateBadge(){const u=3-G.attempts;const b=document.getElementById('pts-badge');b.textContent=[20,10,5][u]+' نقطة';b.className='badge '+(u===0?'bg':u===1?'ba':'br');}
function setStatus(txt){const el=document.getElementById('status-bar');if(el)el.textContent=txt;}
function setConnected(on,txt){document.getElementById('conn-dot').className='conn-dot'+(on?' on':'');document.getElementById('conn-txt').textContent=txt;}
function startTimer(){G.timerV=60;stopTimer();const el=document.getElementById('timer-el');G.timerI=setInterval(()=>{G.timerV--;el.textContent=G.timerV;el.className='timer'+(G.timerV<=15?' warn':'');if(G.timerV<=0){stopTimer();if(G.role==='guest'&&G.phase==='seeking'){if(G.hidden)markBuilding(G.hidden,'found');showEnd(true,false,0);}}},1000);}
function stopTimer(){if(G.timerI){clearInterval(G.timerI);G.timerI=null;}}
async function sendChat(){const inp=document.getElementById('chat-inp');const txt=inp.value.trim();if(!txt)return;addChat(G.name,txt);await sendEvent({t:'chat',from:G.name,text:txt});inp.value='';}
function addChat(from,text){const box=document.getElementById('chat-el');const el=document.createElement('div');el.className='chat-msg';el.innerHTML='<span class="who">'+from+':</span> '+text;box.appendChild(el);box.scrollTop=box.scrollHeight;}
async function saveScore(){if(!G.name||G.myScore===0)return;await sb.from('leaderboard').upsert({player_name:G.name,score:G.myScore,updated_at:new Date().toISOString()},{onConflict:'player_name'});loadLB();}
async function loadLB(){initSB();const{data}=await sb.from('leaderboard').select('player_name,score').order('score',{ascending:false}).limit(5);const tbody=document.getElementById('lb-body');if(!data||!data.length){tbody.innerHTML='<tr><td colspan="3" class="empty-cell">لا يوجد بيانات بعد</td></tr>';return;}tbody.innerHTML=data.map((e,i)=>'<tr><td>'+(i+1)+'</td><td>'+e.player_name+'</td><td>'+e.score+'</td></tr>').join('');}

// THREE.JS
function addGemMarker(b){clearMarkers();const bbox=new THREE.Box3().setFromObject(b.grp);const topY=bbox.max.y;const stemMat=new THREE.MeshStandardMaterial({color:0xffd700,emissive:0xffa500,emissiveIntensity:0.5});const stem=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,6,6),stemMat);stem.position.set(0,topY+3,0);const gemMat=new THREE.MeshPhysicalMaterial({color:0xffd700,emissive:0xffa500,emissiveIntensity:0.8,metalness:0.9,roughness:0.1});const gem=new THREE.Mesh(new THREE.OctahedronGeometry(3),gemMat);gem.position.set(0,topY+9,0);gem.userData.floatBase=topY+9;const ring=new THREE.Mesh(new THREE.TorusGeometry(4,0.4,8,24),new THREE.MeshStandardMaterial({color:0xffd700,emissive:0xffaa00,emissiveIntensity:0.6}));ring.position.set(0,topY+9,0);ring.rotation.x=Math.PI/2;ring.userData.isRing=true;const light=new THREE.PointLight(0xffd700,2,30);light.position.set(0,topY+9,0);const mg=new THREE.Group();mg.add(stem,gem,ring,light);const wp=new THREE.Vector3();b.grp.getWorldPosition(wp);mg.position.copy(wp);cityGroup.add(mg);markers.push(mg);}
function addXMarker(b){const bbox=new THREE.Box3().setFromObject(b.grp);const topY=bbox.max.y;const wp=new THREE.Vector3();b.grp.getWorldPosition(wp);const mat=new THREE.MeshStandardMaterial({color:0xe24b4a,emissive:0xcc0000,emissiveIntensity:0.6});const a1=new THREE.Mesh(new THREE.BoxGeometry(8,1.5,1.5),mat);const a2=new THREE.Mesh(new THREE.BoxGeometry(8,1.5,1.5),mat);a1.rotation.y=Math.PI/4;a2.rotation.y=-Math.PI/4;const xg=new THREE.Group();xg.add(a1,a2);xg.position.set(wp.x,topY+2,wp.z);cityGroup.add(xg);markers.push(xg);}
function clearMarkers(){markers.forEach(m=>cityGroup.remove(m));markers=[];}
function markBuildingX(id){const b=selectableBuildings.find(x=>x.id===id);if(!b)return;b.grp.userData.marked=true;b.mesh.material.color.setHex(0xe24b4a);addXMarker(b);}
function markBuilding(id,state){const b=selectableBuildings.find(x=>x.id===id);if(!b)return;b.grp.userData.marked=true;b.mesh.material.color.setHex(state==='found'?0xfac775:0xe24b4a);}
function resetBuildingColors(){selectableBuildings.forEach(b=>{b.grp.userData.marked=false;b.mesh.material.color.setHex(b.grp.userData.origColor);});G.selected=null;}

function initThreeJS(){const container=document.getElementById('city-canvas');if(!container||container.querySelector('canvas'))return;if(!window.THREE){return setTimeout(initThreeJS,500);}scene=new THREE.Scene();scene.background=new THREE.Color(0x0f172a);scene.fog=new THREE.Fog(0x0f172a,250,700);camera=new THREE.PerspectiveCamera(55,container.clientWidth/container.clientHeight,1,2000);camera.position.set(130,110,130);camera.lookAt(0,0,0);renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(container.clientWidth,container.clientHeight);renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.shadowMap.enabled=true;container.appendChild(renderer.domElement);scene.add(new THREE.AmbientLight(0xffffff,0.9));const sun=new THREE.DirectionalLight(0xfff7ed,1.2);sun.position.set(200,400,100);sun.castShadow=true;scene.add(sun);raycaster=new THREE.Raycaster();mouse=new THREE.Vector2();cityGroup=new THREE.Group();scene.add(cityGroup);rng=makeRng(G.citySeed||42);generateCity();setupCityInteraction(container);animateCity();window.addEventListener('resize',()=>{if(!container||!renderer)return;camera.aspect=container.clientWidth/container.clientHeight;camera.updateProjectionMatrix();renderer.setSize(container.clientWidth,container.clientHeight);});}
function generateCity(){selectableBuildings=[];cars=[];while(cityGroup.children.length>0)cityGroup.remove(cityGroup.children[0]);const size=200,grid=50;const ground=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshStandardMaterial({color:0x14532d}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;cityGroup.add(ground);for(let i=-size;i<=size;i+=grid){addRoad(new THREE.Vector3(0,0.02,i),size*2,14,true);addRoad(new THREE.Vector3(i,0.02,0),size*2,14,false);}let idx=0;for(let x=-size+grid/2;x<size;x+=grid){for(let z=-size+grid/2;z<size;z+=grid){const r=rng(),id='b'+idx++;if(r<0.09)addSpecial(x,z,grid*0.75,BTYPES.HOSPITAL,id);else if(r<0.18)addSpecial(x,z,grid*0.75,BTYPES.SCHOOL,id);else if(r<0.27)addSpecial(x,z,grid*0.8,BTYPES.FACTORY,id);else if(r<0.36)addSpecial(x,z,grid*0.75,BTYPES.MALL,id);else if(r<0.44)addSpecial(x,z,grid*0.7,BTYPES.MOSQUE,id);else if(r<0.68)addTower(x,z,grid*0.6,id);else addHouses(x,z,grid*0.7,id);}}}
function addRoad(pos,length,width,isH){const mesh=new THREE.Mesh(new THREE.PlaneGeometry(isH?length:width,isH?width:length),new THREE.MeshStandardMaterial({color:0x1e293b}));mesh.rotation.x=-Math.PI/2;mesh.position.copy(pos);mesh.receiveShadow=true;cityGroup.add(mesh);for(let i=0;i<2;i++)spawnCar(pos,isH);}
function addSpecial(x,z,size,type,id){const h=type===BTYPES.FACTORY?14:20;const grp=new THREE.Group();grp.userData={id,nameAr:type.nameAr,origColor:type.color,marked:false};const mat=new THREE.MeshStandardMaterial({color:type.color});const body=new THREE.Mesh(new THREE.BoxGeometry(size,h,size),mat);body.position.y=h/2;body.castShadow=true;body.userData={selId:id};grp.add(body);selectableBuildings.push({mesh:body,id,nameAr:type.nameAr,desc:type.desc,colorName:type.colorName,type,grp});const acc=new THREE.Mesh(new THREE.BoxGeometry(size+0.5,2,size+0.5),new THREE.MeshStandardMaterial({color:type.accent}));acc.position.y=h-1;grp.add(acc);if(type===BTYPES.FACTORY){const ch=new THREE.Mesh(new THREE.CylinderGeometry(1.5,2,8),new THREE.MeshStandardMaterial({color:0x334155}));ch.position.set(size/3,h+4,size/3);grp.add(ch);}if(type===BTYPES.MOSQUE){const dome=new THREE.Mesh(new THREE.SphereGeometry(size/4,8,8),new THREE.MeshStandardMaterial({color:0xffd700}));dome.position.set(0,h+size/4,0);grp.add(dome);}grp.position.set(x,0,z);cityGroup.add(grp);}
function addTower(x,z,size,id){const h=40+rng()*80;const grp=new THREE.Group();grp.userData={id,nameAr:'برج سكني',origColor:0x334155,marked:false};const mat=new THREE.MeshStandardMaterial({color:0x334155});const body=new THREE.Mesh(new THREE.BoxGeometry(size,h,size),mat);body.position.y=h/2;body.castShadow=true;body.userData={selId:id};grp.add(body);selectableBuildings.push({mesh:body,id,nameAr:'برج سكني',desc:'برج زجاجي شاهق',colorName:'رمادي',grp});const glass=new THREE.Mesh(new THREE.BoxGeometry(size+0.2,h*0.9,size+0.2),new THREE.MeshPhysicalMaterial({color:0x60a5fa,transmission:0.3,thickness:1}));glass.position.y=h/2;grp.add(glass);grp.position.set(x,0,z);cityGroup.add(grp);}
function addHouses(x,z,size,baseId){const sub=size/2.5;let i=0;for(let a=-1;a<=1;a+=2){for(let b2=-1;b2<=1;b2+=2){const hx=x+a*sub,hz=z+b2*sub,h=6+rng()*4,id=baseId+'_'+i++;const grp=new THREE.Group();grp.userData={id,nameAr:'منزل سكني',origColor:0xf1f5f9,marked:false};const mat=new THREE.MeshStandardMaterial({color:0xf1f5f9});const house=new THREE.Mesh(new THREE.BoxGeometry(8,h,8),mat);house.position.y=h/2;house.castShadow=true;house.userData={selId:id};grp.add(house);selectableBuildings.push({mesh:house,id,nameAr:'منزل سكني',desc:'منزل أبيض بسطح أحمر',colorName:'أبيض',grp});const roof=new THREE.Mesh(new THREE.BoxGeometry(9,1,9),new THREE.MeshStandardMaterial({color:0x991b1b}));roof.position.y=h;grp.add(roof);grp.position.set(hx,0,hz);cityGroup.add(grp);}}}
function spawnCar(pos,isH){const grp=new THREE.Group();const col=[0x3b82f6,0xef4444,0x10b981,0xffffff][Math.floor(Math.random()*4)];grp.add(new THREE.Mesh(new THREE.BoxGeometry(1.5,1,3),new THREE.MeshStandardMaterial({color:col})));const lane=Math.random()>0.5?3.5:-3.5;if(isH){grp.position.set((Math.random()-0.5)*400,0.6,pos.z+lane);grp.rotation.y=Math.PI/2;}else{grp.position.set(pos.x+lane,0.6,(Math.random()-0.5)*400);}cars.push({mesh:grp,horizontal:isH,speed:(0.3+Math.random()*0.4)*(lane>0?1:-1)});cityGroup.add(grp);}
function setupCityInteraction(container){container.addEventListener('mousedown',e=>{isMouseDown=true;lastMX=e.clientX;lastMY=e.clientY;});container.addEventListener('mouseup',e=>{if(Math.abs(e.clientX-lastMX)<6&&Math.abs(e.clientY-lastMY)<6)onCityClick(e,container);isMouseDown=false;});container.addEventListener('mousemove',e=>{if(isMouseDown){targetRotY+=e.movementX*0.005;targetRotX+=e.movementY*0.005;}else onCityHover(e,container);});container.addEventListener('wheel',e=>{camera.position.multiplyScalar(1+e.deltaY*0.001);const d=camera.position.length();if(d<40)camera.position.normalize().multiplyScalar(40);if(d>500)camera.position.normalize().multiplyScalar(500);});let lTX=0,lTY=0,tS=0;container.addEventListener('touchstart',e=>{lTX=e.touches[0].clientX;lTY=e.touches[0].clientY;tS=Date.now();});container.addEventListener('touchmove',e=>{targetRotY+=(e.touches[0].clientX-lTX)*0.005;targetRotX+=(e.touches[0].clientY-lTY)*0.005;lTX=e.touches[0].clientX;lTY=e.touches[0].clientY;e.preventDefault();},{passive:false});container.addEventListener('touchend',e=>{if(Date.now()-tS<250)onCityClick(e.changedTouches[0],container);});}
function getHit(event,container){const rect=container.getBoundingClientRect();mouse.x=((event.clientX-rect.left)/container.clientWidth)*2-1;mouse.y=-((event.clientY-rect.top)/container.clientHeight)*2+1;raycaster.setFromCamera(mouse,camera);const hits=raycaster.intersectObjects(selectableBuildings.map(b=>b.mesh));if(hits.length)return selectableBuildings.find(b=>b.mesh===hits[0].object);return null;}
function onCityHover(event,container){const b=getHit(event,container);if(highlightedMesh){const prev=selectableBuildings.find(x=>x.mesh===highlightedMesh);if(prev&&!prev.grp.userData.marked&&prev.id!==G.selected)highlightedMesh.material.color.setHex(prev.grp.userData.origColor);highlightedMesh=null;}if(b&&!b.grp.userData.marked){b.mesh.material.color.setHex(0xffd700);highlightedMesh=b.mesh;container.style.cursor='pointer';}else container.style.cursor='grab';}
function onCityClick(event,container){const b=getHit(event,container);if(!b)return;const canHide=G.role==='host'&&G.phase==='hiding';const canGuess=G.role==='guest'&&G.phase==='seeking'&&G.attempts>0&&!G.guessing;if(!canHide&&!canGuess)return;if(b.grp.userData.marked&&canGuess)return;if(G.selected&&G.selected!==b.id){const prev=selectableBuildings.find(x=>x.id===G.selected);if(prev&&!prev.grp.userData.marked)prev.mesh.material.color.setHex(prev.grp.userData.origColor);}G.selected=b.id;b.mesh.material.color.setHex(0x00ff88);showBuildingInfo(b,false,false);setStatus('اخترت: '+b.nameAr);if(canHide)document.getElementById('btn-hide').disabled=false;else document.getElementById('btn-guess').disabled=false;}
let animFrame=0;
function animateCity(){requestAnimationFrame(animateCity);if(!renderer||!scene||!camera)return;animFrame++;cityGroup.rotation.y+=(targetRotY-cityGroup.rotation.y)*0.08;cityGroup.rotation.x+=(targetRotX-cityGroup.rotation.x)*0.08;cityGroup.rotation.x=Math.max(0.05,Math.min(cityGroup.rotation.x,1.2));cityGroup.traverse(obj=>{if(obj.userData.floatBase!==undefined){obj.position.y=obj.userData.floatBase+Math.sin(animFrame*0.05)*2;obj.rotation.y+=0.02;}if(obj.userData.isRing){obj.rotation.z+=0.03;}});cars.forEach(c=>{if(c.horizontal){c.mesh.position.x+=c.speed;if(Math.abs(c.mesh.position.x)>300)c.mesh.position.x*=-1;}else{c.mesh.position.z+=c.speed;if(Math.abs(c.mesh.position.z)>300)c.mesh.position.z*=-1;}});renderer.render(scene,camera);}
loadLB();
