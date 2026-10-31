import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGuesses } from '../rules.mjs';
import { createGameServer } from '../server.mjs';

test('target calculation, full precision scoring, shared closest bonuses and capped targets',()=>{
  const round=resolveGuesses({a:{choice:20},b:{choice:40},c:{choice:60}},2/3);
  assert.equal(round.average,40);assert.ok(Math.abs(round.target-40*2/3)<1e-10);assert.deepEqual(round.winners,['a']);assert.equal(round.results.a.earned,1117);
  const tie=resolveGuesses({a:{choice:20},b:{choice:40}},1);assert.deepEqual(tie.winners,['a','b']);assert.equal(tie.results.a.earned,1050);assert.equal(tie.results.b.earned,1050);
  const cap=resolveGuesses({a:{choice:100},b:{choice:100}},4/3);assert.equal(cap.target,100);assert.equal(cap.results.a.earned,1250);
  assert.equal(resolveGuesses({a:{choice:40}},2/3).valid,false);assert.equal(resolveGuesses({},2/3).valid,false);
});

test('private guesses, number reuse prevention, synchronized reveals, missed choices and rematch',async t=>{
  const server=createGameServer({roundMs:650,revealMs:100,countdownMs:50,rounds:3});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.shutdown());
  const base='http://127.0.0.1:'+server.address().port;
  const post=async(action,data)=>{const r=await fetch(base+'/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return{status:r.status,data:await r.json()};};
  const a=(await post('join',{create:true,name:'Ada'})).data,b=(await post('join',{code:a.code,name:'Bo'})).data;
  assert.equal((await post('start',a)).status,409);
  const feed=async(session)=>{const controller=new AbortController(),states=[];const response=await fetch(base+'/api/events?'+new URLSearchParams(session),{signal:controller.signal});assert.equal(response.status,200);const reader=response.body.getReader();const task=(async()=>{let text='';const decoder=new TextDecoder();for(;;){const r=await reader.read();if(r.done)break;text+=decoder.decode(r.value,{stream:true});let i;while((i=text.indexOf('\n\n'))>=0){const message=text.slice(0,i);text=text.slice(i+2);if(message.startsWith('data: '))states.push(JSON.parse(message.slice(6)));}}})().catch(()=>{});t.after(()=>{controller.abort();return task;});return{states,controller};};
  const fa=await feed(a),fb=await feed(b);
  const waitFor=async(states,pred)=>{const limit=Date.now()+6000;while(Date.now()<limit){const found=states.find(pred);if(found)return found;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out waiting for state');};
  assert.equal((await post('start',b)).status,403);assert.equal((await post('state',{...a,token:'forged'})).status,401);
  assert.equal((await post('start',a)).status,200);
  const first=await waitFor(fa.states,s=>s.phase==='round'&&s.round===1),same=await waitFor(fb.states,s=>s.phase==='round'&&s.round===1);
  assert.deepEqual(first.challenge,same.challenge);assert.equal(first.deadline,same.deadline);assert.equal(first.challenge.factor,2/3);
  for(const choice of [-1,101,1.5,'20'])assert.equal((await post('answer',{...a,round:1,choice})).status,400);
  assert.equal((await post('answer',{...a,round:1,choice:20})).status,200);
  assert.equal((await post('answer',{...a,round:1,choice:25})).status,409);
  const secret=(await post('state',b)).data;assert.equal(secret.myAnswer,null);assert.deepEqual(secret.myUsed,[]);assert.equal(secret.outcome,null);assert.equal(secret.players.find(p=>p.id===a.id).result,null);
  assert.equal((await post('answer',{...b,round:1,choice:40})).status,200);
  const c=(await post('join',{code:a.code,name:'Cy'})).data;const fc=await feed(c);
  assert.equal((await post('answer',{...c,round:1,choice:30})).status,403);
  const result=await waitFor(fa.states,s=>s.phase==='reveal'&&s.round===1);
  assert.equal(result.outcome.target,20);assert.equal(result.players.find(p=>p.id===a.id).score,1250);assert.equal(result.players.find(p=>p.id===b.id).score,600);
  await waitFor(fa.states,s=>s.phase==='round'&&s.round===2);
  assert.equal((await post('answer',{...a,round:1,choice:21})).status,409);
  assert.equal((await post('answer',{...a,round:2,choice:20})).status,409,'used numbers cannot be repeated');
  assert.equal((await post('answer',{...a,round:2,choice:60})).status,200);assert.equal((await post('answer',{...b,round:2,choice:90})).status,200);
  const second=await waitFor(fa.states,s=>s.phase==='reveal'&&s.round===2);assert.equal(second.outcome.target,100);assert.deepEqual(second.outcome.winners,[b.id]);
  const end=await waitFor(fa.states,s=>s.phase==='finished');assert.equal(end.history.length,3);assert.equal(end.history[2].valid,false);assert.equal(end.players.find(p=>p.id===a.id).result.missed,true);
  fa.controller.abort();await waitFor(fb.states,s=>s.phase==='finished'&&s.hostId===b.id);
  assert.equal((await post('start',b)).status,200);const replay=await waitFor(fc.states,s=>s.phase==='countdown');assert.equal(replay.players.filter(p=>p.playing).length,2);assert.deepEqual(replay.myUsed,[]);assert.ok(replay.players.every(p=>p.score===0));
  assert.equal((await fetch(base+'/health')).status,200);assert.equal((await fetch(base+'/rules.mjs')).status,404);
});
