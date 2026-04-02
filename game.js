const SUPABASE_URL = 'https://uamhxhmrwcugoroeplln.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhbWh4aG1yd2N1Z29yb2VwbGxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2MzY3NzQsImV4cCI6MjA4MjIxMjc3NH0.IQ8G73Swnc8Q9VoQdi9TOj-fKYcKd2K50SuIXBuuR64';

const BTYPES = {
  HOSPITAL:{ color:0xffffff, accent:0xef4444, nameAr:'ÙØ³ØªØ´ÙÙ Ø§ÙØ£ÙÙ' },
  SCHOOL:  { color:0xfacc15, accent:0x1e40af, nameAr:'ÙØ¯Ø±Ø³Ø© Ø§ÙÙÙØ±' },
  FACTORY: { color:0x475569, accent:0x1e293b, nameAr:'ÙØµÙØ¹ Ø§ÙØºØ¯' },
  MALL:    { color:0xec4899, accent:0xbe185d, nameAr:'ÙÙÙ Ø§ÙØ®ÙÙØ¬' },
  MOSQUE:  { color:0x10b981, accent:0x065f46, nameAr:'ÙØ³Ø¬Ø¯ Ø§ÙÙØ±ÙØ©' },
  TOWER:   { color:0x334155, accent:0x60a5fa, nameAr:'Ø¨Ø±Ø¬ Ø³ÙÙÙ' },
  HOUSE:   { color:0xf1f5f9, accent:0x991b1b, nameAr:'ÙÙØ²Ù Ø³ÙÙÙ' },
};

let sb = null, realtimeChannel = null;
let G = {
  name:'', role:'host',
  myScore:0, opScore:0, oppName:'Ø', roomCode:'',
  hidden:null, selected:null, attempts:3,
  phase:'lobby',
  timerV:60, timerI:null
};
let scene, camera, renderer, cityGroup, raycaster, mouse;
let selectableBuildings=[], cars=[];
let isMouseDown=false, targetRotX=0.55, targetRotY=-0.4;
let lastMX=0, lastMY=0, highlightedMesh=null;

