const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeColor=s=>/^#[\da-f]{6}$/i.test(s)?s:'#97cebd';
const format=n=>Number(n).toFixed(1);
const storage={get:k=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch{}},remove:k=>{try{localStorage.removeItem(k);}catch{}}};
let session=null,state=null,stream=null,pending=false,answerPending=false,selected=50,phaseKey='',offset=0,sound=storage.get('converge-sound')!=='off',audio=null,master=null,awake=false,toastTimer,lastCount=0,lastWarning=0;
const times=new Map();
const cues={welcome:[[294,0,.15],[440,.12,.25]],tap:[[440,0,.08]],lock:[[392,0,.1],[587,.08,.2]],join:[[330,0,.1],[494,.1,.2]],count:[[330,0,.13]],reveal:[[440,0,.16],[659,.12,.25]],win:[[440,0,.14],[554,.12,.14],[659,.24,.28]],finish:[[330,0,.13],[440,.12,.13],[554,.24,.13],[659,.36,.4]],warning:[[294,0,.12],[294,.18,.12]],error:[[220,0,.13],[196,.1,.2]]};
function cue(name){if(!sound||!awake||!audio||document.hidden)return;const now=performance.now();if(now-(times.get(name)??-1000)<120)return;times.set(name,now);try{for(const [f,delay,duration] of cues[name]||cues.tap){const at=audio.currentTime+delay,o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(.12,at+.01);g.gain.exponentialRampToValueAtTime(.0001,at+duration);o.connect(g);g.connect(master);o.start(at);o.stop(at+duration+.03);o.onended=()=>{o.disconnect();g.disconnect();};}}catch{}}
async function wake(){if(!sound)return;try{if(!audio){audio=new(window.AudioContext||window.webkitAudioContext)();master=audio.createGain();master.gain.value=.12;master.connect(audio.destination);}await audio.resume();if(!awake){awake=true;cue('welcome');}}catch{}}
function soundControl(){$('sound').textContent=sound?'SOUND ON':'SOUND OFF';$('sound').setAttribute('aria-pressed',String(sound));$('sound').setAttribute('aria-label',sound?'Mute sound':'Enable sound');}
$('sound').onclick=()=>{sound=!sound;storage.set('converge-sound',sound?'on':'off');if(master)master.gain.setTargetAtTime(sound ? 0.12 : 0,audio.currentTime,.03);soundControl();if(sound)wake();};soundControl();
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#sound')){wake();if(e.target.closest('button:not(:disabled)'))cue('tap');}},{capture:true});document.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')wake();},{capture:true});
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3500);}
function show(id){document.querySelectorAll('.view').forEach(el=>el.classList.toggle('hidden',el.id!==id));}
async function request(action,body={},auth=true){const r=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...auth?session:{},...body})});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error||'Please try again.'),{status:r.status});return data;}
function connect(){stream?.close();$('connection').textContent='CONNECTING';stream=new EventSource('/api/events?'+new URLSearchParams(session));stream.onmessage=e=>{const next=JSON.parse(e.data);offset=next.now-Date.now();$('connection').textContent='● COLLECTIVE CONNECTED';render(next);};stream.onerror=()=>{$('connection').textContent='RECONNECTING';};}
async function join(create){if(pending)return;const name=$('nickname').value.trim(),code=$('roomCode').value.trim().toUpperCase();if(!name){$('nickname').focus();$('joinError').textContent='Enter a name to join the collective.';return;}if(!create&&code.length!==5){$('joinError').textContent='Enter the five-character room code.';return;}pending=true;$('joinForm').classList.add('pending');$('joinError').textContent='';try{session=await request('join',{create,name,code},false);storage.set('converge-session',JSON.stringify(session));storage.set('converge-name',name);history.replaceState(null,'','/?room='+session.code);cue('join');connect();}catch(e){$('joinError').textContent=e.message;cue('error');}finally{pending=false;$('joinForm').classList.remove('pending');}}
$('create').onclick=()=>join(true);$('joinForm').onsubmit=e=>{e.preventDefault();join(false);};$('roomCode').oninput=e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z2-9]/g,'');};
async function start(){if(pending)return;pending=true;try{await request('start');}catch(e){toast(e.message);}finally{pending=false;}}
$('start').onclick=start;$('rematch').onclick=start;
async function leave(){try{await request('leave');stream?.close();session=null;state=null;storage.remove('converge-session');history.replaceState(null,'','/');show('home');$('connection').textContent='A GAME OF COLLECTIVE INTUITION';}catch(e){toast(e.message);}}
$('leave').onclick=leave;$('finishLeave').onclick=leave;
async function invite(){try{await navigator.clipboard.writeText(location.origin+'/?room='+state.code);toast('Invitation copied.');cue('lock');}catch{toast('Share room code '+state.code);}}
$('codeButton').onclick=invite;$('copyInvite').onclick=invite;
function rows(list,ranks=false){let rank=0,prev=null;return list.map((p,i)=>{if(p.score!==prev)rank=i+1;prev=p.score;let meta=!p.online?'Reconnecting':p.result?p.result.missed?'No submission':p.result.void?'Round not scored':`${p.result.choice} · ${p.result.winner?'closest · ':''}+${p.result.earned}`:p.answered?'Choice locked':p.playing&&state.phase==='round'?'Considering':p.id===state.hostId?'Host':'Connected';return `<div class="player" style="--owner:${safeColor(p.color)}">${ranks?`<span class="rank">${String(rank).padStart(2,'0')}</span>`:''}<span class="player-orb">${esc(p.name.slice(0,2).toUpperCase())}</span><div class="player-info"><div class="player-name">${esc(p.name)}${p.id===state.me?'<span class="you">YOU</span>':''}</div><div class="player-meta"><span class="status-dot ${p.online?'live':''}"></span>${esc(meta)}</div></div><span class="player-score">${p.totalPoints??p.score.toLocaleString()}</span></div>`;}).join('');}
const sorted=s=>[...s.players].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
function trajectory(list){return list.length?list.map(h=>`<div class="history-item"><small>ROUND ${String(h.round).padStart(2,'0')}</small><b>${h.valid?format(h.target):'—'}</b><span>AVG × ${esc(h.label)}</span></div>`).join(''):'<span class="small">Your collective history starts after the first reveal.</span>';}
function render(next){
  const previous=state,key=next.phase+':'+next.round;
  if(key!==phaseKey){answerPending=false;lastCount=0;lastWarning=0;if(next.phase==='round'){selected=Array.from({length:101},(_,i)=>(i+50)%101).find(n=>!next.myUsed.includes(n));cue('reveal');}if(next.phase==='reveal')cue(next.players.find(p=>p.id===next.me)?.result?.winner?'win':'reveal');if(next.phase==='finished')cue('finish');phaseKey=key;}
  if(previous&&next.phase==='lobby'&&next.players.filter(p=>p.online).length>previous.players.filter(p=>p.online).length)cue('join');
  state=next;const amHost=next.me===next.hostId,count=next.players.filter(p=>p.online).length;
  if(next.phase==='lobby'){show('lobby');$('codeButton').textContent=next.code;$('playerCount').textContent=`${count} / 8 PRESENT`;$('lobbyPlayers').innerHTML=rows(next.players);$('start').disabled=!amHost||count<2;$('hostNote').textContent=amHost?count<2?'Invite at least one more player.':'Start when everyone is ready.':'Your host will start the match.';return;}
  if(next.phase==='finished'){show('finish');const active=sorted(next).filter(p=>p.playing),winners=active.filter(p=>p.score===active[0]?.score);$('winner').textContent=winners.map(p=>p.name).join(' & ')+(winners.length>1?' share first place.':' read the collective best.');$('finalPlayers').innerHTML=rows(sorted(next),true);$('finalHistory').innerHTML=trajectory(next.history);$('rematch').disabled=!amHost||count<2;$('rematchNote').textContent=amHost?'All connected players join. Used numbers and scores reset.':'Your host can start a new match.';return;}
  show('game');$('roundLabel').innerHTML=`Iteration ${String(next.round||1).padStart(2,'0')} <span>/ ${String(next.totalRounds).padStart(2,'0')}</span>`;$('gameCode').textContent=next.code;$('gamePlayers').innerHTML=rows(sorted(next));const players=next.players.filter(p=>p.playing);$('lockedCount').textContent=`${players.filter(p=>p.answered).length}/${players.length} LOCKED`;
  const counting=next.phase==='countdown',me=next.players.find(p=>p.id===next.me),spectator=!me.playing;
  $('countdown').classList.toggle('hidden',!counting);$('roundArea').classList.toggle('hidden',counting);$('spectatorNote').classList.toggle('hidden',!spectator);if(counting)return;
  const c=next.challenge;if(!c)return;$('modeName').textContent=c.name.toUpperCase();$('factorLabel').textContent=c.label;$('modeHint').textContent=c.hint;
  const reveal=next.phase==='reveal';$('choicePanel').classList.toggle('hidden',reveal);$('revealPanel').classList.toggle('hidden',!reveal);$('history').innerHTML=trajectory(next.history);
  if(next.myAnswer!==null)selected=next.myAnswer;
  $('numberInput').value=selected??'';$('numberSlider').value=selected??50;updateChoice();
  if(reveal){const result=me.result,o=next.outcome;$('averageValue').textContent=format(o.average);$('revealFactor').textContent=c.label;$('targetValue').textContent=o.valid?format(o.target):'—';
    const submitted=next.players.filter(p=>p.result?.choice!==null&&p.result?.choice!==undefined);
    $('plot').innerHTML=(o.valid?`<div class="target-line" style="--x:${8+o.target*.84}%" title="Target ${format(o.target)}"></div>`:'')+submitted.map(p=>`<div class="plot-row"><span class="plot-point ${p.result.winner?'winner':''}" style="--x:${8+p.result.choice*.84}%;--owner:${safeColor(p.color)}"><i></i><b>${esc(p.name.slice(0,7))} ${p.result.choice}</b></span></div>`).join('');
    $('resultSummary').textContent=!o.valid?'Fewer than two choices were submitted. This round is not scored.':spectator?'The collective has revealed its choices.':result.missed?'No choice submitted. Zero points this round.':`${result.winner?'Closest to the target. ':''}Your ${result.choice} was ${format(result.distance)} away. +${result.earned} points${result.winner?' including the 250 closest bonus.':'.'}`;
  }
}
function updateChoice(){if(!state)return;const me=state.players.find(p=>p.id===state.me),expired=Date.now()+offset>=state.deadline,locked=state.myAnswer!==null||answerPending||state.phase!=='round'||!me?.playing||expired,valid=Number.isInteger(selected)&&selected>=0&&selected<=100,used=valid&&state.myUsed.includes(selected)&&state.myAnswer===null;
  for(const id of ['numberInput','numberSlider','increase','decrease'])$(id).disabled=locked;
  $('lock').disabled=locked||!valid||used;$('lock').innerHTML=state.myAnswer!==null?'Choice locked <span>✓</span>':answerPending?'Locking choice…':`Lock in ${valid?selected:'a number'} <span>↗</span>`;
  $('choiceState').textContent=state.myAnswer!==null?'LOCKED · WAITING FOR THE REVEAL':'PRIVATE UNTIL REVEAL';
  $('selectionNote').textContent=!me?.playing?'Observing this match.':state.myAnswer!==null?'Your number is saved. Take a moment to read the group.':!valid?'Choose a whole number from 0 to 100.':used?'You already used this number. Choose another.':'No speed bonus. Your first locked choice is final.';
  $('usedNumbers').innerHTML=state.myUsed.length?state.myUsed.map(n=>`<span>${n}</span>`).join(''):'None yet';
}
function setNumber(n){selected=n;$('numberInput').value=n??'';if(n!==null)$('numberSlider').value=Math.min(100,Math.max(0,n));updateChoice();}
$('numberInput').oninput=e=>{selected=e.target.value===''?null:Number(e.target.value);if(Number.isFinite(selected))$('numberSlider').value=Math.min(100,Math.max(0,selected));updateChoice();};
$('numberSlider').oninput=e=>setNumber(Number(e.target.value));$('decrease').onclick=()=>setNumber(Math.max(0,(selected??50)-1));$('increase').onclick=()=>setNumber(Math.min(100,(selected??50)+1));
$('lock').onclick=async()=>{if(answerPending||state.myAnswer!==null||$('lock').disabled)return;answerPending=true;updateChoice();try{await request('answer',{round:state.round,choice:selected});cue('lock');}catch(e){answerPending=false;toast(e.message);cue('error');try{render(await request('state'));}catch{updateChoice();}}};
setInterval(()=>{if(!state)return;const ms=Math.max(0,state.deadline-Date.now()-offset),sec=Math.ceil(ms/1000);$('timeLeft').textContent=state.phase==='round'?String(sec):state.phase==='countdown'?'…':'✓';document.querySelector('.timer').classList.toggle('urgent',state.phase==='round'&&sec<=5);if(state.phase==='countdown'){const n=Math.max(1,sec);$('countdownNumber').textContent=n;if(n!==lastCount){lastCount=n;cue('count');}}if(state.phase==='round'&&sec===5&&lastWarning!==sec){lastWarning=sec;cue('warning');}if(state.phase==='round'&&sec===0)updateChoice();},100);
window.addEventListener('online',()=>{if(session)connect();});window.addEventListener('offline',()=>{$('connection').textContent='OFFLINE';});
async function boot(){const code=new URLSearchParams(location.search).get('room');$('nickname').value=storage.get('converge-name')||'';if(code)$('roomCode').value=code.toUpperCase().slice(0,5);try{const saved=JSON.parse(storage.get('converge-session'));if(saved&&(!code||saved.code===code.toUpperCase())){session=saved;render(await request('state'));connect();}}catch(e){storage.remove('converge-session');session=null;show('home');if(e.status!==401)toast('Your session could not reconnect. You can join again.');}}
function setupHomepageDemo(){
  const box=$('homepageDemo'),pause=$('demoPause');if(!box)return;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const samples=[
    {values:[20,40,60],factor:2/3,label:'⅔'},
    {values:[40,60,80],factor:4/3,label:'4/3'},
    {values:[25,35,75],factor:.8,label:'0.8'},
    {values:[30,50,70],factor:1.2,label:'1.2'},
  ];
  const people=[{name:'YOU',color:'#97cebd'},{name:'MIRA',color:'#a9b6e8'},{name:'ELI',color:'#dbaf8b'}];
  const svgNS='http://www.w3.org/2000/svg';
  const dotNodes=people.map(p=>{
    const group=document.createElementNS(svgNS,'g');group.classList.add('demo-number-dot');
    const halo=document.createElementNS(svgNS,'circle');halo.setAttribute('cy','61');halo.setAttribute('r','12');halo.setAttribute('fill','none');halo.setAttribute('stroke',p.color);halo.setAttribute('stroke-opacity','.25');halo.classList.add('demo-dot-halo');
    const dot=document.createElementNS(svgNS,'circle');dot.setAttribute('cy','61');dot.setAttribute('r','5');dot.setAttribute('fill',p.color);
    const label=document.createElementNS(svgNS,'text');label.setAttribute('y','83');label.setAttribute('text-anchor','middle');label.style.fill=p.color;
    group.append(halo,dot,label);$('demoDots').appendChild(group);return{group,halo,dot,label};
  });
  $('demoPlayers').innerHTML=people.map((p,i)=>`<div class="demo-player" id="demoPlayer${i}"><small>${p.name}<span class="demo-status" id="demoStatus${i}">CHOOSING</span></small><b id="demoValue${i}">••</b></div>`).join('');
  let elapsed=0,cycle=0,paused=false,inView=true,raf=0,last=0,lastPaint=-100;
  const clamp=n=>Math.max(0,Math.min(1,n));
  const ease=n=>1-Math.pow(1-clamp(n),3);
  function paint(t){
    const sample=samples[cycle%samples.length],average=sample.values.reduce((a,b)=>a+b,0)/3,target=Math.min(100,average*sample.factor);
    const distance=Math.min(...sample.values.map(n=>Math.abs(n-target))),winners=sample.values.map((n,i)=>Math.abs(Math.abs(n-target)-distance)<1e-8?i:-1).filter(i=>i>=0);
    const stage=t<3200?0:t<5000?1:t<7000?2:3;
    box.dataset.stage=String(stage);$('demoStage').textContent=['01 / CHOOSE IN SECRET','02 / REVEAL THE COLLECTIVE','03 / CALCULATE THE TARGET','04 / CLOSEST TO THE TARGET'][stage];$('demoRound').textContent='ROUND '+String(cycle%samples.length+1).padStart(2,'0');$('demoFactor').textContent=sample.label;
    people.forEach((p,i)=>{
      const locked=t>[650,1400,2200][i],winner=stage===3&&winners.includes(i);
      $('demoPlayer'+i).classList.toggle('locked',locked);$('demoPlayer'+i).classList.toggle('closest',winner);$('demoStatus'+i).textContent=winner?'CLOSEST':stage>0?'REVEALED':locked?'LOCKED ✓':'CHOOSING';$('demoValue'+i).textContent=stage>0?String(sample.values[i]):'••';
      const x=24+sample.values[i]*4.32,nodes=dotNodes[i];nodes.dot.setAttribute('cx',String(x));nodes.halo.setAttribute('cx',String(x));nodes.label.setAttribute('x',String(x));nodes.label.textContent=String(sample.values[i]);nodes.group.style.opacity=String(stage>0?clamp((t-3200-i*160)/350):0);nodes.halo.style.opacity=winner?'1':'0';
    });
    const avgProgress=ease((t-3500)/1000),targetProgress=ease((t-5000)/1300),displayTarget=average+(target-average)*targetProgress;
    $('demoAverage').textContent=stage>0?format(average*avgProgress):'—';$('demoTarget').textContent=stage>=2?format(displayTarget):'—';
    $('demoTargetGroup').setAttribute('opacity',String(stage>=2?clamp((t-5000)/300):0));
    const tx=24+displayTarget*4.32;for(const attr of ['x1','x2'])$('demoTargetLine').setAttribute(attr,String(tx));$('demoTargetLabel').setAttribute('x',String(Math.max(50,Math.min(430,tx))));$('demoTargetLabel').textContent='TARGET '+format(displayTarget);
    const captions=['Everyone locks in a private number.','All three choices are revealed together.',`Average ${format(average)} × ${sample.label}. Think beyond the group.`,winners.length>1?`${winners.map(i=>people[i].name).join(' & ')} tie. Both receive the closest bonus.`:`${people[winners[0]].name} is ${format(distance)} away. Closest wins the bonus.`];
    $('demoCaption').textContent=captions[stage];
    const points=Math.max(0,Math.round(1000-20*distance))+250;
    $('demoPoints').textContent=stage===3?'+'+Math.round(points*ease((t-7000)/650)).toLocaleString()+(winners.length>1?' EACH':' PTS'):'';
    $('demoProgress').style.width=t/13000*100+'%';
  }
  function active(){return !motion.matches&&!paused&&inView&&!document.hidden&&!$('home').classList.contains('hidden');}
  function frame(stamp){raf=0;if(!active()){last=0;return;}const delta=last?Math.min(100,stamp-last):0;last=stamp;elapsed+=delta;if(elapsed>=13000){elapsed=0;cycle++;lastPaint=-100;}if(elapsed-lastPaint>=40){paint(elapsed);lastPaint=elapsed;}raf=requestAnimationFrame(frame);}
  function sync(){if(raf){cancelAnimationFrame(raf);raf=0;}last=0;if(motion.matches){paint(11000);pause.disabled=true;pause.textContent='STILL PREVIEW';pause.setAttribute('aria-label','Static gameplay preview: reduced motion enabled');}else{pause.disabled=false;pause.textContent=paused?'▶ PLAY':'Ⅱ PAUSE';pause.setAttribute('aria-label',paused?'Play gameplay preview':'Pause gameplay preview');if(active())raf=requestAnimationFrame(frame);}pause.setAttribute('aria-pressed',String(paused));}
  pause.onclick=()=>{paused=!paused;sync();};
  motion.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
  new MutationObserver(sync).observe($('home'),{attributes:true,attributeFilter:['class']});
  if('IntersectionObserver' in window)new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;sync();},{threshold:.15}).observe(box);
  paint(motion.matches?11000:0);sync();
}
setupHomepageDemo();
boot();
