'use strict';

// Prefixo dos IDs no servidor público de sinalização do PeerJS (evita colidir com outros apps).
// Se um dia a conversa entre os apps mudar de um jeito incompatível, troque o "v1" — versões
// antigas deixam de achar as salas novas (e a atualização automática resolve isso ao abrir).
const PREFIX = 'screenplay-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// hint 'detail' = segura a resolução. ('motion' derrubava 1080p60 para 640x360 enquanto a banda subia.)
const QUALITY = {
  '720-30':  { w: 1280, h: 720,  fps: 30, bitrate: 3000000,  hint: 'detail' },
  '1080-30': { w: 1920, h: 1080, fps: 30, bitrate: 6000000,  hint: 'detail' },
  '1080-60': { w: 1920, h: 1080, fps: 60, bitrate: 10000000, hint: 'detail' },
};
const ICON = {
  vol:  '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/>',
  fs:   '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
};
const svg = (paths, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const $ = (id) => document.getElementById(id);
const IS_APP = !!window.tav;   // rodando dentro do app de Windows (Electron)
const canShare = IS_APP ||
  (!!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && window.isSecureContext);

const S = {
  peer: null, myId: '', myName: '', code: '', isHost: false,
  busy: false, leaving: false, joining: null,
  hostConn: null,         // convidado -> anfitrião
  conns: new Map(),       // anfitrião: id -> DataConnection
  roster: new Map(),      // anfitrião: lista oficial da sala
  view: new Map(),        // todos: última lista recebida
  viewReady: false,
  localStream: null, seq: 0, quality: QUALITY['1080-30'],
  audioMode: 'none',      // 'system' (PC sem Discord) | 'app' (só a janela) | 'loopback' (PC inteiro) | 'none'
  watchers: new Set(),    // quem já está assistindo minha transmissão atual
  encoder: 'gpu',         // escolha: 'gpu' (placa de vídeo, H.264) | 'cpu' (processador, VP8)
  encoderUsed: null,      // o que o navegador realmente está usando: 'gpu' | 'cpu'
  outCalls: new Map(),    // id -> { call, seq }  (quem está recebendo minha tela)
  tiles: new Map(),       // id -> tile  (telas que estou assistindo)
};

// ---------------- utilidades ----------------
function randCode(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
const normCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const cleanName = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Anônimo';
const hostId = () => PREFIX + S.code;
const nameOf = (id) => (S.view.get(id) || {}).name || 'Alguém';
function colorOf(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(0 0% ${22 + (h % 21)}%)`;   // tons de cinza, com o texto branco legível
}
function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, val);
  } catch { /* sem armazenamento: tudo bem */ }
  return null;
}

function toast(text, kind = '', ms = 4000) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}
function homeMsg(text, isErr) {
  const el = $('homeMsg');
  el.textContent = text || '';
  el.classList.toggle('err', !!isErr);
}
function setBusy(on, text) {
  S.busy = on;
  $('createBtn').disabled = on;
  $('joinBtn').disabled = on;
  if (on) homeMsg(text);
}
function setNet(text, cls) {
  const el = $('netStatus');
  el.textContent = text;
  el.className = 'status ' + (cls || '');
}
async function copy(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
  }
  toast(okMsg);
}
function peerErrMsg(err) {
  switch (err && err.type) {
    case 'browser-incompatible':
      return 'Seu sistema não é compatível com a transmissão.';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed': case 'timeout':
      return 'Não consegui falar com o servidor de salas. Confira sua internet e tente de novo.';
    case 'unavailable-id':
      return 'Esse código já está em uso. Tente de novo.';
    default:
      return 'Erro ao conectar: ' + ((err && (err.message || err.type)) || 'desconhecido');
  }
}
function libOk() {
  if (typeof Peer === 'undefined') {
    homeMsg('Não consegui carregar o app. Feche e abra de novo.', true);
    return false;
  }
  return true;
}
function readName() {
  if (!$('nameInput').value.trim()) {
    homeMsg('Digite seu nome primeiro.', true);
    $('nameInput').focus();
    return '';
  }
  S.myName = cleanName($('nameInput').value);
  store('tav-name', S.myName);
  return S.myName;
}
function updateAwake() {
  // Não deixa o monitor apagar enquanto você transmite ou assiste.
  if (IS_APP) window.tav.keepAwake(!!S.localStream || S.tiles.size > 0);
}

// ---------------- sons de aviso (estilo Discord, gerados na hora) ----------------
let sfxCtx = null;
const SFX = {
  join:    [[587.33, 0, 0.16], [880, 0.09, 0.24]],                                   // alguém entrou
  leave:   [[880, 0, 0.16], [523.25, 0.09, 0.26]],                                   // alguém saiu
  live:    [[523.25, 0, 0.3], [659.25, 0.07, 0.3], [783.99, 0.14, 0.3], [1046.5, 0.21, 0.4]], // começou a transmitir
  liveEnd: [[783.99, 0, 0.24], [659.25, 0.07, 0.24], [523.25, 0.14, 0.3]],          // parou de transmitir
  viewer:  [[1318.5, 0, 0.12], [1760, 0.06, 0.2]],                                  // alguém começou a te assistir
};
function sfx(name) {
  if (!SFX[name]) return;
  try {
    if (!sfxCtx) sfxCtx = new AudioContext();
    if (sfxCtx.state === 'suspended') sfxCtx.resume();
    const now = sfxCtx.currentTime + 0.01;
    for (const [freq, at, dur] of SFX[name]) {
      const osc = sfxCtx.createOscillator();
      const gain = sfxCtx.createGain();
      osc.type = name === 'join' || name === 'leave' ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.16, now + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
      osc.connect(gain).connect(sfxCtx.destination);
      osc.start(now + at);
      osc.stop(now + at + dur + 0.05);
    }
  } catch (e) { console.warn('[sfx]', e); }
}

// Avisa "Fulano está assistindo" — junta quem chegar quase junto num aviso só.
let viewerQueue = [];
let viewerTimer = null;
function announceViewer(id) {
  if (S.watchers.has(id)) return;
  S.watchers.add(id);
  viewerQueue.push(nameOf(id));
  clearTimeout(viewerTimer);
  viewerTimer = setTimeout(() => {
    const names = viewerQueue;
    viewerQueue = [];
    if (!names.length || !S.localStream) return;
    const who = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' e ' + names[names.length - 1];
    toast(`${who} ${names.length === 1 ? 'está' : 'estão'} assistindo sua tela`);
    sfx('viewer');
  }, 700);
  renderShareUI();
}

// Ajusta a negociação (SDP) de cada conexão:
//  - som estéreo e com mais qualidade no Opus (o padrão do WebRTC é pensado pra voz);
//  - vídeo começa já com banda alta (senão os primeiros segundos ficam borrados);
//  - quem transmite escolhe o codificador: 'gpu' prefere H.264, que no Windows é codificado pela
//    placa de vídeo (NVIDIA/AMD/Intel); 'cpu' prefere VP8, codificado pelo processador.
//    Quem assiste não reordena nada (a resposta segue a ordem de quem transmite).
const VIDEO_BITRATES = 'x-google-start-bitrate=3000;x-google-min-bitrate=1000;x-google-max-bitrate=12000';
function tuneSdp(sdp, encoder) {
  const lines = sdp.split('\r\n');
  const videoPts = new Set();
  const byCodec = { VP8: [], VP9: [], H264: [], AV1: [] };
  let section = '';
  for (const l of lines) {
    if (l.startsWith('m=')) section = l.slice(2, l.indexOf(' '));
    const m = /^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\//i.exec(l);
    if (m && section === 'video') {
      videoPts.add(m[1]);
      byCodec[m[2].toUpperCase()].push(m[1]);
    }
  }
  const withFmtp = new Set(lines.map((l) => (/^a=fmtp:(\d+) /.exec(l) || [])[1]).filter(Boolean));
  const opus = (/a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp) || [])[1];
  let preferred = [];
  if (encoder === 'gpu') {
    // H.264 "packetization-mode=1" primeiro (é o que a placa de vídeo usa).
    const h264 = byCodec.H264;
    const pm1 = h264.filter((pt) => lines.some((l) => l.startsWith(`a=fmtp:${pt} `) && l.includes('packetization-mode=1')));
    preferred = [...pm1, ...h264.filter((pt) => !pm1.includes(pt))];
  } else if (encoder === 'cpu') {
    preferred = byCodec.VP8;
  }

  const out = [];
  for (const l of lines) {
    if (l.startsWith('m=video') && preferred.length) {
      const parts = l.split(' ');
      const pts = parts.slice(3);
      out.push([...parts.slice(0, 3), ...preferred.filter((p) => pts.includes(p)), ...pts.filter((p) => !preferred.includes(p))].join(' '));
      continue;
    }
    const f = /^a=fmtp:(\d+) (.*)$/.exec(l);
    if (f && f[1] === opus) {
      const extra = ['stereo=1', 'sprop-stereo=1', 'maxaveragebitrate=160000'].filter((p) => !f[2].includes(p.split('=')[0] + '='));
      out.push(extra.length ? `${l};${extra.join(';')}` : l);
      continue;
    }
    if (f && videoPts.has(f[1]) && !f[2].includes('x-google-')) {
      out.push(`${l};${VIDEO_BITRATES}`);
      continue;
    }
    out.push(l);
    const r = /^a=rtpmap:(\d+) /.exec(l);
    if (r && videoPts.has(r[1]) && !withFmtp.has(r[1])) out.push(`a=fmtp:${r[1]} ${VIDEO_BITRATES}`);
  }
  return out.join('\r\n');
}

// ---------------- conexão com o servidor de sinalização ----------------
function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(id, { debug: 1 });
    let opened = false;
    const timer = setTimeout(() => {
      if (!opened) { peer.destroy(); reject({ type: 'timeout' }); }
    }, 15000);
    peer.on('open', () => {
      if (!opened) {
        opened = true; clearTimeout(timer); S.peer = peer; resolve(peer);
      } else if (S.peer === peer) {
        setNet('Conectado', 'ok');      // reconectou ao servidor
        syncCalls();
      }
    });
    peer.on('error', (err) => {
      if (!opened) { clearTimeout(timer); peer.destroy(); reject(err); return; }
      onPeerError(err);
    });
    peer.on('disconnected', () => {
      if (S.leaving || S.peer !== peer || peer.destroyed) return;
      setNet('Reconectando ao servidor…', 'bad');
      setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 1500);
    });
    peer.on('call', onIncomingCall);
  });
}

function onPeerError(err) {
  if (err.type === 'peer-unavailable') {
    if (S.joining) S.joining.fail('Sala não encontrada. Confira o código (ou a sala já foi fechada).');
    return;   // fora isso: alguém saiu enquanto eu ligava pra ele — normal
  }
  if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(err.type)) {
    setNet('Sem conexão com o servidor…', 'bad');
    return;
  }
  console.warn('[peer]', err.type, err);
}

// ---------------- criar / entrar / sair ----------------
async function createRoom(attempt = 0) {
  if (S.busy && attempt === 0) return;
  if (!readName() || !libOk()) return;
  setBusy(true, 'Criando sala…');
  S.leaving = false;
  const code = randCode(6);
  try {
    await openPeer(PREFIX + code);
  } catch (err) {
    if (err.type === 'unavailable-id' && attempt < 3) return createRoom(attempt + 1);
    setBusy(false);
    homeMsg(peerErrMsg(err), true);
    return;
  }
  S.code = code;
  S.isHost = true;
  S.myId = S.peer.id;
  S.roster = new Map([[S.myId, { name: S.myName, sharing: false, seq: 0, audio: false }]]);
  S.peer.on('connection', onGuestConnection);
  setBusy(false);
  homeMsg('');
  enterRoom();
  broadcastRoster();
}

async function joinRoom() {
  if (S.busy) return;
  if (!readName()) return;
  const code = normCode($('codeInput').value);
  if (code.length !== 6) {
    homeMsg('Digite o código de 6 caracteres da sala.', true);
    $('codeInput').focus();
    return;
  }
  if (!libOk()) return;
  setBusy(true, 'Entrando na sala…');
  S.leaving = false;
  S.code = code;

  let peer;
  try {
    peer = await openPeer(`${PREFIX}${code}-${randCode(8)}`);
  } catch (err) {
    setBusy(false);
    homeMsg(peerErrMsg(err), true);
    return;
  }

  const conn = peer.connect(hostId(), { reliable: true, serialization: 'json' });
  const error = await new Promise((resolve) => {
    const timer = setTimeout(() => done('Não consegui entrar na sala. Confira o código e tente de novo.'), 15000);
    function done(e) { clearTimeout(timer); S.joining = null; resolve(e); }
    S.joining = { fail: done };
    conn.on('open', () => done(null));
    conn.on('error', (e) => done('Erro ao entrar: ' + (e && e.message)));
  });
  if (error) {
    peer.destroy();
    S.peer = null;
    setBusy(false);
    homeMsg(error, true);
    return;
  }

  S.isHost = false;
  S.myId = peer.id;
  S.hostConn = conn;
  S.view = new Map([[S.myId, { name: S.myName, sharing: false, seq: 0, audio: false }]]);
  conn.on('data', onHostMessage);
  conn.on('close', () => {
    if (!S.leaving && S.hostConn === conn) leaveRoom('A sala foi encerrada (quem criou a sala saiu).');
  });
  conn.send({ t: 'hello', name: S.myName });
  setBusy(false);
  homeMsg('');
  enterRoom();
}

function enterRoom() {
  $('home').classList.add('hidden');
  $('room').classList.remove('hidden');
  $('roomCode').textContent = S.code;
  setNet('Conectado', 'ok');
  renderPeople();
  renderShareUI();
  renderStage();
  sfx('join');
}

function leaveRoom(reason) {
  if (S.leaving && !S.peer) return;
  S.leaving = true;
  sfx('leave');
  closePicker(null);
  stopShare(true);
  for (const id of [...S.tiles.keys()]) removeTile(id);
  const peer = S.peer;
  if (S.isHost) {
    for (const c of S.conns.values()) { try { c.send({ t: 'end' }); } catch {} }
    setTimeout(() => { try { peer && peer.destroy(); } catch {} }, 300);  // dá tempo do aviso sair
  } else {
    try { peer && peer.destroy(); } catch {}
  }
  Object.assign(S, {
    peer: null, myId: '', code: '', isHost: false, hostConn: null, joining: null,
    conns: new Map(), roster: new Map(), view: new Map(), viewReady: false,
    outCalls: new Map(), tiles: new Map(), seq: 0, watchers: new Set(), audioMode: 'none', encoderUsed: null,
  });
  $('grid').textContent = '';
  $('room').classList.add('hidden');
  $('home').classList.remove('hidden');
  homeMsg(reason || '', !!reason);
  updateAwake();
}

// ---------------- anfitrião: mantém a lista da sala ----------------
function onGuestConnection(conn) {
  if (!conn.peer.startsWith(hostId() + '-')) { conn.close(); return; }
  conn.on('data', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      S.conns.set(conn.peer, conn);
      S.roster.set(conn.peer, { name: cleanName(msg.name), sharing: false, seq: 0, audio: false });
      broadcastRoster();
    } else if (msg.t === 'state') {
      const p = S.roster.get(conn.peer);
      if (!p) return;
      p.sharing = !!msg.sharing;
      p.seq = Number(msg.seq) || 0;
      p.audio = !!msg.audio;
      broadcastRoster();
    }
  });
  const drop = () => {
    S.conns.delete(conn.peer);
    if (S.roster.delete(conn.peer)) broadcastRoster();
  };
  conn.on('close', drop);
  conn.on('error', drop);
}

function broadcastRoster() {
  const list = [...S.roster].map(([id, p]) => ({ id, ...p }));
  for (const c of S.conns.values()) {
    if (c.open) { try { c.send({ t: 'roster', list }); } catch {} }
  }
  applyRoster(list);
}

function onHostMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'roster' && Array.isArray(msg.list)) applyRoster(msg.list);
  else if (msg.t === 'end') leaveRoom('A sala foi encerrada por quem a criou.');
}

function sendState() {
  const st = {
    sharing: !!S.localStream,
    seq: S.seq,
    audio: !!(S.localStream && S.localStream.getAudioTracks().length),
  };
  if (S.isHost) {
    const me = S.roster.get(S.myId);
    if (me) { Object.assign(me, st); broadcastRoster(); }
  } else if (S.hostConn && S.hostConn.open) {
    try { S.hostConn.send({ t: 'state', ...st }); } catch {}
  }
}

// ---------------- todos: reage à lista da sala ----------------
function applyRoster(list) {
  const next = new Map();
  for (const p of list) {
    if (!p || typeof p.id !== 'string') continue;
    next.set(p.id, { name: cleanName(p.name), sharing: !!p.sharing, seq: Number(p.seq) || 0, audio: !!p.audio });
  }
  if (S.viewReady) {
    // Um som só por atualização, do mais importante pro menos.
    const sounds = new Set();
    for (const [id, p] of next) {
      if (id === S.myId) continue;
      const old = S.view.get(id);
      if (!old) { toast(`${p.name} entrou na sala`); sounds.add('join'); }
      if (old && p.sharing && !old.sharing) { toast(`${p.name} começou a transmitir`); sounds.add('live'); }
      if (old && !p.sharing && old.sharing) { toast(`${p.name} parou de transmitir`); sounds.add('liveEnd'); }
    }
    for (const [id, p] of S.view) {
      if (id !== S.myId && !next.has(id)) { toast(`${p.name} saiu da sala`); sounds.add('leave'); }
    }
    const pick = ['live', 'join', 'liveEnd', 'leave'].find((s) => sounds.has(s));
    if (pick) sfx(pick);
  }
  S.view = next;
  S.viewReady = true;

  // Remove telas de quem saiu ou parou de transmitir (o seq evita apagar uma transmissão nova
  // que chegou antes da lista atualizada).
  for (const [id, tile] of [...S.tiles]) {
    const p = next.get(id);
    if (!p || (!p.sharing && p.seq >= tile.seq)) removeTile(id);
    else tile.el.querySelector('.tname').textContent = p.name;
  }
  syncCalls();
  renderPeople();
  renderShareUI();
}

function renderPeople() {
  const ul = $('people');
  ul.textContent = '';
  const ids = [...S.view.keys()].sort((a, b) => (b === hostId()) - (a === hostId()));
  for (const id of ids) {
    const p = S.view.get(id);
    const li = document.createElement('li');
    const av = document.createElement('span');
    av.className = 'av';
    av.style.background = colorOf(id);
    av.textContent = p.name.charAt(0).toUpperCase();
    const nm = document.createElement('span');
    nm.className = 'pname';
    nm.textContent = p.name;
    if (id === S.myId) {
      const you = document.createElement('small');
      you.textContent = ' (você)';
      nm.appendChild(you);
    }
    li.append(av, nm);
    if (id === hostId()) {
      const b = document.createElement('span');
      b.className = 'pill host'; b.textContent = 'DONO';
      b.title = 'Criou a sala — se sair, a sala fecha';
      li.appendChild(b);
    }
    if (p.sharing) {
      const b = document.createElement('span');
      b.className = 'pill live';
      b.textContent = p.audio ? 'AO VIVO · SOM' : 'AO VIVO';
      li.appendChild(b);
    }
    ul.appendChild(li);
  }
  $('count').textContent = S.view.size;
}

function renderShareUI() {
  const sharing = !!S.localStream;
  const btn = $('shareBtn');
  btn.textContent = sharing ? 'Parar transmissão' : 'Transmitir minha tela';
  btn.classList.toggle('primary', !sharing);
  btn.classList.toggle('live', sharing);
  btn.disabled = !canShare;
  $('audioChk').disabled = sharing || !canShare;
  $('qualitySel').disabled = sharing || !canShare;
  $('encoderSel').disabled = sharing || !canShare;
  $('selfBox').classList.toggle('hidden', !sharing);
  const hint = $('shareHint');
  hint.classList.toggle('on', sharing);
  if (!canShare) {
    hint.textContent = 'Este aparelho não permite transmitir a tela — mas dá para assistir.';
  } else if (sharing) {
    const n = S.watchers.size;
    const som = {
      system: 'som do PC (sem Discord)',
      app: 'som só deste app',
      loopback: 'som do PC inteiro',
    }[S.audioMode] || 'sem som';
    const enc = { gpu: ' · vídeo na placa de vídeo', cpu: ' · vídeo no processador' }[S.encoderUsed] || '';
    hint.textContent = `● Ao vivo · ${n} ${n === 1 ? 'pessoa assistindo' : 'pessoas assistindo'} · ${som}${enc}`;
  } else {
    hint.textContent = 'O microfone nunca é usado — só a imagem e, se quiser, o som do PC.';
  }
  updateAwake();
}

function renderStage() {
  const n = S.tiles.size;
  $('empty').classList.toggle('hidden', n > 0);
  $('grid').classList.toggle('solo', n === 1);
  updateAwake();
}

// ---------------- seletor de tela/janela (app de Windows) ----------------
let picker = null;   // { resolve, kind, chosen, sources }

function closePicker(value) {
  if (!picker) return;
  const { resolve } = picker;
  picker = null;
  $('picker').classList.add('hidden');
  document.removeEventListener('keydown', onPickerKey);
  resolve(value);
}
function onPickerKey(e) {
  if (e.key === 'Escape') closePicker(null);
  else if (e.key === 'Enter' && picker && picker.chosen) closePicker(picker.chosen);
}

function renderPicker() {
  const grid = $('srcGrid');
  grid.textContent = '';
  for (const t of document.querySelectorAll('#picker .tab')) {
    t.classList.toggle('active', t.dataset.kind === picker.kind);
  }
  const list = picker.sources.filter((s) => (picker.kind === 'screen') === s.isScreen);
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'src-empty';
    empty.textContent = picker.sources.length ? 'Nada para mostrar aqui.' : 'Carregando…';
    grid.appendChild(empty);
  }
  for (const s of list) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'src' + (picker.chosen === s.id ? ' sel' : '');
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (s.thumb) {
      const img = document.createElement('img');
      img.src = s.thumb; img.alt = '';
      thumb.appendChild(img);
    }
    const nm = document.createElement('div');
    nm.className = 'sname';
    if (s.icon) {
      const ic = document.createElement('img');
      ic.src = s.icon; ic.alt = '';
      nm.appendChild(ic);
    }
    const label = document.createElement('span');
    label.textContent = s.label;
    label.title = s.label;
    nm.appendChild(label);
    card.append(thumb, nm);
    card.onclick = () => { picker.chosen = s.id; renderPicker(); };
    card.ondblclick = () => closePicker(s.id);
    grid.appendChild(card);
  }
  $('pickGo').disabled = !picker.chosen;
  $('pickNote').textContent = !$('audioChk').checked ? 'Sem som'
    : picker.kind === 'screen' ? 'Com o som do PC, sem o Discord · sem microfone'
    : 'Com o som só deste app · sem microfone';
}

// "Tela 1 · 1920×1080 (principal)" — com dois monitores dá pra saber qual é qual.
function screenLabel(s, screens) {
  const size = s.width ? ` · ${s.width}×${s.height}` : '';
  const main = s.primary && screens.length > 1 ? ' (principal)' : '';
  return (screens.length > 1 ? `Tela ${screens.indexOf(s) + 1}` : 'Tela inteira') + size + main;
}
// Já deixa marcada a tela principal.
function defaultScreen(sources) {
  const screens = sources.filter((s) => s.isScreen);
  const main = screens.find((s) => s.primary) || screens[0];
  return main ? main.id : null;
}

function pickSource() {
  if (picker) closePicker(null);
  return new Promise((resolve) => {
    picker = { resolve, kind: 'screen', chosen: null, sources: [] };
    $('picker').classList.remove('hidden');
    document.addEventListener('keydown', onPickerKey);
    renderPicker();

    const mine = picker;
    window.tav.sources().then((sources) => {
      if (picker !== mine) return;
      const screens = sources.filter((s) => s.isScreen);
      mine.sources = sources
        .filter((s) => s.isScreen || s.name !== document.title)   // não lista o próprio app
        .map((s) => ({ ...s, label: s.isScreen ? screenLabel(s, screens) : s.name }));
      mine.chosen = defaultScreen(mine.sources);
      renderPicker();
    }).catch((err) => {
      if (picker !== mine) return;
      closePicker(null);
      toast('Não consegui listar suas telas: ' + (err && err.message), 'err');
    });
  });
}

$('pickGo').onclick = () => picker && closePicker(picker.chosen);
$('pickCancel').onclick = () => closePicker(null);
$('pickClose').onclick = () => closePicker(null);
for (const t of document.querySelectorAll('#picker .tab')) {
  t.onclick = () => {
    if (!picker) return;
    picker.kind = t.dataset.kind;
    picker.chosen = picker.kind === 'screen' ? defaultScreen(picker.sources) : null;
    renderPicker();
  };
}

// ---------------- som app por app (app de Windows) ----------------
// O ScreenPLAYAudio.exe manda o som já sem o Discord (ou só o da janela escolhida);
// aqui ele vira uma faixa de áudio normal para a transmissão.
const AppAudio = {
  ctx: null,
  off: null,

  async start(sourceId) {
    if (!IS_APP || !window.tav.audioStart) return null;
    let result;
    try { result = await window.tav.audioStart({ sourceId }); } catch (e) { result = { ok: false, error: e.message }; }
    if (!result || !result.ok) {
      console.warn('[app-audio]', result && result.error);
      return null;
    }
    try {
      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule('pcm-worklet.js');
      const node = new AudioWorkletNode(ctx, 'pcm-player', { numberOfInputs: 0, outputChannelCount: [2] });
      const dest = ctx.createMediaStreamDestination();
      node.connect(dest);
      this.off = window.tav.onPcm((bytes) => {
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        node.port.postMessage(ab, [ab]);
      });
      this.ctx = ctx;
      return { track: dest.stream.getAudioTracks()[0], mode: result.mode };
    } catch (e) {
      console.warn('[app-audio]', e);
      this.stop();
      return null;
    }
  },

  stop() {
    if (this.off) this.off();
    this.off = null;
    if (IS_APP && window.tav.audioStop) window.tav.audioStop().catch(() => {});
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  },
};
if (IS_APP && window.tav.onAudioEnded) {
  window.tav.onAudioEnded(() => {
    if (S.localStream && (S.audioMode === 'system' || S.audioMode === 'app')) {
      toast('O som da transmissão parou. Pare e transmita de novo para voltar.', 'warn', 7000);
    }
  });
}

// ---------------- transmitir minha tela ----------------
async function startShare() {
  if (!canShare || S.localStream) return;
  const q = QUALITY[$('qualitySel').value] || QUALITY['1080-30'];
  const withAudio = $('audioChk').checked;
  const audio = withAudio
    ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        suppressLocalAudioPlayback: false, restrictOwnAudio: true }
    : false;
  const video = { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps, max: q.fps } };

  let options;
  let appAudio = null;
  if (IS_APP) {
    const sourceId = await pickSource();
    if (!sourceId || !S.peer) return;
    // Primeiro tenta o som separado por app; se o Windows não deixar, usa o som do PC inteiro.
    if (withAudio) appAudio = await AppAudio.start(sourceId);
    if (!S.peer) { AppAudio.stop(); return; }
    await window.tav.select(sourceId, withAudio && !appAudio);
    options = { video, audio: withAudio && !appAudio ? audio : false };
  } else {
    options = {
      video, audio,
      systemAudio: withAudio ? 'include' : 'exclude',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    };
  }

  let stream;
  try {
    // Captura só a tela e o áudio do sistema — nunca o microfone.
    stream = await navigator.mediaDevices.getDisplayMedia(options);
  } catch (err) {
    if (appAudio) AppAudio.stop();
    if (err && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
      toast('Não foi possível capturar a tela: ' + (err.message || err.name), 'err');
    }
    return;
  }
  if (!S.peer || S.localStream) {
    stream.getTracks().forEach((t) => t.stop());
    if (appAudio) AppAudio.stop();
    return;
  }

  if (!withAudio) {
    for (const t of stream.getAudioTracks()) { t.stop(); stream.removeTrack(t); }
  } else if (appAudio) {
    stream.addTrack(appAudio.track);
  } else if (!stream.getAudioTracks().length) {
    toast(IS_APP
      ? 'Não consegui pegar o som do PC — transmitindo sem som.'
      : 'Transmitindo SEM som: na janela de compartilhamento, ative “Compartilhar áudio”.', 'warn', 8000);
  } else if (IS_APP) {
    toast('Este Windows não deixa separar o som do Discord — transmitindo o som do PC inteiro.', 'warn', 8000);
  }
  S.audioMode = appAudio ? appAudio.mode : (stream.getAudioTracks().length ? 'loopback' : 'none');
  const track = stream.getVideoTracks()[0];
  if (track) {
    try { track.contentHint = q.hint; } catch {}
    track.addEventListener('ended', () => stopShare());   // a janela transmitida foi fechada etc.
  }

  S.localStream = stream;
  S.quality = q;
  S.encoder = $('encoderSel').value === 'cpu' ? 'cpu' : 'gpu';
  S.encoderUsed = null;
  S.seq += 1;
  S.watchers = new Set();
  $('selfPreview').srcObject = stream;
  sendState();
  syncCalls();
  renderShareUI();
  sfx('live');
}

function stopShare(silent) {
  if (!S.localStream) return;
  const stream = S.localStream;
  S.localStream = null;
  stream.getTracks().forEach((t) => t.stop());
  AppAudio.stop();
  S.audioMode = 'none';
  S.encoderUsed = null;
  S.watchers = new Set();
  for (const id of [...S.outCalls.keys()]) closeOut(id);
  $('selfPreview').srcObject = null;
  if (!silent) {
    sendState();
    sfx('liveEnd');
  }
  renderShareUI();
}

// Garante que cada pessoa da sala esteja recebendo minha tela (e só elas).
function syncCalls() {
  for (const id of [...S.outCalls.keys()]) if (!S.view.has(id)) closeOut(id);
  for (const id of [...S.watchers]) if (!S.view.has(id)) S.watchers.delete(id);
  if (!S.localStream) return;
  for (const id of S.view.keys()) {
    if (id !== S.myId && !S.outCalls.has(id)) callPeer(id);
  }
}

function callPeer(id, tries = 0) {
  if (!S.localStream || !S.peer || S.peer.destroyed || S.peer.disconnected) return;
  const seq = S.seq;
  const encoder = S.encoder;
  const call = S.peer.call(id, S.localStream, { metadata: { seq }, sdpTransform: (sdp) => tuneSdp(sdp, encoder) });
  if (!call) return;
  const entry = { call, seq };
  S.outCalls.set(id, entry);
  tuneSender(call);
  // Quando a conexão abre, essa pessoa começou a ver minha tela.
  const pc = call.peerConnection;
  if (pc) {
    const onConnected = () => {
      if (pc.connectionState !== 'connected') return;
      pc.removeEventListener('connectionstatechange', onConnected);
      if (S.outCalls.get(id) === entry && S.seq === seq) {
        announceViewer(id);
        if (!S.encoderUsed) detectEncoder(pc, seq);
      }
    };
    pc.addEventListener('connectionstatechange', onConnected);
  }
  let retried = false;
  const retry = () => {
    if (retried || S.outCalls.get(id) !== entry) return;
    retried = true;
    S.outCalls.delete(id);
    if (tries >= 3) return;
    setTimeout(() => {
      if (S.localStream && S.seq === seq && S.view.has(id) && !S.outCalls.has(id)) callPeer(id, tries + 1);
    }, 2000);
  };
  call.on('close', retry);
  call.on('error', retry);
}

// Confere qual codificador o navegador realmente usou (a placa pode não estar disponível).
async function detectEncoder(pc, seq) {
  await new Promise((r) => setTimeout(r, 1500));
  if (S.seq !== seq || !S.localStream || S.encoderUsed) return;
  try {
    const stats = await pc.getStats();
    stats.forEach((r) => {
      if (r.type !== 'outbound-rtp' || r.kind !== 'video' || !r.encoderImplementation) return;
      const hw = r.powerEfficientEncoder === true || /MediaFoundation|NVIDIA|AMD|Intel|QuickSync/i.test(r.encoderImplementation);
      S.encoderUsed = hw ? 'gpu' : 'cpu';
    });
  } catch { return; }
  if (S.encoder === 'gpu' && S.encoderUsed === 'cpu') {
    toast('A placa de vídeo não pôde codificar a transmissão — usando o processador.', 'warn', 7000);
  }
  renderShareUI();
}

function closeOut(id) {
  const entry = S.outCalls.get(id);
  S.outCalls.delete(id);
  if (entry) { try { entry.call.close(); } catch {} }
}

// Sobe o limite de bitrate (o padrão deixa a tela borrada em 1080p).
function tuneSender(call) {
  const pc = call.peerConnection;
  if (!pc) return;
  const apply = async () => {
    for (const sender of pc.getSenders()) {
      if (!sender.track || sender.track.kind !== 'video') continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) continue;
        params.encodings[0].maxBitrate = S.quality.bitrate;
        params.encodings[0].maxFramerate = S.quality.fps;
        await sender.setParameters(params);
      } catch (e) { console.warn('[bitrate]', e); }
    }
  };
  const onState = () => {
    if (pc.connectionState === 'connected') {
      pc.removeEventListener('connectionstatechange', onState);
      apply();
    }
  };
  pc.addEventListener('connectionstatechange', onState);
}

// ---------------- assistir a tela dos outros ----------------
function onIncomingCall(call) {
  if (!S.code || !call.peer.startsWith(hostId())) { call.close(); return; }
  const seq = Number(call.metadata && call.metadata.seq) || 0;
  const old = S.tiles.get(call.peer);
  if (old && old.seq > seq) { call.close(); return; }
  if (old) removeTile(call.peer);

  call.answer(undefined, { sdpTransform: (sdp) => tuneSdp(sdp, null) });   // não envio nada de volta
  const tile = makeTile(call.peer, seq, call);
  S.tiles.set(call.peer, tile);
  call.on('stream', (stream) => attachStream(tile, stream));
  const end = () => { if (S.tiles.get(call.peer) === tile) removeTile(call.peer); };
  call.on('close', end);
  call.on('error', end);
  renderStage();
}

function makeTile(id, seq, call) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.innerHTML = `
    <video playsinline autoplay></video>
    <div class="tile-wait"><div class="spin"></div><span>Conectando à transmissão…</span></div>
    <button class="btn unmute hidden" type="button">${svg(ICON.vol)} Clique para ouvir o som</button>
    <div class="tile-bar">
      <span class="pill live">AO VIVO</span>
      <span class="tname"></span>
      <span class="aud-off hidden">sem som</span>
      <div class="aud hidden">
        <button class="ib mute" type="button" title="Silenciar">${svg(ICON.vol)}</button>
        <input class="vol" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume">
      </div>
      <button class="ib fs" type="button" title="Tela cheia (ou clique duas vezes)">${svg(ICON.fs)}</button>
    </div>`;
  const video = el.querySelector('video');
  const muteBtn = el.querySelector('.mute');
  const vol = el.querySelector('.vol');
  const unmuteBtn = el.querySelector('.unmute');
  el.querySelector('.tname').textContent = nameOf(id);

  const syncAudioUI = () => {
    const off = video.muted || video.volume === 0;
    muteBtn.innerHTML = svg(off ? ICON.mute : ICON.vol);
    muteBtn.title = off ? 'Ativar som' : 'Silenciar';
  };
  muteBtn.onclick = () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) { video.volume = 0.8; vol.value = 0.8; }
    unmuteBtn.classList.add('hidden');
    syncAudioUI();
  };
  vol.oninput = () => {
    video.volume = Number(vol.value);
    video.muted = video.volume === 0;
    unmuteBtn.classList.add('hidden');
    syncAudioUI();
  };
  unmuteBtn.onclick = () => {
    video.muted = false;
    video.play().catch(() => {});
    unmuteBtn.classList.add('hidden');
    syncAudioUI();
  };
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  };
  el.querySelector('.fs').onclick = toggleFs;
  video.ondblclick = toggleFs;

  // Esconde a barra quando o mouse fica parado.
  let idleTimer;
  const wake = () => {
    el.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => el.classList.add('idle'), 2500);
  };
  el.addEventListener('mousemove', wake);
  wake();

  video.addEventListener('playing', () => el.querySelector('.tile-wait').classList.add('hidden'));
  setTimeout(() => {
    if (!el.isConnected || video.readyState >= 2) return;
    el.querySelector('.tile-wait span').textContent =
      'Ainda conectando… Se não abrir, a rede de um de vocês pode estar bloqueando a conexão direta.';
  }, 20000);

  $('grid').appendChild(el);
  return { id, seq, call, el, video, syncAudioUI };
}

function attachStream(tile, stream) {
  const { el, video } = tile;
  if (video.srcObject === stream) return;
  video.srcObject = stream;
  const updateAudio = () => {
    const has = stream.getAudioTracks().length > 0;
    el.querySelector('.aud').classList.toggle('hidden', !has);
    el.querySelector('.aud-off').classList.toggle('hidden', has);
  };
  updateAudio();
  stream.addEventListener('addtrack', updateAudio);
  stream.addEventListener('removetrack', updateAudio);
  video.muted = false;
  video.play().catch(() => {
    // Som automático bloqueado: toca mudo e oferece um botão.
    video.muted = true;
    video.play().catch(() => {});
    if (stream.getAudioTracks().length) el.querySelector('.unmute').classList.remove('hidden');
    tile.syncAudioUI();
  });
  tile.syncAudioUI();
}

function removeTile(id) {
  const tile = S.tiles.get(id);
  if (!tile) return;
  S.tiles.delete(id);
  try { tile.call.close(); } catch {}
  if (document.fullscreenElement === tile.el) document.exitFullscreen().catch(() => {});
  tile.video.srcObject = null;
  tile.el.remove();
  renderStage();
}

// ---------------- eventos da página ----------------
$('createBtn').onclick = () => createRoom();
$('joinBtn').onclick = joinRoom;
$('codeInput').addEventListener('input', (e) => { e.target.value = normCode(e.target.value); });
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
$('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') (normCode($('codeInput').value).length === 6 ? joinRoom() : createRoom());
});
$('shareBtn').onclick = () => (S.localStream ? stopShare() : startShare());
$('leaveBtn').onclick = () => leaveRoom();
$('copyCodeBtn').onclick = () => copy(S.code, 'Código copiado! Mande pros seus amigos.');
$('qualitySel').addEventListener('change', (e) => store('tav-quality', e.target.value));
$('encoderSel').addEventListener('change', (e) => store('tav-encoder', e.target.value));
$('audioChk').addEventListener('change', (e) => store('tav-audio', e.target.checked ? '1' : '0'));if (!IS_APP) {
  $('audioNote').textContent = 'Na janela que abrir, ative “Compartilhar áudio” (Tela inteira ou Guia). O microfone nunca vai junto.';
}

// Versão e aviso de "atualização pronta" (baixada em segundo plano com o app aberto).
if (IS_APP) {
  window.tav.version().then((v) => { $('appVersion').textContent = 'ScreenPLAY v' + v; }).catch(() => {});
  window.tav.onUpdateReady((v) => {
    $('updateText').textContent = `Versão ${v} pronta!`;
    $('updateBar').classList.remove('hidden');
  });
}
$('updateBtn').onclick = () => {
  if (S.peer) leaveRoom();
  setTimeout(() => window.tav.restartToUpdate(), 400);   // dá tempo de avisar a sala
};
$('updateLater').onclick = () => {
  $('updateBar').classList.add('hidden');
  toast('Tudo bem — a atualização instala sozinha quando você fechar o ScreenPLAY.');
};

window.addEventListener('pagehide', () => {
  if (!S.peer) return;
  if (S.isHost) for (const c of S.conns.values()) { try { c.send({ t: 'end' }); } catch {} }
  try { S.peer.destroy(); } catch {}
});

// Preferências salvas.
$('nameInput').value = store('tav-name') || '';
if (QUALITY[store('tav-quality')]) $('qualitySel').value = store('tav-quality');
if (store('tav-encoder') === 'cpu') $('encoderSel').value = 'cpu';
if (store('tav-audio') === '0') $('audioChk').checked = false;($('nameInput').value ? $('createBtn') : $('nameInput')).focus();