function initSB(){ if(!sb) sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY); }
function show(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('s-'+id).classList.add('active');
  if(id==='game') setTimeout(initThreeJS,100);
}
function showErr(msg){const e=document.getElementById('lobby-err');e.textContent=msg;e.style.display='block';setTimeout(()=>e.style.display='none',3500);}
function getName(){const n=document.getElementById('inp-name').value.trim();if(!n){showErr('ÙÙ ÙØ¶ÙÙ Ø§Ø¯Ø®Ù Ø§Ø³ÙÙ');return null;} return n;}
function toggleJoin(){const b=document.getElementById('join-box');b.style.display=b.style.display==='none'?'block':'none';}
function genCode(){ return Math.floor(100000+Math.random()*900000).toString(); }
async function doCreate(){const name=getName();if(!name)return;initSB();G.name=name;G.role='host';G.roomCode=genCode();const{error}=await sb.from('game_rooms').insert({code:G.roomCode,host_name:name,status:'waiting',map_idx:0,phase:'hiding'});if(error){showErr('Ø®Ø·Ø£ ÙÙ Ø¥ÙØ´Ø¦ Ø§ÙØºØ±ÙØ©');return;}document.getElementById('show-code').textContent=G.roomCode;show('wait');subscribeToRoom(G.roomCode);setConnected(false,'ÙÙ Ø§ÙØªØ¸Ø§Ø± Ø§ÙØ²Ø§Ø¦Ø±...');}
async function doJoin(){const name=getName();if(!name)return;const code=document.getElementById('inp-code').value.trim();if(code.length!==6||isNaN(code)){showErr('6 Ø£Ø±ÙØ§Ù');return;}initSB();G.name=name;G.role='guest';G.roomCode=code;const{data,error}=await sb.from('game_rooms').select('*').eq('code',code).eq('status','waiting').single();if(error||!data){showErr('Ø§ÙØºØ±ÙØ© ÙØ²ÙÙØ¬ÙØ¯Ø© Ø£Ù Ø§ÙØªÙØ£Ø§');return;}G.oppName=data.host_name;await sb.from('game_rooms').update({guest_name:name,status:'playing'}).eq('code',code);document.getElementById('show-code').textContent=code;show('wait');subscribeToRoom(code);setConnected(true,'ÙØªØµÙ â');await sendEvent({t:'guest_joined',name:G.name});setTimeout(()=>startGame(),400);}
function subscribeToRoom(code){if(realtimeChannel)sb.removeChannel(realtimeChannel);realtimeChannel=sb.channel('room_'+code).on('postgres_changes',{event:'INSERT',schema:'public',table:'game_events',filter:'room_code=eq.'+code},({new:row})=>{if(row.sender!==G.name)handleMsg(row.event_type,row.payload||{});}).subscribe();}
async function sendEvent(payload){const{t,...rest}=payload;await sb.from('game_events').insert({room_code:G.roomCode,sender:G.name,event_type:t,payload:rest});}
function handleMsg(type,data){if(type==='guest_joined'){G.oppName=data.name;setConnected(true,'Ø§ÙØ²Ø§Ø¦Ø± Ø§ØªØµÙ â');setTimeout(()=>startGame(),300);}else if(type==='start_search'){G.hidden=data.cell;G.phase='seeking';updateUI();setStatus('Ø§ÙÙØ¶ÙÙ Ø§Ø®ÙÙ Ø§ÙÙÙØ² â Ø¯ÙØ±Ù ØªØ¨Ø­Ø«!&çØ§Ø¶ØºØ· Ø¹ÙÙ ÙØ¨ÙÙ');document.getElementById('seeker-ctrl').style.display='block';document.getElementById('hider-ctrl').style.display='none';document.getElementById('att-row').style.display='flex';updateDots();updateBadge();startTimer();}else if(type==='guess'){handleGuess(data.cell,data.attempt);}else if(type==='result'){applyResult(data.found,data.cell,data.pts,data.hidden,data.attempt);}else if(type==='next_round'){startNextRound(data);}else if(type==='chat'){addChat(data.from,data.text);}}
function startGame(){show('game');if(G.role==='host'){G.phase='hiding';updateUI();setStatus('Ø§Ø®ØªØ§Ø± ÙØ¨ÙÙ ÙÙ Ø§ÙÙØ¯ÙÙØ© ÙØ§Ø¶ØºØ· "ØªØ§ÙÙØ¯ Ø§ÙØ¥Ø®ÙØ§Ø¡" ØªÙ Ø§Ø¨Ø¯Ø£ Ø§ÙØ¨Ø­Ø«');}else{G.phase='waiting_host';updateUI();setStatus('ÙÙ Ø§ÙØªØ¸Ø§Ø± Ø§ÙÙØ¶ÙÙ ÙØ®ÙÙ Ø§ÙÙÙØ²...');}}
async function confirmHide(){if(!G.selected)return;G.hidden=G.selected;G.phase='ready_to_search';updateUI();const b=selectableBuildings.find(x=>x.id===G.selected);if(b){b.mesh.material.color.setHex(0xffd700);b.grp.userData.marked=true;}setStatus(`ØªÙ ØªØ­Ø¯ÙØ¯ Ø§ÙÙÙØ² ÙÙ: ${b?b.nameAr:'Ø§ÙÙØ¨ÙÙ'} â Ø§Ø¶ØºØ· "Ø§Ø¨Ø¯Ø£ Ø§ÙØ¨Ø­Ø«" ÙØ¥Ø±Ø³Ø§Ù Ø§ÙØ²Ø§Ø¦Ø±`);document.getElementById('btn-hide').disabled=true;document.getElementById('btn-start-search').style.display='block';}
async function startSearch(){if(!G.hidden)return;await sendEvent({t:'start_search',cell:G.hidden});G.phase='host_waiting';updateUI();setStatus('Ø§ÙØ²Ø§Ø¦Ø± Ø¨ÙÙØ¨Ø­Ø« Ø§ÙØ¢Ù... Ø§ÙØªØ¸Ø±');document.getElementById('btn-start-search').style.display='none';document.getElementById('hider-ctrl').style.display='none';}
async function confirmGuess(){if(!G.selected||G.attempts<=0)return;G.attempts--;const attempt=3-G.attempts;await sendEvent({t:'guess',cell:G.selected,attempt});document.getElementById('btn-guess').disabled=true;updateDots();setStatus('ÙÙ Ø§ÙØªØ¸Ø§Ø± ÙØªÙØ¬Ø© Ø§ÙØªØ®ÙÙÙ...');G.selected=null;}
async function handleGuess(guessCell,attempt){const found=guessCell===G.hidden;if(found)pts=attempt===1?20:attempt===0?10:5;let pts=0;if(found)pts=attempt===1?20:attempt===2?10:5;else markBuilding(guessCell,'wrong');await sendEvent({t:'result',found,cell:guessCell,pts,hidden:G.hidden,attempt});if(!found&&attempt>=3){G.opScore+=20;updateScores();showEnd('host',false,0);}else if(found)showEnd('host',true,pts);}
function applyResult(found,guessCell,pts,hiddenCell,attempt){if(!found)markBuilding(guessCell,'wrong');if(found){G.myScore+=pts;updateScores();if(hiddenCell)markBuilding(hiddenCell,'found');showEnd('guest',true,pts);}else if(G.attempts<=0){if(hiddenCell)markBuilding(hiddenCell,'found');showEnd('guest',false,0);}else{setStatus('Ø®Ø·Ø£! '+G.attempts+' ÙØ­Ø§ÙÙØ§Øª Ø¨Ø§ÙÙØ© â Ø¬Ø±Ø¨ ÙØ¨ÙÙ ØªØ§ÙÙ');document.getElementById('btn-guess').disabled=false;updateBadge();}stopTimer();}
function showEnd(role,found,pts){stopTimer();const isGuest=G.role==='guest';document.getElementById('ov-icon').textContent=found?'ð':'ð';if(found){document.getElementById('ov-title').textContent=isGuest?'ÙØ¬Ø¯Øª Ø§ÙÙÙØ²!':'Ø§ÙØ²Ø§Ø¦Ø± ÙØ¬Ø¯ Ø§ÙÙÙØ²';document.getElementById('ov-msg').textContent=isGuest?Ø±Ù¨ Ø§ÙÙØ¨ÙÙ:!':'Ø§ÙØ²Ø§Ø¦Ø± Ø§ÙØªØ´Ù Ø§ÙÙØ®Ø¨Ø£';}else{document.getElementById('ov-title').textContent=isGuest?'ÙÙ ØªØ¬Ø¯ Ø§ÙÙÙØ²':'Ø±Ø¨Ø­Øª  Ø§ÙØ¬ÙÙØ©!';document.getElementById('ov-msg').textContent=isGuest?'â ÙØ´ÙØª  ÙÙ Ø¥ÙØ¬Ø§Ø¯ Ø§ÙÙÙØ²':'Ø§ÙØ²Ø§Ø¦Ø± ÙØ´Ù â 20 ÙÙØ·Ø©!';}document.getElementById('end-overlay').style.display='flex';saveScore();}
async function nextRound(){await sendEvent({t:'next_round',newHostRole:G.role==='host'?'guest':'host'});applyNextRound(G.role==='host'?'guest':'host');}
function startNextRound(data){applyNextRound(G.role==='host'?'guest':ÛÜÝ	ÊNßB[Ý[Û\S^Ý[
]ÔÛJ^ÑËÛO[]ÔÛNÑËY[[[ÑËÙ[XÝY[[ÑË][\ÏLÎÑË\ÙO[]ÔÛOOOIÚÜÝ	ÏÉÚY[ÉÎÝØZ][×ÚÜÝ	ÎÙØÝ[Y[Ù][[Y[RY
	Ù[[Ý\^IÊKÝ[K\Ü^OIÛÛIÎÜ\Ù]Z[[ÐÛÛÜÊ
NÝ\]URJ
NÚYËÛOOOIÚÜÝ	Ê^ÜÙ]Ý]\Ê	ö+öb6,v`È6*¶+¶`vb6)öa6`öa¶,8¡$6)ö+¶*v)ö,H6av*6a¶bH6b6)ö-¶.¶-È6*¶(ö`öb¶+ÉÊNÙØÝ[Y[Ù][[Y[RY
	Ø\Ý\\ÙX\Ú	ÊKÝ[K\Ü^OIÛÛIÎÙØÝ[Y[Ù][[Y[RY
	ØZYIÊK\ØXY]YNßY[Ù^ÜÙ]Ý]\Ê	ö`vb6)öa¶*¶.6)ö,H6)öa6av-¶b¶`H6b¶+¶`vb6)öa6`öa¶,ÊNß_B[Ý[Û\]URJ
^ØÛÛÝYØÝ[Y[Ù][[Y[RY
	ÜÛKX[\ÊNÙØÝ[Y[Ù][[Y[RY
	Û^K[	ÊK^ÛÛ[QË[Y_	ö(öa¶)ÉÎÙØÝ[Y[Ù][[Y[RY
	ÛÜ[	ÊK^ÛÛ[QËÜ[YNÙØÝ[Y[Ù][[Y[RY
	ÚY\XÝ	ÊKÝ[K\Ü^OIÛÛIÎÙØÝ[Y[Ù][[Y[RY
	ÜÙYZÙ\XÝ	ÊKÝ[K\Ü^OIÛÛIÎÙØÝ[Y[Ù][[Y[RY
	Ø]\ÝÉÊKÝ[K\Ü^OIÛÛIÎÙØÝ[Y[Ù][[Y[RY
	Ø\Ý\\ÙX\Ú	ÊKÝ[K\Ü^OIÛÛIÎÚYËÛOOOIÚÜÝ	Ê^ÜÛ\ÜÓ[YOIÜÛKX[\ÛKZYIÎÜ^ÛÛ[Iü'ãè6(öa¶*6)öa6av-¶b¶`H8 %6+öb6,v`È6)öa6)v+¶`v)ö(IÎÚYË\ÙOOOIÚY[ÉÊYØÝ[Y[Ù][[Y[RY
	ÚY\XÝ	ÊKÝ[K\Ü^OIØØÚÉÎßY[Ù^ÜÛ\ÜÓ[YOIÜÛKX[\ÛK\ÙYZÉÎÜ^ÛÛ[Iü'æ­¶(öa¶*6)öa6,¶)ö)¶,H8 %6+öb6,v`È6)öa6*6+v*ÉÎÚYË\ÙOOOIÜÙYZÚ[ÉÊ^ÙØÝ[Y[Ù][[Y[RY
	ÜÙYZÙ\XÝ	ÊKÝ[K\Ü^OIØØÚÉÎÙØÝ[Y[Ù][[Y[RY
	Ø]\ÝÉÊKÝ[K\Ü^OIÙ^	ÎÝ\]QÝÊ
NÝ\]PYÙJ
Nß_]\]TØÛÜ\Ê
NßB[Ý[Û\]TØÛÜ\Ê
^ÙØÝ[Y[Ù][[Y[RY
	Û^K\ØÉÊK^ÛÛ[QË^TØÛÜNÙØÝ[Y[Ù][[Y[RY
	ÛÜ\ØÉÊK^ÛÛ[QËÜØÛÜNßB[Ý[Û\]QÝÊ
^ØÛÛÝ\ÙYLËQË][\ÎÙØÝ[Y[]Y\TÙ[XÝÜ[
	ÈØ]YÝÈÝ	ÊKÜXXÚ

JOOÛ\ÜÓ[YOIÙÝ	ÊÊO\ÙYÉÝ\ÙY	ÎÛY	ÊJNßB[Ý[Û\]PYÙJ
^ØÛÛÝ\ÙYLËQË][\ÎØÛÛÝYØÝ[Y[Ù][[Y[RY
	ÜËXYÙIÊNØ^ÛÛ[VÌLWVÝ\ÙYJÉÈ6a¶`¶-ö*IÎØÛ\ÜÓ[YOIØYÙH	ÊÊ\ÙYOOLÉØÉÎ\ÙYOOLOÉØIÎØÊNßB[Ý[ÛÙ]Ý]\Ê
^ØÛÛÝ[YØÝ[Y[Ù][[Y[RY
	ÜÝ]\ËX\ÊNÚY[
Y[^ÛÛ[]ßB[Ý[ÛÙ]ÛÛXÝY
Û
^ÙØÝ[Y[Ù][[Y[RY
	ØÛÛYÝ	ÊKÛ\ÜÓ[YOIØÛÛYÝ	ÊÊÛÉÈÛÎÉÊNÙØÝ[Y[Ù][[Y[RY
	ØÛÛ]	ÊK^ÛÛ[]ßB[Ý[ÛÛÜPÛÙJ
^Û]YØ]ÜÛ\Ø\Ü]U^
ËÛÛPÛÙJKØ]Ú


OOßJNßB[Ý[ÛÝ\[Y\
^ÑË[Y\MÜÝÜ[Y\
NØÛÛÝ[YØÝ[Y[Ù][[Y[RY
	Ý[Y\Y[	ÊNÑË[Y\O\Ù][\[


OOÑË[Y\KNÙ[^ÛÛ[QË[Y\Ù[Û\ÜÓ[YOIÝ[Y\ÊÊË[Y\LMOÉÈØ\ÎÉÊNÚYË[Y\L
^ÜÝÜ[Y\
NÚYËÛOOOIÙÝY\Ý	ÉË\ÙOOOIÜÙYZÚ[ÉÊ^ÚYËY[[X\ÐZ[[ÊËY[	ÙÝ[	ÊNÜÚÝÑ[
	ÙÝY\Ý	Ë[ÙK
Nß__KL
NßB[Ý[ÛÝÜ[Y\
^ÚYË[Y\J^ØÛX\[\[
Ë[Y\JNÑË[Y\O[[ß_B\Þ[È[Ý[ÛÙ[Ú]

^ØÛÛÝ[YØÝ[Y[Ù][[Y[RY
	ØÚ]Z[	ÊNØÛÛÝZ[[YK[J
NÚY]
\]\ØYÚ]
Ë[YK
NØ]ØZ]Ù[][
ÝØÚ]	ËÛNË[YK^JNÚ[[YOIÉÎßB[Ý[ÛYÚ]
ÛK^
^ØÛÛÝÞYØÝ[Y[Ù][[Y[RY
	ØÚ]Y[	ÊNØÛÛÝ[YØÝ[Y[ÜX]Q[[Y[
	Ù]ÊNÙ[Û\ÜÓ[YOIØÚ][\ÙÉÎÙ[[\SIÏÜ[Û\ÜÏHÚ×ÊÙÛJÉÎÜÜ[	ÊÝ^ØÞ\[Ú[
[
NØÞØÜÛÜXÞØÜÛZYÚßB\Þ[È[Ý[ÛØ]TØÛÜJ
^ÚYQË[Y_Ë^TØÛÜOOOL
\]\Ø]ØZ]ØÛJ	ÛXY\Ø\	ÊK\Ù\
Ü^Y\Û[YNË[YKØÛÜNË^TØÛÜK\]YØ]]È]J
KÒTÓÔÝ[Ê
_KÛÛÛÛXÝÜ^Y\Û[YIßJNÛØY
NßB\Þ[È[Ý[ÛØY
^Ú[]Ð
NØÛÛÝÙ]_OX]ØZ]ØÛJ	ÛXY\Ø\	ÊKÙ[XÝ
	Ü^Y\Û[YKØÛÜIÊKÜ\	ÜØÛÜIËÈ\ØÙ[[Î[Ù_JK[Z]
JNØÛÛÝÙOYØÝ[Y[Ù][[Y[RY
	ÛXÙIÊNÚYY]_Y]K[Ý
^ÝÙK[\SIÏÛÛÜ[HÈÛ\ÜÏH[\KXÙ[¶a6)È6b¶b6+6+È6*6b¶)öa¶)ö*6*6.v+ÏÝÝÎÜ]\ß]ÙK[\SY]KX\

KJOOÈü(tr><td>'+(i+1)+'</td><td>'+e.player_name+'</td><td>'+e.score+'</td></tr>').join('');}
function initThreeJS(){const container=document.getElementById('city-canvas');if(!container||container.querySelector('canvas'))return;if(!window.THREE){return setTimeout(initThreeJS,500);}scene=new THREE.Scene();scene.background=new THREE.Color(0x0f172a);scene.fog=new THREE.Fog(0x0f172a,250,700);camera=new THREE.PerspectiveCamera(55,container.clientWidth/container.clientHeight,1,2000);camera.position.set(130,110,130);camera.lookAt(0,0,0);renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(container.clientWidth,container.clientHeight);renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.shadowMap.enabled=true;container.appendChild(renderer.domElement);scene.add(new THREE.AmbientLight(0xffffff,0.9));const sun=new THREE.DirectionalLight(0xfff7ed,1.2);sun.position.set(200,400,100);sun.castShadow=true;scene.add(sun);raycaster=new THREE.Raycaster();mouse=new THREE.Vector2();cityGroup=new THREE.Group();scene.add(cityGroup);generateCity();setupCityInteraction(container);animateCity();window.addEventListener('resize',()=>{if(!container||!renderer)return;camera.aspect=container.clientWidth/container.clientHeight;camera.updateProjectionMatrix();renderer.setSize(container.clientWidth,container.clientHeight);});}
function generateCity(){selectableBuildings=[];cars=[];while(cityGroup.children.length>0)cityGroup.remove(cityGroup.children[0]);const size=200,grid=50;const ground=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshStandardMaterial({color:0x14532d}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;cityGroup.add(ground);for(let i=-size;i<=size;i+=grid){addRoad(new THREE.Vector3(0,0.02,i),size*2,14,true);addRoad(new THREE.Vector3(i,0.02,0),size*2,14,false);}let idx=0;for(let x=-size+grid/2;x<size;x+=grid){for(let z=-size+grid/2;z<size;z+=grid){const r=Math.random(),id='b'+idx++;if(r<0.09)addSpecial(x,z,grid*0.75,BTYPEH.HOSPITAL,id);else if(r<0.18)addSpecial(x,z,grid*0.75,BTYPEH.SCHOOL,id);else if(r<0.27)addSpecial(x,z,grid*0.8,BTYPEQ.FACTORY,id);else if(r<0.36)addSpecial(x,z,grid*0.75,BTYPES.MALL,id);else if(r<0.44)addSpecial(x,z,grid*0.7,BTYPEH.MOSQUEd;else if(r<0.68)addTower(x,z,grid*0.6,id);else addHouses(x,z,grid*0.7,id);}}}
function addRoad(pos,length,width,isH){const mesh=new THREE.Mesh(new THREE.PlaneGeometry(isH?length:width,isH?width:length),new THREE.MeshStandardMaterial({color:0x1e293b}));mesh.rotation.x=-Math.PI/2;mesh.position.copy(pos);mesh.receiveShadow=true;cityGroup.add(mesh);for(let i=0;i<2;i++)spawnCar(pos,isH);}
function addSpecial(x,z,size,type,id){const h=type===BTYPES.FACTORY?14:20;const grp=new THREE.Group();grp.userData={id,nameAr:type.nameAr,origColor:type.color,marked:false};const mat=new THREE.MeshStandardMaterial({color:type.color});const body=new THREE.Mesh(new THREE.BoxGeometry(size,h,size),mat);body.position.y=h/2;
body.castShadow=true;body.userData={selId:id};grp.add(body);selectableBuildings.push({mesh:body,id,nameAr:type.nameAr,grp});const acc=new THREE.Mesh(new THREE.BoxGeometry(size+0.5,2,size+0.5),new THREE.MeshStandardMaterial({color:type.accent}));acc.position.y=h-1;grp.add(acc);if(type===BTYPES.FACTORY){const ch=new THREE.Mesh(new THREE.CylinderGeometry(1.5,2,8),new THREE.MeshStandardMaterial({color:0x334155}));ch.position.set(size/3,h+4,size/3);grp.add(ch);}if(type===BTYPES.MOSQUE){const dome=new THREE.Mesh(new THREE.SphereGeometry(size/4,8,8),new THREE.MeshStandardMaterial({color:0xY¢d700}));dome.position.set(0,h+size/4,0);grp.add(dome);}grp.position.set(x,0,z);cityGroup.add(grp);}
function addTower(x,z,size,id){const h=40+Math.random()*80;const grp=new THREE.Group();grp.userData={id,nameAr:'Ø¨Ø±Ø¬ Ø³ÙÙÙ',origColor:0x334155,marked:false};const mat=new THREE.MeshStandardMaterial({color:0x334155});const body=new THREE.Mesh(new THREE.BoxGeometry(size,h,size),mat);body.position.y=h/2;body.castShadow=true;body.userData={selId:id};grp.add(body);selectableBuildings.push({mesh:body,id,nameAr:'Ø¨Ø±Ø¬ Ø³ÙÙÙ',grp});const glass=new THREE.Mesh(new THREE.BoxGeometry(size+0.2,h*0.9,size+0.2),new THREE.MeshPhysicalMaterial({color:0x60a5fa,transmission:0.3,thickness:1}));glass.position.y=h/2;grp.add(glass);grp.position.set(x,0,z);cityGroup.add(grp);}
function addHouses(x,z,size,baseId){const sub=size/2.5;let i=0;for(let a=-1;a<=1;a+=2){for(let b2=-1;b2<=1;b2+=2){const hx=x+a*sub,hz=z+b2*sub,h=6+Math.random()*4,id=baseId+'_'+i?+;const grp=new THREE.Group();grp.userData={id,nameAr:'ÙÙØ²Ù Ø³ÙÙÙ',origColor:0xTb5f9,marked:false};const mat=new THREE.MeshStandardMaterial({color:0xf1f5f9});const house=new THREE.Mesh(new THREE.BoxGeometry(8,h,8),mat);house.position.y=h/2;house.castShadow=true;house.userData={selId:id};grp.add(house);selectableBuildings.push({mesh:house,id,nameAr:'ÙÙÙ²Ù Ø³ÙÙÙ',grp});const roof=new THREE.Mesh(new THREE.BoxGeometry(9,1,9),new THREE.MeshStandardMaterial({color:0x991b1b}));roof.position.y=h;grp.add(roof);grp.position.set(hx,0,hz);cityGroup.add(grp);}}}
function spawnCar(pos,isH){const grp=new THREE.Group();const col=[0x3b82f6,0xef4444,0x10b981,0xffffff][Math.floor(Math.random()*4)];grp.add(new THREE.Mesh(new THREE.BoxGeometry(1.5,1,3),new THREE.MeshStandardMaterial({color:col})));const lane=Math.random()>0.5?3.5:-3.5;if(isH){grp.position.set((Math.random()-0.5)*400,0.6,pos.z+lane);grp.rotation.y=Math.PI/2;}else{grp.position.set(pos.x+lane,0.6,(Math.random()-0.5)*400);}cars.push({mesh:grp,horizontal:isH,speed:.03+Math.random()*0.4)*(lane>0?1:-1)});cityGroup.add(grp);}
function setupCityInteraction(container){container.addEventListener('mousedown',e=>{isMouseDown=true;lastMX=e.clientX;lastMY=e.clientY;});container.addEventListener('mouseup',e=>{if(Math.abs(e.clientX-lastMX)<6&&Math.abs(e.clientY-lastMY)<6)onCityClick(e,container);isMouseDown=false;});container.addEventListener('mousemove',e=>{if(isMouseDown){targetRotY+=e.movementX*0.005;targetRotX+=e.movementY*0.005;}else onCityHover(e,container);});container.addEventListener('wheel',e=>{camera.position.multiplyScalar(1+e.deltaY*0.001);const d=camera.position.length();if(d<40)camera.position.normalize().multiplyScalar(40);if(d>500)camera.position.normalize().multiplyScalar(500);});let lTX=0,lTY=0,tS=0;container.addEventListener('touchstart',e=>{lTX=e.touches[0].clientX;lTY=e.touches[0].clientY;tS=Date.now();});container.addEventListener('touchmove',e=>{targetRotY+=(e.touches[0].clientX-lTX)*0.005;targetRotX+=(e.touches[0].clientY-lTY)*0.005;lTX=e.touches[0].clientX;lTY=e.touches[0].clientY;e.preventDefault();},{passive:false});container.addEventListener('touchend',e=>{if(Date.now()-tS<250&onCityClick(e.changedTouches[0],container);});}
function getHit(event,container){const rect=container.getBoundingClientRect();mouse.x=((event.clientX-rect.left)/container.clientWidth)*2-1;mouse.y=-((event.clientY-rect.top)/container.clientHeight)*2+1;raycaster.setFromCamera(mouse,camera);const hits=raycaster.intersectObjects(selectableBuildings.map(b=>b.mesh));if(hits.length)return selectableBuildings.find(b=>b.mesh===hits[0].object);return null;}
function onCityHover(event,container){const b=getHit(event,container);if(highlightedMesh){const prev=selectableBuildings.find(x=>{.mesh===highlightedMesh);if(prev&&!prev.grp.userData.marked&&prev.id!==G.selected)highlightedMesh.material.color.setHexprev.grp.userData.origColor);highlightedMesh=null;}if(b&&!b.grp.userData.marked){b.mesh.material.color.setHex(0xffd700);highlightedMesh=b.mesh;container.style.cursor='pointer';}else container.style.cursor='grab';}
function onCityClick(event,container){const b=getHit(event,container);if(!b)return;const canHide=G.role==='host'&&G.phase==='hiding';const canGuess=G.role==='guest'&&G.phase==='seeking'&&G.attempts>0;if(!canHide&&!canGuess)return;if(G.selected&&G.selected!==b.id){const prev=selectableBuildings.find(x=>x.id===G.selected);if(prev&&!(prev.grp.userData.marked)prev.mesh.material.color.setHex(prev.grp.userData.origColor);}G.selected=b.id;b.mesh.material.color.setHex(0x00ff88);setStatus('Ø§Ø®ØªØ±Øª: '+b.nameAr);if(canHide)document.getElementById('btn-hide').disabled=false;else document.getElementById('btn-guess').disabled=false;}
function markBuilding(id,state){const b=selectableBuildings.find(x=>x.id===id);if(!b)return;b.grp.userData.marked=true;b.mesh.material.color.setHex( state==='found'?0xfac775:0xe24b4a);}
function resetBuildingColors(){selectableBuildings.forEach(b=>{b.grp.userData.marked=false;b.mesh.material.color.setHex(b.grp.userData.origColor);});G.selected=null;}
function animateCity(){requestAnimationFrame(animateCity);if(!renderer||!scene||!camera)return;cityGroup.rotation.y+=(targetRotY-cityGroup.rotation.y)*0.08;cityGroup.rotation.x+=(targetRotX-cityGroup.rotation.x)*0.08;cityGroup.rotation.x=Math.max(0.05,Math.min(cityGroup.rotation.x,1.2));cars.forEach(c=>{if(c.horizontal){c.mesh.position.x+=c.speed;if(Math.abs(c.mesh.position.x)>300)c.mesh.position.x*=-1;}else{c.mesh.position.z+=c.speed;if(Math.abs(c.mesh.position.z)>300)c.mesh.position.z*=-1;}});renderer.render(scene,camera);}
loadLB();
