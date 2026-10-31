import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { MODES, resolveGuesses } from './rules.mjs';

const COLORS = ['#8cdbcc','#a9b6e8','#dbaf8b','#c4a8d4','#b6c98c','#d48fa2','#89bace','#c9be9f'];
const AVATARS = ['🪩','🛼','🌵','🍒','🪁','🧃','🦋','🛸'];
const PUBLIC = new URL('./public/', import.meta.url);
const random = list => list[randomInt(list.length)];

export function createGameServer({ roundMs = 20000, revealMs = 6500, countdownMs = 3000, rounds = 8 } = {}) {
  const rooms = new Map();
  const streams = new Set();
  const ipRates = new Map();
  const timers = new Set();
  const later = (fn, ms) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer; };
  const cancel = timer => { clearTimeout(timer); timers.delete(timer); };
  const online = p => p.streams.size > 0;
  const players = room => [...room.players.values()];
  function host(room) {
    if (!online(room.players.get(room.hostId) || { streams: new Set() })) {
      room.hostId = players(room).find(online)?.id || room.hostId;
    }
  }
  function snapshot(room, me) {
    return {
      code: room.code, phase: room.phase, round: room.round, totalRounds: rounds,
      hostId: room.hostId, me: me.id, now: Date.now(), deadline: room.deadline,
      roundMs,
      players: players(room).map(p => ({ id: p.id, name: p.name, avatar: p.avatar, color: p.color,
        score: p.score, streak: p.streak, online: online(p), playing: room.roster.includes(p.id),
        answered: !!room.answers[p.id], result: room.phase === 'reveal' || room.phase === 'finished' ? room.results[p.id] || null : null })),
      challenge: room.phase === 'round' || room.phase === 'reveal' ? room.challenge : null,
      answer: room.phase === 'reveal' ? room.answer : null,
      myAnswer: room.answers[me.id]?.choice ?? null,
      myUsed:me.used,
      outcome:room.phase==='reveal'||room.phase==='finished'?room.outcome||null:null,
      history: room.history,
    };
  }
  function broadcast(room) {
    room.touched = Date.now();
    for (const p of players(room)) for (const stream of p.streams) {
      try { stream.write(`data: ${JSON.stringify(snapshot(room, p))}\n\n`); } catch { p.streams.delete(stream); }
    }
  }
  function beginRound(room) {
    room.phase = 'round'; room.round++; room.answers = {}; room.results = {};
    room.answer = null; room.outcome=null;
    room.challenge = MODES[(room.round-1)%MODES.length];
    room.startedAt = Date.now(); room.deadline = room.startedAt + roundMs;
    broadcast(room);
    room.timer = later(() => reveal(room), roundMs);
  }
  function reveal(room) {
    if (room.phase !== 'round') return;
    cancel(room.timer); room.phase = 'reveal';
    room.outcome=resolveGuesses(room.answers,room.challenge.factor);
    room.answer=room.outcome.valid?room.outcome.target:null;
    for (const id of room.roster) {
      const p = room.players.get(id), a = room.answers[id];
      const r=room.outcome.results[id];
      const correct = !!r?.winner;
      p.streak = correct ? p.streak + 1 : 0;
      const earned = r?.earned||0;
      p.score += earned;
      room.results[id] = { ...r,correct,earned,choice:a?.choice??null,missed:!a,void:!room.outcome.valid };
    }
    room.history.push({round:room.round,mode:room.challenge.name,label:room.challenge.label,factor:room.challenge.factor,average:room.outcome.average,target:room.outcome.target,valid:room.outcome.valid,guesses:Object.fromEntries(Object.entries(room.answers).map(([id,a])=>[id,a.choice]))});
    room.deadline = Date.now() + revealMs; broadcast(room);
    room.timer = later(() => {
      if (room.round >= rounds) { room.phase = 'finished'; room.deadline = 0; host(room); broadcast(room); }
      else beginRound(room);
    }, revealMs);
  }
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const fail = (status, message) => Object.assign(new Error(message), { status });
  function authenticate(body) {
    const room = rooms.get(String(body.code || '').toUpperCase());
    const player = room?.players.get(body.id);
    if (!room || !player || player.token !== body.token) throw fail(401, 'Room session expired. Join again.');
    return { room, player };
  }
  async function api(req, res, url) {
    if (url.pathname === '/api/events') {
      const { room, player } = authenticate(Object.fromEntries(url.searchParams));
      if (player.streams.size >= 4) throw fail(429, 'Too many open tabs for this player. Close an older tab.');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 1500\n\n'); player.streams.add(res); streams.add(res); host(room); broadcast(room);
      req.on('close', () => { player.streams.delete(res); streams.delete(res); host(room); broadcast(room); });
      return;
    }
    if (req.method !== 'POST') throw fail(405, 'Use POST.');
    const ip = req.socket.remoteAddress;
    const rate = ipRates.get(ip) || { time: Date.now(), hits: 0 };
    if (Date.now() - rate.time > 60000) { rate.time = Date.now(); rate.hits = 0; }
    rate.hits++; ipRates.set(ip, rate);
    if (rate.hits > 500) throw fail(429, 'Slow down a little and try again.');
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 5000) throw fail(413, 'Request too large.'); }
    let body; try { body = JSON.parse(raw); } catch { throw fail(400, 'Invalid request.'); }
    if (url.pathname === '/api/join') {
      const name = String(body.name || '').trim().slice(0, 18);
      if (!name) throw fail(400, 'Give yourself a nickname first.');
      let room;
      if (body.create) {
        if (rooms.size >= 500) throw fail(503, 'The party is full. Try again soon.');
        let code; do { code = Array.from({ length: 5 }, () => random('ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.split(''))).join(''); } while (rooms.has(code));
        room = { code, hostId: null, phase: 'lobby', round: 0, deadline: 0, players: new Map(), roster: [], answers: {}, results: {}, history: [], touched: Date.now() };
        rooms.set(code, room);
      } else {
        room = rooms.get(String(body.code || '').trim().toUpperCase());
        if (!room) throw fail(404, 'That room does not exist. Check the code or create a new room.');
      }
      if (room.players.size >= 8) throw fail(409, 'All 8 spots are taken. Ask the host to make a new room.');
      const used = players(room).map(p => p.avatar);
      const player = { id: randomUUID(), token: randomUUID(), name,
        avatar: AVATARS.find(a => !used.includes(a)), color: COLORS.find(c=>!players(room).some(p=>p.color===c)), used:[], score: 0, streak: 0, streams: new Set() };
      room.players.set(player.id, player); room.hostId ||= player.id; broadcast(room);
      return json(res, 200, { code: room.code, id: player.id, token: player.token });
    }
    const { room, player } = authenticate(body);
    if (url.pathname === '/api/state') return json(res, 200, snapshot(room, player));
    if (url.pathname === '/api/start') {
      host(room);
      if (room.hostId !== player.id) throw fail(403, 'Only the host can start the race.');
      if (!['lobby', 'finished'].includes(room.phase)) throw fail(409, 'A race is already running.');
      room.roster = players(room).filter(online).map(p => p.id);
      if (room.roster.length < 2) throw fail(409, 'You need at least 2 connected players.');
      for (const p of players(room)) { p.score = 0; p.streak = 0; p.used=[]; }
      room.round = 0; room.answers = {}; room.results = {}; room.history = [];
      room.phase = 'countdown'; room.deadline = Date.now() + countdownMs; broadcast(room);
      room.timer = later(() => beginRound(room), countdownMs);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/answer') {
      if (room.phase !== 'round' || Date.now() >= room.deadline) throw fail(409, 'This round has closed.');
      if (!room.roster.includes(player.id)) throw fail(403, 'You joined mid-race. You can play the next one.');
      if (body.round !== room.round) throw fail(409, 'That answer belongs to an earlier round.');
      if (room.answers[player.id]) throw fail(409, 'One answer per round. Your first answer is locked.');
      if(!Number.isInteger(body.choice)||body.choice<0||body.choice>100)throw fail(400,'Choose a whole number from 0 to 100.');
      if(player.used.includes(body.choice))throw fail(409,'You already used that number. Choose a new one.');
      room.answers[player.id] = { choice: body.choice };player.used.push(body.choice);
      broadcast(room); return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/leave') {
      if (!['lobby', 'finished'].includes(room.phase)) throw fail(409, 'Wait until the race finishes to leave.');
      for (const stream of player.streams) stream.end();
      room.players.delete(player.id); host(room); broadcast(room);
      return json(res, 200, { ok: true });
    }
    throw fail(404, 'Unknown action.');
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return json(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      const files = { '/': ['index.html','text/html; charset=utf-8'], '/style.css':['style.css','text/css'], '/client.js':['client.js','text/javascript'] };
      const file = files[url.pathname];
      if (!file) return json(res, 404, { error: 'Not found' });
      const data = await readFile(new URL(file[0], PUBLIC));
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' }); res.end(data);
    } catch (error) { if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Server hiccup. Please try again.' }); else res.end(); }
  });
  const heartbeat = setInterval(() => {
    for (const stream of streams) stream.write(': heartbeat\n\n');
    const now = Date.now();
    for (const [code, room] of rooms) if (now - room.touched > 6 * 60 * 60 * 1000 && !players(room).some(online)) { cancel(room.timer); rooms.delete(code); }
    for (const [ip, rate] of ipRates) if (now - rate.time > 60000) ipRates.delete(ip);
  }, 15000);
  heartbeat.unref();
  server.on('close', () => { clearInterval(heartbeat); for (const timer of timers) clearTimeout(timer); });
  server.shutdown = () => { for (const stream of streams) stream.end(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); };
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3400;
  createGameServer().listen(port, '0.0.0.0', () => console.log(`Converge is running at http://localhost:${port}`));
}
