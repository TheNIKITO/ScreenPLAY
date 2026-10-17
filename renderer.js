'use strict';

// Prefixo dos IDs no servidor público de sinalização do PeerJS (evita colidir com outros apps).
// Se um dia a conversa entre os apps mudar de um jeito incompatível, troque o "v1" — versões
// antigas deixam de achar as salas novas (e a atualização automática resolve isso ao abrir).
const PREFIX = 'screenplay-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const QUALITY = {
  '720-30':  { w: 1280, h: 720,  fps: 30, bitrate: 2500000, hint: 'detail' },
  '1080-30': { w: 1920, h: 1080, fps: 30, bitrate: 4500000, hint: 'detail' },
  '1080-60': { w: 1920, h: 1080, fps: 60, bitrate: 8000000, hint: 'motion' },
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
  return `hsl(${h % 360} 55% 45%)`;
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

// Pede som estéreo e com mais qualidade no Opus (o padrão do WebRTC é pensado pra voz).
function stereoSdp(sdp) {
  const m = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!m) return sdp;
  const pt = m[1];
  return sdp.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`), (line, params) => {
    const extra = ['stereo=1', 'sprop-stereo=1', 'maxaveragebitrate=160000']
      .filter((p) => !params.includes(p.split('=')[0] + '='));
    return extra.length ? `a=fmtp:${pt} ${params};${extra.join(';')}` : line;
  });
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
}

function leaveRoom(reason) {
  if (S.leaving && !S.peer) return;
  S.leaving = true;
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
    outCalls: new Map(), tiles: new Map(), seq: 0,
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
    for (const [id, p] of next) if (id !== S.myId && !S.view.has(id)) toast(`${p.name} entrou na sala`);
    for (const [id, p] of S.view) if (id !== S.myId && !next.has(id)) toast(`${p.name} saiu da sala`);
    for (const [id, p] of next) {
      const old = S.view.get(id);
      if (id !== S.myId && old && p.sharing && !old.sharing) toast(`${p.name} começou a transmitir`);
    }
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
  $('selfBox').classList.toggle('hidden', !sharing);
  const hint = $('shareHint');
  hint.classList.toggle('on', sharing);
  if (!canShare) {
    hint.textContent = 'Este aparelho não permite transmitir a tela — mas dá para assistir.';
  } else if (sharing) {
    const n = Math.max(0, S.view.size - 1);
    const som = S.localStream.getAudioTracks().length ? 'com som' : 'sem som';
    hint.textContent = `● Ao vivo para ${n} ${n === 1 ? 'pessoa' : 'pessoas'} · ${som}`;
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
}

function pickSource() {
  if (picker) closePicker(null);
  return new Promise((resolve) => {
    picker = { resolve, kind: 'screen', chosen: null, sources: [] };
    $('pickNote').textContent = $('audioChk').checked
      ? 'Com som do PC · sem microfone'
      : 'Sem som';
    $('picker').classList.remove('hidden');
    document.addEventListener('keydown', onPickerKey);
    renderPicker();

    const mine = picker;
    window.tav.sources().then((sources) => {
      if (picker !== mine) return;
      const screens = sources.filter((s) => s.isScreen);
      mine.sources = sources
        .filter((s) => s.isScreen || s.name !== document.title)   // não lista o próprio app
        .map((s) => ({
          ...s,
          label: s.isScreen
            ? (screens.length > 1 ? `Tela ${screens.indexOf(s) + 1}` : 'Tela inteira')
            : s.name,
        }));
      if (screens.length === 1) mine.chosen = screens[0].id;
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
    picker.chosen = null;
    if (picker.kind === 'screen') {
      const screens = picker.sources.filter((s) => s.isScreen);
      if (screens.length === 1) picker.chosen = screens[0].id;
    }
    renderPicker();
  };
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
  if (IS_APP) {
    const sourceId = await pickSource();
    if (!sourceId || !S.peer) return;
    await window.tav.select(sourceId, withAudio);
    options = { video, audio };
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
    if (err && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
      toast('Não foi possível capturar a tela: ' + (err.message || err.name), 'err');
    }
    return;
  }
  if (!S.peer || S.localStream) { stream.getTracks().forEach((t) => t.stop()); return; }

  if (!withAudio) {
    for (const t of stream.getAudioTracks()) { t.stop(); stream.removeTrack(t); }
  } else if (!stream.getAudioTracks().length) {
    toast(IS_APP
      ? 'Não consegui pegar o som do PC — transmitindo sem som.'
      : 'Transmitindo SEM som: na janela de compartilhamento, ative “Compartilhar áudio”.', 'warn', 8000);
  }
  const track = stream.getVideoTracks()[0];
  if (track) {
    try { track.contentHint = q.hint; } catch {}
    track.addEventListener('ended', () => stopShare());   // a janela transmitida foi fechada etc.
  }

  S.localStream = stream;
  S.quality = q;
  S.seq += 1;
  $('selfPreview').srcObject = stream;
  sendState();
  syncCalls();
  renderShareUI();
}

function stopShare(silent) {
  if (!S.localStream) return;
  const stream = S.localStream;
  S.localStream = null;
  stream.getTracks().forEach((t) => t.stop());
  for (const id of [...S.outCalls.keys()]) closeOut(id);
  $('selfPreview').srcObject = null;
  if (!silent) sendState();
  renderShareUI();
}

// Garante que cada pessoa da sala esteja recebendo minha tela (e só elas).
function syncCalls() {
  for (const id of [...S.outCalls.keys()]) if (!S.view.has(id)) closeOut(id);
  if (!S.localStream) return;
  for (const id of S.view.keys()) {
    if (id !== S.myId && !S.outCalls.has(id)) callPeer(id);
  }
}

function callPeer(id, tries = 0) {
  if (!S.localStream || !S.peer || S.peer.destroyed || S.peer.disconnected) return;
  const seq = S.seq;
  const call = S.peer.call(id, S.localStream, { metadata: { seq }, sdpTransform: stereoSdp });
  if (!call) return;
  const entry = { call, seq };
  S.outCalls.set(id, entry);
  tuneSender(call);
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

  call.answer(undefined, { sdpTransform: stereoSdp });   // não envio nada de volta
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
$('audioChk').addEventListener('change', (e) => store('tav-audio', e.target.checked ? '1' : '0'));
if (!IS_APP) {
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
if (store('tav-audio') === '0') $('audioChk').checked = false;
($('nameInput').value ? $('createBtn') : $('nameInput')).focus();
