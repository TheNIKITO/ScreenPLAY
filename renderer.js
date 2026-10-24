'use strict';

// Prefixo dos IDs no servidor público de sinalização do PeerJS (evita colidir com outros apps).
// v2: sala sobrevive à saída do dono e "clique para assistir". v3: entrar exige conta (credencial
// conferida por quem cuida da sala). Versões antigas não acham as salas novas — a atualização
// automática resolve isso ao abrir. As salas agora moram nos grupos: o código é o ID do canal.
const PREFIX = 'screenplay-v3-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// hint 'detail' = segura a resolução. ('motion' derrubava 1080p60 para 640x360 enquanto a banda subia.)
// bitrate = teto. Com 10 Mbps no 1080p60, cenas pesadas faziam o codificador jogar quadros fora
// (caía para ~22 fps); com 20 Mbps não houve queda. Tela parada continua usando só ~2–3 Mbps.
const QUALITY = {
  '720-30':  { w: 1280, h: 720,  fps: 30, bitrate: 6000000,  hint: 'detail' },
  '1080-30': { w: 1920, h: 1080, fps: 30, bitrate: 12000000, hint: 'detail' },
  '1080-60': { w: 1920, h: 1080, fps: 60, bitrate: 20000000, hint: 'detail' },
};
const REACTIONS = ['😂', '🔥', '👍', '😮', '❤️'];
// Sinal de vida entre quem cuida da sala e os outros: a cada 5 s. Quem fica 20 s calado (PC travou,
// desligou, internet caiu) sai da lista — e se for quem cuida da sala, outra pessoa assume.
const ALIVE_EVERY = 5000;
const ROOM_SILENCE = 20000;
const ICON = {
  vol:    '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  mute:   '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/>',
  fs:     '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  close:  '<path d="M18 6 6 18M6 6l12 12"/>',
  screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  file:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  hash:   '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  plus:   '<path d="M12 5v14M5 12h14"/>',
  more:   '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  trash:  '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  invite: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  reload: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  door:   '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  crown:  '<path d="M3 7l4.5 5L12 5l4.5 7L21 7l-2 11H5L3 7z"/>',
  cog:    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
};
const svg = (paths, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IS_APP = !!window.tav;   // rodando dentro do app de Windows (Electron)
const canShare = IS_APP ||
  (!!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && window.isSecureContext);

// Como a sala funciona:
//  - Cada sala de transmissão de um grupo tem um código fixo: o ID do canal no Firebase.
//  - Cada pessoa é um "participante" (um Peer com ID <prefixo><código>-<aleatório>).
//  - O "dono" roda, além disso, o papel de SALA: um segundo Peer com o ID <prefixo><código>, que
//    guarda a lista de quem está na sala e repassa recados. Todo mundo (inclusive o dono) se conecta
//    a esse Peer da sala.
//  - Se o dono sai, a conexão com a sala cai e o próximo da lista (por ordem de chegada) assume o
//    papel de sala com o mesmo código. As transmissões vão direto de um participante pro outro,
//    então continuam funcionando durante a troca.
const S = {
  peer: null, myId: '', myName: '', code: '',
  roomSeen: 0, aliveTimer: null,   // última vez que a sala deu sinal de vida / meu sinal de vida
  group: null,            // { gid, cid, name } — a sala de transmissão (canal) em que estou
  entered: false,         // já entrei de fato (conectado à sala)
  focus: '',              // a transmissão em destaque (grande); as outras ficam pequenas embaixo
  busy: false, leaving: false, joining: null,
  room: null,             // { peer, conns, roster, order, rebuildUntil, timer } — só no PC do dono
  roomConn: null,         // minha conexão com a sala
  ownerId: '',            // participante que é o dono agora
  lostOwner: '',          // dono que acabou de sair (durante a troca)
  migrating: false,
  view: new Map(),        // id -> { name, sharing, seq, audio, order }
  viewReady: false,
  localStream: null, seq: 0, quality: QUALITY['1080-30'],
  audioMode: 'none',      // 'system' (PC sem Discord) | 'app' (só a janela) | 'loopback' (PC inteiro) | 'none'
  wanted: new Set(),      // quem pediu para assistir minha transmissão atual
  watchers: new Set(),    // quem já está vendo de fato (conexão aberta)
  watching: new Map(),    // id -> seq das transmissões que EU escolhi assistir
  encoder: 'gpu',         // escolha: 'gpu' (placa de vídeo, H.264) | 'cpu' (processador, VP8)
  encoderUsed: null,      // o que o navegador realmente está usando: 'gpu' | 'cpu'
  hw: { cpu: '', gpu: '' },   // marcas detectadas (Intel / AMD / NVIDIA)
  pings: new Map(),       // id -> ping em ms (conexões diretas que eu tenho com cada pessoa)
  since: { room: 0, share: 0, watch: 0 },   // quando entrei / comecei a transmitir / a assistir (Discord)
  outCalls: new Map(),    // id -> { call, seq }  (quem está recebendo minha tela)
  tiles: new Map(),       // id -> tile  (telas que estou assistindo)
};

// ---------------- utilidades ----------------
function randCode(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
const cleanName = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Anônimo';
const initial = (name) => (Array.from(String(name || '').trim())[0] || '?').toUpperCase();
const roomId = () => PREFIX + S.code;
const nameOf = (id) => (S.view.get(id) || {}).name || 'Alguém';
const hasAudio = () => !!(S.localStream && S.localStream.getAudioTracks().length);
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

function toast(text, kind = '', ms = 4000, onClick) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind + (onClick ? ' click' : '');
  el.textContent = text;
  if (onClick) el.onclick = () => { el.remove(); onClick(); };
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}
function setNet(text, cls) {
  for (const el of [$('netStatus'), $('voiceStatus')]) {
    el.textContent = text;
    el.className = 'status ' + (cls || '');
  }
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
    toast('Não consegui carregar o app. Feche e abra de novo.', 'err');
    return false;
  }
  return true;
}
function readName() {
  const me = window.SPAuth && window.SPAuth.profile();
  if (!me || !me.nick) {
    showAuth('login');
    return '';
  }
  S.myName = me.nick;
  return S.myName;
}
function updateAwake() {
  // Não deixa o monitor apagar enquanto você transmite ou assiste.
  if (IS_APP) window.tav.keepAwake(!!S.localStream || S.tiles.size > 0);
}

// ---------------- status no Discord (Rich Presence) ----------------
// Transmitindo tem prioridade; senão, assistindo alguém; senão, só na sala. Manda só quando muda
// (o Discord limita a poucas atualizações por segundo).
let presenceTimer = null;
let presenceLast = '';
function updatePresence() {
  if (!IS_APP || !window.tav.presence) return;
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => {
    let state = null;
    if (S.code && S.peer && !S.leaving) {
      const people = S.view.size || 1;
      if (S.localStream) {
        state = { mode: 'share', viewers: S.watchers.size, people, since: S.since.share };
      } else if (S.tiles.size) {
        const names = [...S.tiles.keys()].map(nameOf);
        const who = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' e ' + names[names.length - 1];
        state = { mode: 'watch', who, people, since: S.since.watch };
      } else {
        state = { mode: 'room', people, since: S.since.room };
      }
    }
    const key = JSON.stringify(state);
    if (key === presenceLast) return;
    presenceLast = key;
    window.tav.presence(state);
  }, 800);
}

// ---------------- sons de aviso (estilo Discord, gerados na hora) ----------------
let sfxCtx = null;
// Volume dos avisos (Configurações → Sons), de 0 a 1.
let sfxVolume = (() => {
  const v = store('tav-sfx-vol');
  return v === null ? 1 : Math.min(1, Math.max(0, Number(v) / 100 || 0));
})();
const SFX = {
  join:    [[587.33, 0, 0.16], [880, 0.09, 0.24]],                                   // alguém entrou
  leave:   [[880, 0, 0.16], [523.25, 0.09, 0.26]],                                   // alguém saiu
  live:    [[523.25, 0, 0.3], [659.25, 0.07, 0.3], [783.99, 0.14, 0.3], [1046.5, 0.21, 0.4]], // começou a transmitir
  liveEnd: [[783.99, 0, 0.24], [659.25, 0.07, 0.24], [523.25, 0.14, 0.3]],          // parou de transmitir
  viewer:  [[1318.5, 0, 0.12], [1760, 0.06, 0.2]],                                  // alguém começou a te assistir
  message: [[987.77, 0, 0.1], [1318.5, 0.07, 0.16]],                                // mensagem privada nova
};
function sfx(name) {
  if (!SFX[name] || sfxVolume <= 0) return;
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
      gain.gain.exponentialRampToValueAtTime(0.16 * sfxVolume, now + at + 0.015);
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
const VIDEO_BITRATES = 'x-google-start-bitrate=3000;x-google-min-bitrate=1000;x-google-max-bitrate=25000';
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
      if (opened) return;
      opened = true;
      clearTimeout(timer);
      resolve(peer);
    });
    peer.on('error', (err) => {
      if (opened) return;
      clearTimeout(timer);
      peer.destroy();
      reject(err);
    });
    // Caiu a ligação com o servidor de sinalização: reconecta (as conexões diretas continuam).
    peer.on('disconnected', () => {
      setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 1500);
    });
  });
}

function setupParticipant(peer) {
  S.peer = peer;
  S.myId = peer.id;
  peer.on('error', (err) => { if (S.peer === peer) onPeerError(err); });
  peer.on('call', onIncomingCall);
  peer.on('disconnected', () => {
    if (S.peer === peer && !S.leaving) setNet('Reconectando ao servidor…', 'bad');
  });
  peer.on('open', () => {   // de novo = reconectou ao servidor
    if (S.peer !== peer) return;
    if (S.roomConn) setNet('Conectado', 'ok');
    syncCalls();
  });
}

function onPeerError(err) {
  if (err.type === 'peer-unavailable') {
    if (S.joining) S.joining.fail();
    return;   // fora isso: alguém saiu enquanto eu ligava pra ele — normal
  }
  if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(err.type)) {
    setNet('Sem conexão com o servidor…', 'bad');
    return;
  }
  console.warn('[peer]', err.type, err);
}

// ---------------- papel de "sala" (roda no PC do dono) ----------------
async function startHosting(code, rebuilding) {
  const peer = await openPeer(PREFIX + code);
  const room = { peer, conns: new Map(), roster: new Map(), seen: new Map(), order: 0, rebuildUntil: 0, timer: null, beat: null, sweep: null };
  peer.on('connection', (conn) => roomAccept(room, conn));
  peer.on('error', (err) => console.warn('[sala]', err.type));
  if (rebuilding) {
    // Durante a troca de dono, a lista ainda está sendo remontada: os outros não removem ninguém.
    room.rebuildUntil = Date.now() + 6000;
    room.timer = setTimeout(() => roomBroadcast(room), 6200);
  }
  S.room = room;
  room.beat = setInterval(() => publishRoom(true), ROOM_BEAT);   // "ainda estamos aqui" pra quem olha de fora
  room.sweep = setInterval(() => roomSweep(room), ALIVE_EVERY);
  return room;
}

function stopHosting() {
  const room = S.room;
  S.room = null;
  if (!room) return;
  clearTimeout(room.timer);
  clearInterval(room.beat);
  clearInterval(room.sweep);
  try { room.peer.destroy(); } catch {}
}

function roomAccept(room, conn) {
  if (!conn.peer.startsWith(roomId() + '-')) { conn.close(); return; }
  const pid = conn.peer;
  conn.on('data', (msg) => {
    if (S.room !== room || !msg || typeof msg !== 'object') return;
    room.seen.set(pid, Date.now());
    if (msg.t === 'alive') return;
    if (msg.t === 'hello') {
      // Confere a conta (credencial assinada pelo Google) e se a pessoa é mesmo do grupo.
      const gid = S.group && S.group.gid;
      window.SPAuth.verifyToken(msg.token).then(async (who) => (
        who && who.name && gid && await memberOk(gid, who.uid) ? who : null
      )).then((who) => {
        if (S.room !== room || !conn.open) return;
        if (!who) {
          try { conn.send({ t: 'denied' }); } catch {}
          setTimeout(() => { try { conn.close(); } catch {} }, 300);
          return;
        }
        room.conns.set(pid, conn);
        let order = Number(msg.order) || 0;
        if (order > 0) room.order = Math.max(room.order, order);
        else order = ++room.order;
        room.roster.set(pid, {
          name: cleanName(who.name), uid: who.uid, sharing: !!msg.sharing, seq: Number(msg.seq) || 0, audio: !!msg.audio, order,
        });
        roomBroadcast(room);
      });
    } else if (msg.t === 'state') {
      const p = room.roster.get(pid);
      if (!p) return;
      p.sharing = !!msg.sharing;
      p.seq = Number(msg.seq) || 0;
      p.audio = !!msg.audio;
      roomBroadcast(room);
      // Trocou o nick: vale o que está na credencial nova (e só se for a mesma conta).
      if (typeof msg.token === 'string') {
        window.SPAuth.verifyToken(msg.token).then((who) => {
          if (S.room !== room || !who || who.uid !== p.uid || !who.name) return;
          p.name = cleanName(who.name);
          roomBroadcast(room);
        });
      }
    } else if (!room.roster.has(pid)) {
      // recados só de quem já foi conferido
    } else if (msg.t === 'relay' && typeof msg.to === 'string') {
      const target = room.conns.get(msg.to);
      if (target && target.open) { try { target.send({ t: 'relayed', from: pid, msg: msg.msg }); } catch {} }
    } else if (msg.t === 'cast') {
      for (const [id, c] of room.conns) {
        if (id !== pid && c.open) { try { c.send({ t: 'relayed', from: pid, msg: msg.msg }); } catch {} }
      }
    }
  });
  const drop = () => {
    if (room.conns.get(pid) !== conn) return;
    room.conns.delete(pid);
    if (room.roster.delete(pid)) roomBroadcast(room);
  };
  conn.on('close', drop);
  conn.on('error', drop);
}

// Manda sinal de vida pra todo mundo e tira da sala quem ficou calado demais.
function roomSweep(room) {
  if (S.room !== room) return;
  const now = Date.now();
  for (const [pid, c] of [...room.conns]) {
    if (now - (room.seen.get(pid) || 0) > ROOM_SILENCE) {
      room.conns.delete(pid);
      room.seen.delete(pid);
      try { c.close(); } catch {}
      if (room.roster.delete(pid)) roomBroadcast(room);
    } else if (c.open) {
      try { c.send({ t: 'alive' }); } catch {}
    }
  }
}

function roomBroadcast(room) {
  if (S.room !== room) return;
  const list = [...room.roster].map(([id, p]) => ({ id, ...p })).sort((a, b) => a.order - b.order);
  const msg = { t: 'roster', list, owner: S.myId, merge: Date.now() < room.rebuildUntil };
  for (const c of room.conns.values()) {
    if (c.open) { try { c.send(msg); } catch {} }
  }
  publishRoom();
}

// ---------------- eu (participante) <-> sala ----------------
function connectRoom(timeoutMs) {
  return new Promise((resolve) => {
    if (!S.peer || S.peer.destroyed) return resolve({ error: 'offline' });
    let conn;
    try { conn = S.peer.connect(roomId(), { reliable: true, serialization: 'json' }); } catch { conn = null; }
    if (!conn) return resolve({ error: 'offline' });
    let done = false;
    const hook = { fail: () => finish({ error: 'missing' }) };
    const timer = setTimeout(() => finish({ error: 'timeout' }), timeoutMs);
    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (S.joining === hook) S.joining = null;
      if (!result.conn) { try { conn.close(); } catch {} }
      resolve(result);
    }
    S.joining = hook;
    conn.on('open', () => finish({ conn }));
    conn.on('error', () => finish({ error: 'error' }));
  });
}

function attachRoom(conn) {
  S.roomConn = conn;
  S.roomSeen = Date.now();
  clearInterval(S.aliveTimer);
  S.aliveTimer = setInterval(() => {
    if (S.roomConn !== conn) return;
    if (Date.now() - S.roomSeen > ROOM_SILENCE) {   // quem cuidava da sala sumiu sem avisar
      try { conn.close(); } catch {}
      onRoomLost(conn);
      return;
    }
    sendRoom({ t: 'alive' });
  }, ALIVE_EVERY);
  conn.on('data', onRoomMessage);
  conn.on('close', () => onRoomLost(conn));
  conn.on('error', () => onRoomLost(conn));
  const me = S.view.get(S.myId);
  // Leva a credencial da conta: quem cuida da sala confere e usa o nick que está nela.
  window.SPAuth.idToken().catch(() => '').then((token) => {
    if (S.roomConn !== conn || !conn.open) return;
    conn.send({
      t: 'hello', token, name: S.myName, order: me && me.order ? me.order : undefined,
      sharing: !!S.localStream, seq: S.seq, audio: hasAudio(),
    });
  });
  if (S.entered) setNet('Conectado', 'ok');
}

function onRoomMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  S.roomSeen = Date.now();
  if (msg.t === 'roster' && Array.isArray(msg.list)) applyRoster(msg.list, msg.owner, !!msg.merge);
  else if (msg.t === 'relayed' && typeof msg.from === 'string' && msg.msg && typeof msg.msg === 'object') onRelayed(msg.from, msg.msg);
  else if (msg.t === 'denied') leaveRoom('Não consegui confirmar sua conta. Saia da conta e entre de novo.');
}

function sendRoom(msg) {
  if (!S.roomConn || !S.roomConn.open) return false;
  try { S.roomConn.send(msg); return true; } catch { return false; }
}
const relay = (to, msg) => sendRoom({ t: 'relay', to, msg });
const cast = (msg) => sendRoom({ t: 'cast', msg });
// withIdentity: manda junto a credencial (depois de trocar o nick, pra sala atualizar o nome).
function sendState(withIdentity) {
  const state = { t: 'state', sharing: !!S.localStream, seq: S.seq, audio: hasAudio() };
  if (!withIdentity) return sendRoom(state);
  window.SPAuth.idToken().catch(() => '').then((token) => sendRoom({ ...state, token }));
  return true;
}

// A conexão com a sala caiu: o dono saiu (ou a internet piscou). Alguém assume a sala.
function onRoomLost(conn) {
  if (S.leaving || S.roomConn !== conn) return;
  S.roomConn = null;
  S.lostOwner = S.ownerId;
  setNet('Reconectando à sala…', 'warn');
  migrate();
}

async function migrate() {
  if (S.migrating) return;
  S.migrating = true;
  // Quem assume primeiro: o próximo da lista por ordem de chegada (sem o dono que saiu).
  const order = [...S.view]
    .filter(([id]) => id !== S.lostOwner)
    .sort((a, b) => (a[1].order || 0) - (b[1].order || 0))
    .map(([id]) => id);
  const myTurn = Math.max(0, order.indexOf(S.myId));
  const deadline = Date.now() + 75000;
  for (let attempt = 0; !S.leaving && S.peer && Date.now() < deadline; attempt++) {
    // A sala já voltou (com outro dono, ou era só a internet)? Entra nela.
    if (!(attempt === 0 && myTurn === 0)) {
      const r = await connectRoom(4000);
      if (S.leaving) break;
      if (r.conn) { attachRoom(r.conn); S.migrating = false; return; }
    }
    // Na minha vez (ou se ninguém assumiu ainda), eu assumo a sala.
    if (attempt >= myTurn && !S.room) {
      try {
        await startHosting(S.code, true);
        const r = await connectRoom(6000);
        if (r.conn) { attachRoom(r.conn); S.migrating = false; return; }
        stopHosting();
      } catch { /* outra pessoa assumiu primeiro (ou o código antigo ainda está preso) */ }
    }
    await sleep(1500);
  }
  S.migrating = false;
  if (!S.leaving && S.peer) leaveRoom('A sala caiu e não deu para reconectar.');
}

// ---------------- entrar / sair de uma sala de transmissão ----------------
// A sala de um grupo é fixa (o código é o ID do canal). Quem entra numa sala vazia passa a cuidar
// dela (papel de "sala"); se essa pessoa sair, a próxima assume, como sempre.
async function connectStream() {
  let peer;
  try {
    peer = await openPeer(`${roomId()}-${randCode(8)}`);
  } catch (err) {
    return { error: peerErrMsg(err) };
  }
  if (S.leaving) { try { peer.destroy(); } catch {} return { error: '' }; }
  setupParticipant(peer);
  S.view = new Map([[S.myId, { name: S.myName, uid: G.uid, sharing: false, seq: 0, audio: false, order: 0 }]]);
  const deadline = Date.now() + 40000;
  while (!S.leaving && Date.now() < deadline) {
    const r = await connectRoom(8000);
    if (S.leaving) break;
    if (r.conn) { attachRoom(r.conn); return { ok: true }; }
    if (r.error === 'missing' && !S.room) {
      // Sala vazia: eu passo a cuidar dela. (Se outra pessoa assumiu junto, entro na dela.)
      try { await startHosting(S.code, false); } catch (err) { if (err.type !== 'unavailable-id') await sleep(1500); }
    } else {
      await sleep(1000);
    }
  }
  stopHosting();
  try { peer.destroy(); } catch {}
  if (S.peer === peer) S.peer = null;
  return { error: S.leaving ? '' : 'Não consegui entrar na sala. Confira sua internet e tente de novo.' };
}

async function joinStream(gid, ch) {
  if (S.busy || !readName() || !libOk()) return;
  if (S.peer || S.group) leaveRoom();
  S.busy = true;
  S.leaving = false;
  S.code = ch.id;
  S.group = { gid, cid: ch.id, name: ch.name };
  setNet('Conectando…', 'warn');
  renderVoice();
  renderChannels();
  const r = await connectStream();
  S.busy = false;
  if (!r.ok) {
    if (r.error) leaveRoom(r.error, true);   // sem erro = a pessoa desistiu enquanto conectava
    return;
  }
  enterRoom();
}

function enterRoom() {
  S.entered = true;
  S.since = { room: Date.now(), share: 0, watch: 0 };
  setNet('Conectado', 'ok');
  showView('room');
  renderRoomHead();
  renderPeople();
  renderShareUI();
  renderStage();
  renderVoice();
  sfx('join');
  clearInterval(pingTimer);
  pingTimer = setInterval(measurePings, 2000);
  measurePings();
}

// quiet: sem o som de saída (nem chegou a entrar).
function leaveRoom(reason, quiet) {
  if (S.leaving && !S.peer && !S.group) return;
  S.leaving = true;
  if (!quiet) sfx('leave');
  clearInterval(pingTimer);
  pingTimer = null;
  clearInterval(S.aliveTimer);
  closePicker(null);
  stopShare(true);
  for (const id of [...S.tiles.keys()]) removeTile(id);
  // Eu cuidava da sala e era o último: quem olha de fora já vê a sala vazia.
  if (S.room && S.group && S.room.roster.size <= 1) {
    GAPI().setRoom(S.group.gid, S.group.cid, []).catch(() => {});
  }
  stopHosting();   // se eu cuidava da sala, a próxima pessoa assume
  try { if (S.peer) S.peer.destroy(); } catch {}
  Object.assign(S, {
    peer: null, myId: '', code: '', group: null, entered: false, joining: null, room: null, roomConn: null,
    ownerId: '', lostOwner: '', migrating: false, view: new Map(), viewReady: false, outCalls: new Map(),
    tiles: new Map(), seq: 0, wanted: new Set(), watchers: new Set(), watching: new Map(), audioMode: 'none',
    encoderUsed: null, pings: new Map(), focus: '',
  });
  $('grid').textContent = '';
  $('reactLayer').textContent = '';
  renderVoice();
  if (G.view === 'room') showDefaultView();
  else renderChannels();
  if (reason) toast(reason, 'err', 6000);
  updateAwake();
  updatePresence();
}

// ---------------- ping ----------------
// Mede o tempo de ida e volta (RTT) das conexões diretas: convidado <-> dono da sala, dono <-> cada
// convidado, e com quem eu estou assistindo. Verde até 80 ms, amarelo até 150 ms, vermelho acima.
let pingTimer = null;
const PING_GOOD = 80;
const PING_OK = 150;

async function rttOf(pc) {
  if (!pc || pc.connectionState === 'closed') return null;
  try {
    const stats = await pc.getStats();
    let selected = null;
    let rtt = null;
    stats.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) selected = r.selectedCandidatePairId; });
    stats.forEach((r) => {
      if (r.type !== 'candidate-pair' || typeof r.currentRoundTripTime !== 'number') return;
      if (selected ? r.id === selected : (r.nominated && r.state === 'succeeded')) rtt = r.currentRoundTripTime;
    });
    return rtt === null ? null : Math.max(1, Math.round(rtt * 1000));
  } catch {
    return null;
  }
}

async function measurePings() {
  if (!S.peer) return;
  const targets = new Map();
  if (S.room) {
    for (const [id, conn] of S.room.conns) if (id !== S.myId) targets.set(id, conn.peerConnection);
  } else if (S.roomConn && S.ownerId) {
    targets.set(S.ownerId, S.roomConn.peerConnection);
  }
  for (const [id, tile] of S.tiles) if (!targets.has(id)) targets.set(id, tile.call.peerConnection);
  const pings = new Map();
  await Promise.all([...targets].map(async ([id, pc]) => {
    const ms = await rttOf(pc);
    if (ms !== null) pings.set(id, ms);
  }));
  if (!S.peer) return;
  S.pings = pings;
  renderPing();
}

function renderPing() {
  const el = $('pingBadge');
  const others = [...S.view.keys()].filter((id) => id !== S.myId);
  const entries = [...S.pings].filter(([id]) => S.view.has(id) && id !== S.myId);
  let level = 'none';
  let tip;
  if (!others.length) {
    tip = 'Sozinho na sala — sem ping para medir';
  } else if (!entries.length) {
    tip = 'Medindo ping…';
  } else {
    const worst = Math.max(...entries.map(([, ms]) => ms));
    level = worst <= PING_GOOD ? 'good' : worst <= PING_OK ? 'warn' : 'bad';
    tip = entries.length === 1
      ? `Ping: ${entries[0][1]} ms`
      : 'Ping\n' + entries.map(([id, ms]) => `${nameOf(id)}: ${ms} ms`).join('\n');
  }
  el.className = 'ping ' + level;
  el.dataset.tip = tip;
  const bars = { good: 4, warn: 3, bad: 1, none: 0 }[level];
  el.querySelectorAll('rect').forEach((r, i) => r.classList.toggle('on', i < bars));
}

// ---------------- lista da sala ----------------
function applyRoster(list, owner, merge) {
  const next = new Map();
  for (const p of list) {
    if (!p || typeof p.id !== 'string') continue;
    next.set(p.id, {
      name: cleanName(p.name), uid: typeof p.uid === 'string' ? p.uid : '', sharing: !!p.sharing, seq: Number(p.seq) || 0,
      audio: !!p.audio, order: Number(p.order) || 0,
    });
  }
  // Durante a troca de dono a lista ainda está chegando: mantém quem já estava (menos quem saiu).
  if (merge) for (const [id, p] of S.view) if (!next.has(id) && id !== S.lostOwner) next.set(id, p);
  if (typeof owner === 'string' && owner) S.ownerId = owner;

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

  // Some a tela de quem saiu ou parou de transmitir (o seq evita apagar uma transmissão nova
  // que chegou antes da lista atualizada).
  for (const [id, tile] of [...S.tiles]) {
    const p = next.get(id);
    if (!p || (!p.sharing && p.seq >= tile.seq)) {
      removeTile(id);
      S.watching.delete(id);
    } else {
      tile.el.querySelector('.tname').textContent = p.name;
    }
  }
  for (const [id, seq] of [...S.watching]) {
    const p = next.get(id);
    if (!p || !p.sharing || p.seq > seq) S.watching.delete(id);
  }
  syncCalls();
  renderPeople();
  renderShareUI();
  renderStage();
}

function renderPeople() {
  renderPing();
  updatePresence();
  if (S.group && S.group.gid === G.gid) renderChannels();   // embaixo do canal e na lista de membros
}

// Opções de transmissão (Configurações → Transmissão).
function sharePrefs() {
  const q = store('tav-quality');
  return {
    quality: QUALITY[q] ? q : '1080-30',
    encoder: store('tav-encoder') === 'cpu' ? 'cpu' : 'gpu',
    audio: store('tav-audio') !== '0',
  };
}

function renderShareUI() {
  const sharing = !!S.localStream;
  $('selfBox').classList.toggle('hidden', !sharing);
  const hint = $('shareHint');
  hint.classList.toggle('hidden', !sharing);
  if (sharing) {
    const n = S.watchers.size;
    const som = {
      system: 'som do PC (sem Discord)',
      app: 'som só deste app',
      loopback: 'som do PC inteiro',
    }[S.audioMode] || 'sem som';
    const enc = {
      gpu: ` · H.264 na placa${S.hw.gpu ? ' ' + S.hw.gpu : ' de vídeo'}`,
      cpu: ` · VP8 no processador${S.hw.cpu ? ' ' + S.hw.cpu : ''}`,
    }[S.encoderUsed] || '';
    hint.textContent = `● Ao vivo · ${n} assistindo`;
    hint.title = `Ao vivo · ${n} ${n === 1 ? 'pessoa assistindo' : 'pessoas assistindo'} · ${som}${enc}`;
  }
  renderVoice();
  updateAwake();
  updatePresence();
}

// Telas que estou assistindo + um cartão "Assistir" para cada transmissão que ainda não abri.
// A escolhida fica em destaque (grande, dentro do app) e as outras ficam pequenas embaixo.
// Tela cheia só pelo botão (ou clicando duas vezes).
function renderStage() {
  const grid = $('grid');
  for (const el of [...grid.querySelectorAll('.card-stream')]) el.remove();
  const live = [...S.view].filter(([id, p]) => id !== S.myId && p.sharing && !S.tiles.has(id));
  for (const [id, p] of live) grid.appendChild(makeCard(id, p));
  if (!S.tiles.has(S.focus) && !S.watching.has(S.focus)) S.focus = '';
  const main = S.tiles.has(S.focus) ? S.focus : (S.tiles.size ? [...S.tiles.keys()][0] : '');
  const spot = !!main;
  const minis = S.tiles.size - (spot ? 1 : 0) + live.length;
  grid.classList.toggle('spot', spot);
  grid.style.setProperty('--strip', spot && minis ? '136px' : '0px');
  for (const [id, t] of S.tiles) {
    t.el.classList.toggle('main', id === main);
    t.el.classList.toggle('tmini', spot && id !== main);
  }
  for (const el of grid.querySelectorAll('.card-stream')) el.classList.toggle('tmini', spot);
  const n = S.tiles.size + live.length;
  $('empty').classList.toggle('hidden', n > 0);
  $('emptyTitle').textContent = S.localStream ? 'Você está transmitindo' : 'Ninguém está transmitindo agora';
  $('emptyText').textContent = S.localStream
    ? 'As reações de quem assiste aparecem aqui. Quando outra pessoa transmitir, ela aparece aqui também.'
    : 'Quando alguém da sala transmitir, a tela aparece aqui.';
  grid.classList.toggle('solo', !spot && n === 1);
  updateAwake();
  updatePresence();
}
function focusTile(id) {
  if (!S.tiles.has(id) || S.focus === id) return;
  S.focus = id;
  renderStage();
}

function makeCard(id, p) {
  const pending = S.watching.get(id) === p.seq;
  const el = document.createElement('div');
  el.className = 'tile card-stream';
  el.innerHTML = `
    <div class="cs">
      ${svg(ICON.screen, 46)}
      <div class="cs-name"></div>
      <div class="cs-meta"><span class="pill live">AO VIVO</span><span class="cs-aud"></span></div>
      <button class="btn primary" type="button"></button>
    </div>`;
  el.querySelector('.cs-name').textContent = p.name;
  el.querySelector('.cs-aud').textContent = p.audio ? 'com som' : 'sem som';
  const btn = el.querySelector('button');
  btn.textContent = pending ? 'Conectando…' : 'Assistir';
  btn.disabled = pending;
  btn.onclick = () => watch(id);
  return el;
}

// ---------------- assistir quando quiser (estilo Discord) ----------------
function watch(id) {
  const p = S.view.get(id);
  if (!p || !p.sharing || S.tiles.has(id)) return;
  const seq = p.seq;
  S.watching.set(id, seq);
  S.focus = id;   // a que eu escolhi assistir abre em destaque
  if (!relay(id, { t: 'watch', on: true, seq })) {
    S.watching.delete(id);
    toast('Sem conexão com a sala agora — tente de novo em instantes.', 'warn');
  }
  renderStage();
  setTimeout(() => {
    if (S.watching.get(id) === seq && !S.tiles.has(id)) {
      S.watching.delete(id);
      renderStage();
      toast(`Não consegui abrir a transmissão de ${nameOf(id)}.`, 'warn');
    }
  }, 15000);
}

function unwatch(id) {
  S.watching.delete(id);
  relay(id, { t: 'watch', on: false });
  removeTile(id);
}

// Recados de outras pessoas (repassados pela sala).
function onRelayed(from, msg) {
  if (msg.t === 'watch') {
    if (msg.on) {
      if (!S.localStream || (msg.seq && Number(msg.seq) !== S.seq) || !S.view.has(from)) return;
      S.wanted.add(from);
      syncCalls();
    } else {
      S.wanted.delete(from);
      closeOut(from);
      S.watchers.delete(from);
      renderShareUI();
    }
  } else if (msg.t === 'react') {
    if (!REACTIONS.includes(msg.emoji) || typeof msg.target !== 'string') return;
    if (msg.target !== S.myId && !S.tiles.has(msg.target)) return;
    showReaction(msg.target, msg.emoji, nameOf(from));
  }
}

// ---------------- reações na tela ----------------
let lastReact = 0;
function react(target, emoji) {
  const now = Date.now();
  if (now - lastReact < 250) return;
  lastReact = now;
  showReaction(target, emoji, S.myName);
  cast({ t: 'react', target, emoji });
}

// Quem transmite vê as reações subindo no canto da área principal; quem assiste, por cima da tela.
function showReaction(target, emoji, who) {
  let layer;
  let left;
  if (target === S.myId) {
    layer = $('reactLayer');
    left = 62 + Math.random() * 28;
  } else {
    const tile = S.tiles.get(target);
    if (!tile) return;
    layer = tile.el.querySelector('.react-layer');
    left = 8 + Math.random() * 72;
  }
  const el = document.createElement('div');
  el.className = 'react';
  el.style.left = left + '%';
  const e = document.createElement('span');
  e.className = 'emoji';
  e.textContent = emoji;
  const n = document.createElement('span');
  n.className = 'who';
  n.textContent = who;
  el.append(e, n);
  layer.appendChild(el);
  while (layer.children.length > 30) layer.firstChild.remove();
  setTimeout(() => el.remove(), 3000);
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
  $('pickNote').textContent = !sharePrefs().audio ? 'Sem som'
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
  const prefs = sharePrefs();
  const q = QUALITY[prefs.quality];
  const withAudio = prefs.audio;
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
  S.encoder = prefs.encoder;
  S.encoderUsed = null;
  S.seq += 1;
  S.since.share = Date.now();
  S.wanted = new Set();
  S.watchers = new Set();
  $('selfPreview').srcObject = stream;
  sendState();
  renderShareUI();
  renderStage();
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
  S.wanted = new Set();
  S.watchers = new Set();
  for (const id of [...S.outCalls.keys()]) closeOut(id);
  $('selfPreview').srcObject = null;
  $('reactLayer').textContent = '';
  if (!silent) {
    sendState();
    sfx('liveEnd');
  }
  renderShareUI();
  renderStage();
}

// Manda minha tela só para quem pediu para assistir (e ainda está na sala).
function syncCalls() {
  for (const id of [...S.wanted]) if (!S.view.has(id)) S.wanted.delete(id);
  for (const id of [...S.outCalls.keys()]) if (!S.wanted.has(id)) closeOut(id);
  for (const id of [...S.watchers]) if (!S.wanted.has(id)) S.watchers.delete(id);
  if (!S.localStream) return;
  for (const id of S.wanted) {
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
    S.watchers.delete(id);
    renderShareUI();
    if (tries >= 3) return;
    setTimeout(() => {
      if (S.localStream && S.seq === seq && S.wanted.has(id) && S.view.has(id) && !S.outCalls.has(id)) callPeer(id, tries + 1);
    }, 2000);
  };
  call.on('close', retry);
  call.on('error', retry);
}

// Confere qual codificador o navegador realmente usou (a placa pode não estar disponível).
async function detectEncoder(pc, seq) {
  await sleep(1500);
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
  // Só aceita transmissões desta sala que eu pedi para assistir.
  if (!S.code || !call.peer.startsWith(roomId() + '-') || !S.watching.has(call.peer)) { call.close(); return; }
  const seq = Number(call.metadata && call.metadata.seq) || 0;
  const old = S.tiles.get(call.peer);
  if (old && old.seq > seq) { call.close(); return; }
  if (old) removeTile(call.peer);

  call.answer(undefined, { sdpTransform: (sdp) => tuneSdp(sdp, null) });   // não envio nada de volta
  if (!S.tiles.size) S.since.watch = Date.now();
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
    <div class="react-layer"></div>
    <div class="tile-wait"><div class="spin"></div><span>Conectando à transmissão…</span></div>
    <button class="btn unmute hidden" type="button">${svg(ICON.vol)} Clique para ouvir o som</button>
    <div class="tile-bar">
      <span class="pill live">AO VIVO</span>
      <span class="tname"></span>
      <div class="reacts"></div>
      <span class="aud-off hidden">sem som</span>
      <div class="aud hidden">
        <button class="ib mute" type="button" title="Silenciar">${svg(ICON.vol)}</button>
        <input class="vol" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume">
      </div>
      <button class="ib fs" type="button" title="Tela cheia (ou clique duas vezes)">${svg(ICON.fs)}</button>
      <button class="ib stopw" type="button" title="Parar de assistir">${svg(ICON.close)}</button>
    </div>`;
  const video = el.querySelector('video');
  const muteBtn = el.querySelector('.mute');
  const vol = el.querySelector('.vol');
  const unmuteBtn = el.querySelector('.unmute');
  el.querySelector('.tname').textContent = nameOf(id);

  const reacts = el.querySelector('.reacts');
  for (const emoji of REACTIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = emoji;
    b.title = 'Reagir';
    b.onclick = () => react(id, emoji);
    reacts.appendChild(b);
  }

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
  el.querySelector('.stopw').onclick = () => unwatch(id);
  video.ondblclick = toggleFs;
  // Clicar numa tela pequena (embaixo) traz ela pro destaque.
  el.addEventListener('click', (e) => {
    if (el.classList.contains('tmini') && !e.target.closest('button, input')) focusTile(id);
  });

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

  $('grid').prepend(el);
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

// ---------------- marca do processador e da placa de vídeo ----------------
function labelEncoders() {
  for (const o of $('setEncoder').options) {
    if (o.value === 'gpu') o.textContent = S.hw.gpu ? `H.264 · Placa ${S.hw.gpu}` : 'H.264 · Placa de vídeo';
    if (o.value === 'cpu') o.textContent = S.hw.cpu ? `VP8 · Processador ${S.hw.cpu}` : 'VP8 · Processador';
  }
}
if (IS_APP && window.tav.hardware) {
  window.tav.hardware().then((hw) => {
    S.hw = { cpu: (hw && hw.cpu) || '', gpu: (hw && hw.gpu) || '' };
    labelEncoders();
    renderShareUI();
  }).catch(() => {});
}

// ---------------- grupos (estilo Discord) ----------------
// Barra da esquerda = seus grupos. Dentro de cada grupo: canais de texto (conversa ao vivo pelo
// Firebase) e salas de transmissão (a sala de sempre, pelo PeerJS — o código é o ID do canal).
// Só o dono do grupo cria, renomeia e apaga canais.
const ROOM_BEAT = 2 * 60 * 1000;    // quem cuida da sala avisa "ainda estamos aqui" a cada 2 min
const ROOM_FRESH = 5 * 60 * 1000;   // aviso mais velho que isso = sala vazia (o PC de quem cuidava caiu)
const MSG_GAP = 7 * 60 * 1000;      // mensagens seguidas da mesma pessoa (até 7 min) ficam juntas
const G = {
  uid: '', list: new Map(), ready: false, unsub: null, error: '',
  gid: '', channels: null, chError: '', chUnsub: null, rooms: {}, roomsUnsub: null,
  cid: '', view: 'welcome',
  goneOk: new Set(),    // grupos que eu mesmo saí ou apaguei (sem aviso)
  synced: new Set(),    // grupos onde já atualizei meu nome
  wantGid: '',          // abrir assim que aparecer na lista (acabei de criar ou entrar)
  wantCid: '',          // idem, para um canal de texto que acabei de criar
  dm: '',               // conversa privada aberta (no Início)
  wantDm: '',           // abrir assim que a conversa nova aparecer
};
// Mensagens do canal de texto aberto.
const M = { t: null, key: '', live: [], older: [], more: false, loaded: false, loading: false, error: '', unsub: null, atBottom: true };
const GAPI = () => window.SPAuth.groups;

const GROUP_ERRORS = {
  'group/name': 'Dê um nome para o grupo.',
  'channel/name': 'Dê um nome para o canal.',
  'invite/invalid': 'O convite tem 8 letras e números. Confira e tente de novo.',
  'invite/not-found': 'Não achei nenhum grupo com esse convite. Confira o código (o dono pode ter trocado).',
  'permission-denied': 'O Firebase não deixou. Confira se as regras novas do Firestore foram publicadas.',
  'unavailable': 'Sem conexão com o banco de dados. Confira sua internet.',
  'auth/no-user': 'Entre na sua conta de novo.',
};
function groupErr(err, what) {
  return GROUP_ERRORS[err && err.code] || `${what || 'Não deu certo'}${err && err.code ? ` (${err.code})` : ''}.`;
}
const groupOf = (gid) => G.list.get(gid);
function isOwner(gid = G.gid) {
  const g = groupOf(gid);
  return !!(g && g.ownerUid === G.uid);
}
const sortedGroups = () => [...G.list.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.name.localeCompare(b.name));
function groupInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = (w) => Array.from(w)[0] || '';
  return (words.length > 1 ? first(words[0]) + first(words[1]) : Array.from(words[0]).slice(0, 2).join('')).toUpperCase();
}

// Último grupo e último canal abertos (por conta).
function loadNav() {
  try { return JSON.parse(store('sp-nav-' + G.uid) || '{}') || {}; } catch { return {}; }
}
function saveNav() {
  if (!G.uid) return;
  const nav = loadNav();
  nav.gid = G.gid;
  nav.last = nav.last && typeof nav.last === 'object' ? nav.last : {};
  if (G.gid && G.cid) nav.last[G.gid] = G.cid;
  store('sp-nav-' + G.uid, JSON.stringify(nav));
}

// ----- ligar / desligar (entrar e sair da conta) -----
function startGroups(uid) {
  if (G.uid === uid && G.unsub) return;
  stopGroups();
  G.uid = uid;
  startDms();
  G.unsub = GAPI().watchGroups(onGroups, (err) => {
    G.ready = true;
    G.error = groupErr(err, 'Não consegui carregar seus grupos');
    renderAll();
  });
  renderAll();
}
function stopGroups() {
  if (G.unsub) { try { G.unsub(); } catch {} }
  closeGroup();
  stopMessages();
  stopDms();
  Object.assign(G, { uid: '', list: new Map(), ready: false, unsub: null, error: '', goneOk: new Set(), synced: new Set(), wantGid: '', dm: '', wantDm: '' });
}
// Para de ouvir o grupo aberto.
function closeGroup() {
  if (G.chUnsub) { try { G.chUnsub(); } catch {} }
  if (G.roomsUnsub) { try { G.roomsUnsub(); } catch {} }
  stopMessages();
  Object.assign(G, { gid: '', cid: '', wantCid: '', channels: null, chError: '', chUnsub: null, rooms: {}, roomsUnsub: null });
}
function renderAll() {
  renderRail();
  renderGroupHead();
  renderChannels();
  refreshView();
}

function onGroups(list) {
  const prev = G.list;
  G.list = new Map(list.map((g) => [g.id, g]));
  G.error = '';
  for (const [gid, g] of prev) {
    if (G.list.has(gid)) continue;
    if (!G.goneOk.delete(gid)) toast(`Você não está mais no grupo “${g.name}”.`, 'warn', 6000);
    if (S.group && S.group.gid === gid) leaveRoom();
    if (G.gid === gid) closeGroup();
  }
  syncMemberNames();
  const first = !G.ready;
  G.ready = true;
  if (G.wantGid && G.list.has(G.wantGid)) {
    const gid = G.wantGid;
    G.wantGid = '';
    openGroup(gid);
  } else if (first) {
    // Abre onde parou (ou o primeiro grupo). Se da última vez estava no Início, continua lá.
    const nav = loadNav();
    const pick = G.list.has(nav.gid) ? nav.gid : nav.gid === '' ? '' : (sortedGroups()[0] || {}).id;
    if (pick) openGroup(pick);
    else renderAll();
  } else {
    renderAll();
  }
  if (S.group) { renderRoomHead(); renderVoice(); }
}

// Meu nome dentro de cada grupo acompanha o usuário da conta.
function syncMemberNames() {
  const me = window.SPAuth.profile();
  if (!me || !me.nick) return;
  for (const g of G.list.values()) {
    const mine = g.members[G.uid];
    const key = `${g.id}:${me.nick}`;
    if (!mine || mine.name === me.nick || G.synced.has(key)) continue;
    G.synced.add(key);
    GAPI().syncMemberName(g.id).catch((err) => console.warn('[grupos] nome', err && err.code));
  }
}

// ----- navegação -----
function openHome() {
  closeGroup();
  G.dm = '';
  saveNav();
  renderRail();
  renderGroupHead();
  showView('welcome');
}

function openGroup(gid) {
  if (!G.list.has(gid)) return openHome();
  if (G.gid !== gid) {
    closeGroup();
    G.gid = gid;
    G.chUnsub = GAPI().watchChannels(gid, (list) => onChannels(gid, list), (err) => {
      if (G.gid !== gid) return;
      G.chError = groupErr(err, 'Não consegui carregar os canais');
      renderChannels();
      refreshView();
    });
    G.roomsUnsub = GAPI().watchRooms(gid, (rooms) => {
      if (G.gid !== gid) return;
      G.rooms = rooms;
      renderChannels();
    });
  }
  saveNav();
  renderRail();
  renderGroupHead();
  // Estou vendo a sala deste grupo: continuo nela. Senão, abre o canal de texto.
  if (G.view === 'room' && S.group && S.group.gid === gid) renderChannels();
  else showDefaultView();
}

function onChannels(gid, list) {
  if (G.gid !== gid) return;
  G.channels = list;
  G.chError = '';
  if (S.group && S.group.gid === gid) {
    const ch = list.find((c) => c.id === S.group.cid);
    if (!ch) {
      leaveRoom('A sala foi apagada pelo dono do grupo.');
    } else if (ch.name !== S.group.name) {
      S.group.name = ch.name;
      renderRoomHead();
      renderVoice();
    }
  }
  if (G.cid && !list.some((c) => c.id === G.cid && c.type === 'text')) {
    G.cid = '';
    stopMessages();
  }
  if (G.wantCid && list.some((c) => c.id === G.wantCid)) {
    const cid = G.wantCid;
    G.wantCid = '';
    openChat(cid, true);
    return;
  }
  renderChannels();
  refreshView();
}

// Mostra de novo o que faz sentido, sem tirar a pessoa de onde ela está.
function refreshView() {
  if (G.view === 'room') return;
  if (G.view === 'chat' && M.t) {
    const dmOk = M.t.did && !G.gid && D.list.has(M.t.did);
    const chOk = !M.t.did && G.cid && M.key === chatKey({ gid: G.gid, cid: G.cid })
      && (G.channels || []).some((c) => c.id === G.cid);
    if (dmOk || chOk) {
      renderChatHead();
      return;
    }
  }
  showDefaultView();
}
function showDefaultView() {
  if (!G.gid) {
    if (G.dm && openDm(G.dm)) return;
    return showView('welcome');
  }
  if (G.channels === null) return showView('nochan');
  const texts = G.channels.filter((c) => c.type === 'text');
  const want = G.cid || (loadNav().last || {})[G.gid];
  const pick = texts.find((c) => c.id === want) || texts[0];
  if (pick) openChat(pick.id);
  else showView('nochan');
}

function showView(name) {
  G.view = name;
  for (const [id, v] of [['welcomeView', 'welcome'], ['noChanView', 'nochan'], ['chatView', 'chat'], ['roomView', 'room']]) {
    $(id).classList.toggle('hidden', v !== name);
  }
  if (name === 'welcome') renderWelcome();
  if (name === 'nochan') renderNoChan();
  if (name === 'chat' && M.atBottom) $('msgList').scrollTop = $('msgList').scrollHeight;
  renderChannels();
}

function renderWelcome() {
  const has = G.list.size > 0;
  $('welcomeTitle').textContent = !G.ready ? 'Carregando seus grupos…'
    : G.error ? 'Não consegui carregar seus grupos'
    : has ? `Olá, ${S.myName}!` : 'Crie seu primeiro grupo';
  $('welcomeText').textContent = !G.ready ? '' : G.error || (has
    ? 'Escolha um grupo na barra da esquerda — ou crie outro, ou entre num com convite.'
    : 'Um grupo é o cantinho seu e dos seus amigos: canais de texto pra conversar e salas pra transmitir a tela.');
  $('welcomeCreate').classList.toggle('hidden', !G.ready || !!G.error);
  $('welcomeJoin').classList.toggle('hidden', !G.ready || !!G.error);
}
function renderNoChan() {
  const loading = !G.chError && G.channels === null;
  $('noChanTitle').textContent = G.chError ? 'Não consegui abrir o grupo' : loading ? 'Carregando…' : 'Nenhum canal de texto';
  $('noChanText').textContent = G.chError || (loading ? '' : isOwner()
    ? 'Crie um no + ao lado de “Canais de texto”.'
    : 'O dono do grupo ainda não criou canais de texto.');
}

// ----- barra dos grupos -----
function renderRail() {
  const box = $('groupList');
  box.textContent = '';
  for (const g of sortedGroups()) {
    const item = document.createElement('div');
    item.className = 'rail-item' + (g.id === G.gid ? ' active' : '');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rail-btn';
    if (g.photo) paintPhoto(b, g.photo);
    else b.textContent = groupInitials(g.name);
    b.dataset.tip = g.name;
    b.setAttribute('aria-label', g.name);
    b.onclick = () => openGroup(g.id);
    b.oncontextmenu = (e) => { e.preventDefault(); groupMenu(g.id, e.clientX, e.clientY); };
    item.appendChild(b);
    if (S.group && S.group.gid === g.id) {
      const dot = document.createElement('span');
      dot.className = 'here-dot';
      dot.innerHTML = svg(ICON.screen, 9);
      item.appendChild(dot);
    }
    box.appendChild(item);
  }
  $('homeItem').classList.toggle('active', !G.gid);
}

function renderGroupHead() {
  const g = groupOf(G.gid);
  $('groupName').textContent = g ? g.name : 'Início';
  $('groupHead').disabled = !g;
}

// ----- coluna dos canais (e a lista de membros da direita, que depende das mesmas coisas) -----
function renderChannels() {
  renderChannelList();
  renderMembers();
}
function renderChannelList() {
  const box = $('chanList');
  const keep = box.scrollTop;
  box.textContent = '';
  const g = groupOf(G.gid);
  if (!g) {
    renderDmList(box);   // Início: as conversas privadas
    box.scrollTop = keep;
    return;
  }
  if (G.chError) { box.appendChild(chanNote(G.chError)); return; }
  if (G.channels === null) { box.appendChild(chanNote('Carregando canais…')); return; }
  const owner = g.ownerUid === G.uid;
  const texts = G.channels.filter((c) => c.type === 'text');
  const streams = G.channels.filter((c) => c.type === 'stream');
  box.appendChild(chanSection('Canais de texto', owner ? 'Criar canal de texto' : '', () => newChannel('text')));
  for (const ch of texts) box.appendChild(chanEl(ch, owner));
  if (!texts.length) box.appendChild(chanNote('Nenhum canal ainda.'));
  box.appendChild(chanSection('Salas de transmissão', owner ? 'Criar sala de transmissão' : '', () => newChannel('stream')));
  for (const ch of streams) {
    box.appendChild(chanEl(ch, owner));
    const people = roomPeople(ch.id);
    if (people.length) box.appendChild(peopleList(people));
  }
  if (!streams.length) box.appendChild(chanNote('Nenhuma sala ainda.'));
  box.scrollTop = keep;
}
function chanNote(text) {
  const el = document.createElement('div');
  el.className = 'chan-note';
  el.textContent = text;
  return el;
}
function chanSection(title, addTitle = '', onAdd = null) {
  const el = document.createElement('div');
  el.className = 'chan-sec';
  const t = document.createElement('span');
  t.textContent = title;
  el.appendChild(t);
  if (addTitle) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini';
    b.title = addTitle;
    b.setAttribute('aria-label', addTitle);
    b.innerHTML = svg(ICON.plus, 16);
    b.onclick = onAdd;
    el.appendChild(b);
  }
  return el;
}
function chanEl(ch, owner) {
  const text = ch.type === 'text';
  const here = !text && !!S.group && S.group.cid === ch.id;
  const active = text ? G.view === 'chat' && G.cid === ch.id : G.view === 'room' && here;
  const el = document.createElement('div');
  el.className = 'chan' + (active ? ' active' : '') + (here ? ' here' : '');
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.innerHTML = `<span class="cico">${svg(text ? ICON.hash : ICON.screen, 18)}</span><span class="cname"></span>`;
  el.querySelector('.cname').textContent = ch.name;
  el.title = text ? `#${ch.name}` : here ? ch.name : `${ch.name} — clique para entrar`;
  if (owner) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'mini';
    more.title = 'Opções';
    more.setAttribute('aria-label', 'Opções do canal');
    more.innerHTML = svg(ICON.more, 16);
    more.onclick = (e) => {
      e.stopPropagation();
      const r = more.getBoundingClientRect();
      channelMenu(ch, r.left, r.bottom + 4, more);
    };
    el.appendChild(more);
    el.oncontextmenu = (e) => { e.preventDefault(); channelMenu(ch, e.clientX, e.clientY); };
  }
  const go = () => (text ? openChat(ch.id, true) : openStream(ch));
  el.onclick = go;
  el.onkeydown = (e) => {
    if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(); }
  };
  return el;
}

// Quem está na sala: a lista ao vivo (se eu estou nela) ou o último aviso de quem cuida dela.
function roomPeople(cid) {
  if (S.group && S.group.gid === G.gid && S.group.cid === cid && S.entered) {
    return [...S.view.values()].sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((p) => ({ uid: p.uid || '', name: p.name, live: p.sharing }));
  }
  const r = G.rooms[cid];
  if (!r || Date.now() - r.at > ROOM_FRESH) return [];
  return r.people.filter((p) => p && typeof p.name === 'string').slice(0, 30);
}
function peopleList(people) {
  const ul = document.createElement('ul');
  ul.className = 'chan-people';
  for (const p of people) {
    const li = document.createElement('li');
    const av = document.createElement('span');
    av.className = 'av';
    paintAv(av, p.uid, p.name);
    if (p.uid) li.onclick = (e) => { e.stopPropagation(); openUserCard(p.uid, cleanName(p.name), li, 'right'); };
    const nm = document.createElement('span');
    nm.className = 'pname ' + fxClass(p.uid);
    nm.textContent = cleanName(p.name);
    li.append(av, nm);
    if (p.live) {
      const b = document.createElement('span');
      b.className = 'pill live';
      b.textContent = 'AO VIVO';
      li.appendChild(b);
    }
    ul.appendChild(li);
  }
  return ul;
}

// ----- membros do grupo (direita, igual ao Discord) -----
let membersOn = store('sp-members') !== '0';
// Onde a pessoa está agora: { room, live } ou null.
function memberStatus(uid) {
  if (S.entered && S.group && S.group.gid === G.gid) {
    for (const p of S.view.values()) if (p.uid === uid) return { room: S.group.name, live: !!p.sharing };
  }
  for (const ch of (G.channels || []).filter((c) => c.type === 'stream')) {
    if (S.entered && S.group && S.group.cid === ch.id) continue;
    const r = G.rooms[ch.id];
    if (!r || Date.now() - r.at > ROOM_FRESH) continue;
    const p = r.people.find((x) => x && x.uid === uid);
    if (p) return { room: ch.name, live: !!p.live };
  }
  return null;
}
function renderMembers() {
  const g = groupOf(G.gid);
  const show = !!g && membersOn && G.view !== 'welcome';
  $('members').classList.toggle('hidden', !show);
  for (const b of document.querySelectorAll('.members-toggle')) {
    b.classList.toggle('hidden', !g);
    b.classList.toggle('on', membersOn);
    b.title = membersOn ? 'Esconder os membros do grupo' : 'Mostrar os membros do grupo';
  }
  if (!show) return;
  const box = $('memberList');
  const keep = box.scrollTop;
  box.textContent = '';
  const people = g.memberUids.map((uid) => {
    const st = memberStatus(uid);
    return {
      uid, st, owner: uid === g.ownerUid, online: isOnline(uid) || !!st,
      name: cleanName((g.members[uid] && g.members[uid].name) || 'Alguém'),
    };
  });
  const rank = (p) => (p.st ? (p.st.live ? 0 : 1) : 2);   // transmitindo, numa sala, o resto
  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
  const sections = PR.denied
    ? [['Membros', people.sort((a, b) => rank(a) - rank(b) || byName(a, b))]]
    : [
      ['Online', people.filter((p) => p.online).sort((a, b) => rank(a) - rank(b) || byName(a, b))],
      ['Offline', people.filter((p) => !p.online).sort(byName)],
    ];
  for (const [title, list] of sections) {
    if (!list.length) continue;
    const h = document.createElement('div');
    h.className = 'mem-sec';
    h.textContent = `${title} — ${list.length}`;
    box.appendChild(h);
    for (const p of list) box.appendChild(memberEl(p));
  }
  box.scrollTop = keep;
}
function memberEl(p) {
  const known = !PR.denied;   // sem as regras novas no Firebase não dá pra saber quem está online
  const el = document.createElement('div');
  el.className = 'mem' + (known && !p.online ? ' off' : '');
  const wrap = document.createElement('span');
  wrap.className = 'av-wrap';
  const av = document.createElement('span');
  av.className = 'av';
  paintAv(av, p.uid, p.name);
  wrap.appendChild(av);
  if (known) {
    const dot = document.createElement('span');
    dot.className = 'dot' + (p.online ? ' on' : '');
    dot.title = p.online ? 'Online' : 'Offline';
    wrap.appendChild(dot);
  }
  const text = document.createElement('div');
  text.className = 'mem-text';
  const line = document.createElement('div');
  line.className = 'mem-line';
  const nm = document.createElement('span');
  nm.className = 'mem-name' + (p.online || !known ? ' ' + fxClass(p.uid) : '');
  nm.textContent = p.name;
  line.appendChild(nm);
  if (p.owner) {
    const c = document.createElement('span');
    c.className = 'crown';
    c.title = 'Dono do grupo';
    c.innerHTML = svg(ICON.crown, 14);
    line.appendChild(c);
  }
  text.appendChild(line);
  if (p.st) {
    const st = document.createElement('div');
    st.className = 'mem-status' + (p.st.live ? ' live' : '');
    st.innerHTML = svg(ICON.screen, 12);
    const t = document.createElement('span');
    t.textContent = p.st.live ? `Transmitindo em ${p.st.room}` : `Em ${p.st.room}`;
    st.appendChild(t);
    text.appendChild(st);
  }
  el.append(wrap, text);
  if (p.uid === G.uid) el.title = 'Você';
  el.onclick = () => openUserCard(p.uid, p.name, el, 'left');
  return el;
}

// ----- sala de transmissão do grupo -----
function openStream(ch) {
  if (S.group && S.group.cid === ch.id) {
    if (S.entered) showView('room');
    return;
  }
  joinStream(G.gid, ch);
}
function renderRoomHead() {
  if (!S.group) return;
  const g = groupOf(S.group.gid);
  $('roomTitle').textContent = S.group.name;
  $('roomSub').textContent = g ? g.name : '';
}
// Painel "conectado" no pé da coluna dos canais (igual ao do Discord).
function renderVoice() {
  const on = !!S.group;
  $('voicePanel').classList.toggle('hidden', !on);
  renderRail();
  if (!on) return;
  const g = groupOf(S.group.gid);
  $('voiceWhere').textContent = g ? `${S.group.name} · ${g.name}` : S.group.name;
  $('voiceOpen').disabled = !S.entered;
  $('voiceShare').disabled = !S.entered || !canShare;
  $('voiceShare').textContent = S.localStream ? 'Parar' : 'Transmitir';
  $('voiceShare').classList.toggle('live', !!S.localStream);
}
// Quem cuida da sala avisa no Firebase quem está nela (pra quem olha de fora ver).
let roomPubTimer = null;
function publishRoom(now) {
  clearTimeout(roomPubTimer);
  roomPubTimer = setTimeout(() => {
    const room = S.room;
    if (!room || !S.group) return;
    const people = [...room.roster.values()].sort((a, b) => a.order - b.order)
      .map((p) => ({ uid: p.uid || '', name: p.name, live: !!p.sharing }));
    GAPI().setRoom(S.group.gid, S.group.cid, people).catch((err) => console.warn('[sala] lista', err && err.code));
  }, now ? 0 : 1500);
}
// A pessoa é mesmo do grupo? (a lista que já tenho; se não estiver nela, pergunta ao servidor)
async function memberOk(gid, uid) {
  const g = groupOf(gid);
  if (g && g.memberUids.includes(uid)) return true;
  return GAPI().isMember(gid, uid);
}

// ----- conversa (canal de texto do grupo ou mensagem privada) -----
// M.t = { gid, cid } (canal de texto) ou { did } (mensagem privada).
const chatKey = (t) => (!t ? '' : t.did ? `d:${t.did}` : `g:${t.gid}:${t.cid}`);
const CHAT = () => window.SPAuth.chat;
const FILE_MAX = 8 * 1024 * 1024;   // anexos de até 8 MB (ficam no banco gratuito do Firebase)

function openChat(cid, focus) {
  const ch = (G.channels || []).find((c) => c.id === cid && c.type === 'text');
  if (!ch) return false;
  G.cid = cid;
  saveNav();
  const t = { gid: G.gid, cid };
  if (M.key !== chatKey(t)) watchMessages(t);
  showView('chat');
  renderChatHead();
  if (focus) $('msgInput').focus();
  return true;
}
function renderChatHead() {
  const title = $('chatTitle');
  const icon = $('chatIcon');
  if (M.t && M.t.did) {
    const o = dmOther(D.list.get(M.t.did));
    icon.textContent = '';
    const av = document.createElement('span');
    av.className = 'av chat-head-av';
    paintAv(av, o.uid, o.name);
    icon.appendChild(av);
    title.textContent = o.name;
    title.className = fxClass(o.uid);
    $('msgInput').placeholder = `Conversar com @${o.name}`;
    return;
  }
  const ch = (G.channels || []).find((c) => c.id === G.cid);
  if (!ch) return;
  icon.innerHTML = svg(ICON.hash, 20);
  title.textContent = ch.name;
  title.className = '';
  $('msgInput').placeholder = `Conversar em #${ch.name}`;
}

function stopMessages() {
  if (M.unsub) { try { M.unsub(); } catch {} }
  Object.assign(M, { t: null, key: '', live: [], older: [], more: false, loaded: false, loading: false, error: '', unsub: null, atBottom: true });
  $('msgList').textContent = '';
  clearTray();
}
function watchMessages(t) {
  stopMessages();
  M.t = t;
  M.key = chatKey(t);
  const key = M.key;
  renderMessages();
  M.unsub = CHAT().watch(t, (list, more) => {
    if (M.key !== key) return;
    // Mensagens que saíram da janela ao vivo só por serem antigas continuam na tela.
    const oldest = list.length ? list[0].at : Infinity;
    const ids = new Set(list.map((m) => m.id));
    const slid = M.live.filter((m) => !ids.has(m.id) && !m.pending && m.at < oldest);
    if (slid.length) M.older = [...M.older, ...slid];
    M.live = list;
    if (!M.loaded) M.more = more;
    M.loaded = true;
    M.error = '';
    renderMessages();
  }, (err) => {
    if (M.key !== key) return;
    M.error = groupErr(err, 'Não consegui carregar as mensagens');
    M.loaded = true;
    renderMessages();
  });
}
function allMessages() {
  const seen = new Set();
  const out = [];
  for (const m of [...M.older, ...M.live]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.sort((a, b) => a.at - b.at);
}

function dayLabel(at) {
  const d = new Date(at).toDateString();
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d === today.toDateString()) return 'Hoje';
  if (d === yesterday.toDateString()) return 'Ontem';
  return new Date(at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}
const timeLabel = (at) => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function chatNote(text) {
  const el = document.createElement('div');
  el.className = 'chat-note';
  el.textContent = text;
  return el;
}
function chatIntro() {
  const el = document.createElement('div');
  el.className = 'chat-intro';
  if (M.t && M.t.did) {
    const o = dmOther(D.list.get(M.t.did));
    const av = document.createElement('span');
    av.className = 'av';
    paintAv(av, o.uid, o.name);
    const h = document.createElement('h3');
    const nm = document.createElement('span');
    nm.className = fxClass(o.uid);
    nm.textContent = o.name;
    h.appendChild(nm);
    const p = document.createElement('p');
    p.textContent = `Este é o começo da sua conversa privada com @${o.name}. Só vocês dois veem estas mensagens.`;
    el.append(av, h, p);
    return el;
  }
  const ch = (G.channels || []).find((c) => c.id === (M.t && M.t.cid));
  const name = ch ? ch.name : '';
  el.innerHTML = `<div class="big-ico">${svg(ICON.hash, 34)}</div><h3></h3><p></p>`;
  el.querySelector('h3').textContent = `Bem-vindo a #${name}!`;
  el.querySelector('p').textContent = `Este é o começo do canal #${name}.`;
  return el;
}

// mode 'older': acabou de carregar mensagens antigas em cima — mantém a posição de leitura.
function renderMessages(mode) {
  const box = $('msgList');
  const visible = box.clientHeight > 0;
  const oldHeight = box.scrollHeight;
  const oldTop = box.scrollTop;
  box.textContent = '';
  if (!M.t) return;
  if (!M.loaded) { box.appendChild(chatNote('Carregando mensagens…')); return; }
  if (M.error) { box.appendChild(chatNote(M.error)); return; }
  if (M.more) box.appendChild(chatNote(M.loading ? 'Carregando mensagens antigas…' : 'Role para cima para ver mensagens antigas'));
  else box.appendChild(chatIntro());
  const owner = !M.t.did && isOwner(M.t.gid);
  let prev = null;
  let day = '';
  for (const m of allMessages()) {
    const d = new Date(m.at).toDateString();
    if (d !== day) {
      const sep = document.createElement('div');
      sep.className = 'day-sep';
      sep.textContent = dayLabel(m.at);
      box.appendChild(sep);
      day = d;
      prev = null;
    }
    const first = !prev || prev.uid !== m.uid || m.at - prev.at > MSG_GAP;
    box.appendChild(messageEl(m, first, owner));
    prev = m;
  }
  if (!visible) return;
  if (mode === 'older') box.scrollTop = box.scrollHeight - oldHeight + oldTop;
  else box.scrollTop = M.atBottom ? box.scrollHeight : oldTop;
}

// Nome atual de quem mandou (o do grupo ou o da conversa privada; senão, o que veio na mensagem).
function authorName(m) {
  if (M.t && M.t.did) {
    const d = D.list.get(M.t.did);
    return cleanName((d && d.names[m.uid]) || m.name);
  }
  const g = M.t && groupOf(M.t.gid);
  return cleanName((g && g.members[m.uid] && g.members[m.uid].name) || m.name);
}

function messageEl(m, first, owner) {
  const el = document.createElement('div');
  el.className = 'cm' + (first ? ' first' : '') + (m.pending ? ' pending' : '');
  const name = authorName(m);
  const full = new Date(m.at).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
  if (first) {
    const av = document.createElement('span');
    av.className = 'av';
    paintAv(av, m.uid, name);
    const head = document.createElement('div');
    head.className = 'mhead';
    const b = document.createElement('b');
    b.className = fxClass(m.uid);
    b.textContent = name;
    const t = document.createElement('time');
    t.textContent = timeLabel(m.at);
    t.title = full;
    head.append(b, t);
    el.append(av, head);
    av.onclick = () => openUserCard(m.uid, name, av, 'right');
    b.onclick = () => openUserCard(m.uid, name, b, 'right');
  } else {
    const t = document.createElement('time');
    t.className = 'mside';
    t.textContent = timeLabel(m.at);
    t.title = full;
    el.appendChild(t);
  }
  if (m.text) {
    const txt = document.createElement('div');
    txt.className = 'mtext';
    richText(txt, m.text);
    el.appendChild(txt);
  }
  if (m.att) {
    const box = document.createElement('div');
    box.className = 'matt';
    box.appendChild(attEl(m));
    el.appendChild(box);
  }
  if (!m.pending && (m.uid === G.uid || owner)) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mdel';
    del.title = 'Apagar mensagem (Shift + clique apaga sem perguntar)';
    del.setAttribute('aria-label', 'Apagar mensagem');
    del.innerHTML = svg(ICON.trash, 15);
    del.onclick = (e) => deleteMessage(m, e.shiftKey);
    el.appendChild(del);
  }
  return el;
}

// Links viram clicáveis (abrem no navegador).
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
function richText(el, text) {
  let last = 0;
  for (const found of text.matchAll(URL_RE)) {
    let url = found[0];
    // Pontuação no fim não faz parte do link ("veja www.site.com." → sem o ponto), nem um ")" que fecha a frase.
    const count = (ch) => url.split(ch).length - 1;
    for (let prev = ''; prev !== url;) {
      prev = url;
      url = url.replace(/[.,!?;:'"]+$/, '');
      if (url.endsWith(')') && count(')') > count('(')) url = url.slice(0, -1);
    }
    if (found.index > last) el.append(text.slice(last, found.index));
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const a = document.createElement('a');
    a.className = 'mlink';
    a.href = href;
    a.title = href;
    a.textContent = url;
    a.onclick = (e) => { e.preventDefault(); openLink(href); };
    el.appendChild(a);
    last = found.index + url.length;
  }
  if (last < text.length) el.append(text.slice(last));
}
function openLink(url) {
  if (IS_APP && window.tav.openLink) window.tav.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

// ----- anexos -----
function attEl(m) {
  const a = m.att;
  if (a.kind === 'image') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mimg';
    b.title = `${a.name} · clique para abrir`;
    const img = document.createElement('img');
    img.alt = a.name;
    img.draggable = false;
    const scale = Math.min(1, 380 / (a.w || 380), 300 / (a.h || 300));
    img.width = Math.max(40, Math.round((a.w || 380) * scale));
    img.height = Math.max(40, Math.round((a.h || 300) * scale));
    img.src = a.thumb;
    b.appendChild(img);
    b.onclick = () => openViewer(m);
    return b;
  }
  const box = document.createElement('div');
  box.className = 'mfile';
  box.innerHTML = `${svg(ICON.file, 28)}<div class="mf-text"><b></b><small></small></div>`;
  box.querySelector('b').textContent = a.name;
  box.querySelector('b').title = a.name;
  box.querySelector('small').textContent = sizeLabel(a.size);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn sm';
  btn.innerHTML = `${svg(ICON.download, 15)}<span>Baixar</span>`;
  btn.onclick = () => saveAttachment(M.t, a, btn);
  box.appendChild(btn);
  return box;
}

// Os pedaços (base64) viram bytes.
function partsToBytes(parts) {
  const arrays = parts.map((p) => Uint8Array.from(atob(p), (c) => c.charCodeAt(0)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) { out.set(a, at); at += a.length; }
  return out;
}
async function saveBytes(name, bytes) {
  if (IS_APP && window.tav.saveFile) {
    const where = await window.tav.saveFile(name, bytes);
    if (where) toast(`Salvo em ${where} — clique para mostrar na pasta.`, '', 6000, () => window.tav.showFile(where));
    return;
  }
  const a = document.createElement('a');   // navegador: download normal
  a.href = URL.createObjectURL(new Blob([bytes]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function saveAttachment(t, a, btn) {
  const label = btn && btn.innerHTML;
  if (btn) btn.disabled = true;
  try {
    const parts = await CHAT().download(t, a, (p) => { if (btn) btn.textContent = `${Math.round(p * 100)}%`; });
    await saveBytes(a.name, partsToBytes(parts));
  } catch (err) {
    toast(groupErr(err, 'Não consegui baixar o arquivo'), 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = label; }
  }
}

// Imagem aberta grande (a miniatura aparece na hora; a imagem inteira chega em seguida).
const fullCache = new Map();   // fid -> data URL (as últimas abertas)
let viewing = null;
async function openViewer(m) {
  const a = m.att;
  const t = M.t;
  viewing = { m, t };
  $('viewerImg').src = fullCache.get(a.fid) || a.thumb;
  $('viewerName').textContent = a.name;
  $('viewerNote').textContent = `${a.w}×${a.h} · ${sizeLabel(a.size)}`;
  $('viewer').classList.remove('hidden');
  if (fullCache.has(a.fid)) return;
  try {
    const parts = await CHAT().download(t, a, (p) => {
      if (viewing && viewing.m === m && p < 1) $('viewerNote').textContent = `Carregando ${Math.round(p * 100)}%…`;
    });
    const url = `data:${a.mime || 'image/webp'};base64,${parts.join('')}`;
    fullCache.set(a.fid, url);
    while (fullCache.size > 12) fullCache.delete(fullCache.keys().next().value);
    if (viewing && viewing.m === m) {
      $('viewerImg').src = url;
      $('viewerNote').textContent = `${a.w}×${a.h} · ${sizeLabel(a.size)}`;
    }
  } catch (err) {
    if (viewing && viewing.m === m) $('viewerNote').textContent = 'Não consegui carregar a imagem inteira.';
  }
}
function closeViewer() {
  viewing = null;
  $('viewer').classList.add('hidden');
  $('viewerImg').removeAttribute('src');
}

// Anexos esperando para ir junto com a próxima mensagem.
let tray = [];   // { file, kind: 'image' | 'file', preview, state: 'ready' | 'sending' | 'error', progress }
let sendingChat = false;
function clearTray() {
  tray = [];
  renderTray();
}
async function addFiles(list) {
  if (!M.t) return;
  for (const file of [...list]) {
    if (tray.length >= 10) { toast('Dá para mandar até 10 anexos de uma vez.', 'warn'); break; }
    const image = /^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type);
    if (!file.size) { toast(`“${file.name}” está vazio.`, 'warn'); continue; }
    if (!image && file.size > FILE_MAX) { toast(`“${file.name}” tem ${sizeLabel(file.size)} — o máximo é 8 MB.`, 'err', 6000); continue; }
    if (image && file.size > 40 * 1024 * 1024) { toast(`A imagem “${file.name}” é grande demais.`, 'err'); continue; }
    const item = { file, kind: image ? 'image' : 'file', preview: '', state: 'ready', progress: 0 };
    tray.push(item);
    if (image) {
      makeThumb(file, 160, 0.7).then((url) => { item.preview = url; renderTray(); }).catch(() => {});
    }
  }
  renderTray();
  $('msgInput').focus();
}
function renderTray() {
  const box = $('attTray');
  box.textContent = '';
  box.classList.toggle('hidden', !tray.length);
  for (const item of tray) {
    const chip = document.createElement('div');
    chip.className = 'att-chip' + (item.state === 'error' ? ' error' : '');
    const th = document.createElement('div');
    th.className = 'att-thumb';
    if (item.preview) {
      const img = document.createElement('img');
      img.src = item.preview;
      img.alt = '';
      th.appendChild(img);
    } else {
      th.innerHTML = svg(ICON.file, 30);
    }
    const nm = document.createElement('div');
    nm.className = 'att-name';
    nm.textContent = item.file.name || 'imagem';
    nm.title = nm.textContent;
    const sz = document.createElement('div');
    sz.className = 'att-size';
    sz.textContent = item.state === 'sending' ? `Enviando ${Math.round(item.progress * 100)}%…`
      : item.state === 'error' ? 'Não foi — tente de novo' : sizeLabel(item.file.size);
    chip.append(th, nm, sz);
    if (item.state === 'sending') {
      const bar = document.createElement('div');
      bar.className = 'att-bar';
      bar.innerHTML = '<i></i>';
      bar.firstChild.style.width = `${Math.round(item.progress * 100)}%`;
      chip.appendChild(bar);
    } else {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'att-del';
      del.title = 'Tirar';
      del.innerHTML = svg(ICON.close, 13);
      del.onclick = () => { tray = tray.filter((x) => x !== item); renderTray(); };
      chip.appendChild(del);
    }
    box.appendChild(chip);
  }
}
function pickFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.addEventListener('change', () => { if (input.files && input.files.length) addFiles(input.files); });
  input.click();
}

// Desenha a imagem reduzida (lado maior = max) e devolve como data URL.
async function makeThumb(file, max, quality) {
  const bmp = await createImageBitmap(file);
  try {
    return drawSmall(bmp, max, 'image/webp', quality).toDataURL('image/webp', quality);
  } finally {
    bmp.close();
  }
}
function drawSmall(bmp, max) {
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas;
}
const canvasBlob = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));
function readDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
// Arquivo → pedaços em base64 (cada um com o tamanho que o Firebase aceita).
async function fileParts(blob) {
  const size = CHAT().chunkBytes;
  const parts = [];
  for (let at = 0; at < blob.size; at += size) {
    parts.push((await readDataUrl(blob.slice(at, at + size))).split(',')[1] || '');
  }
  return parts;
}

// Prepara e manda um anexo (a legenda vai junto na mesma mensagem).
async function sendAttachment(t, item, caption) {
  const file = item.file;
  const onProgress = (p) => { item.progress = p; renderTray(); };
  let att;
  if (item.kind === 'image') {
    const bmp = await createImageBitmap(file);
    const w = bmp.width;
    const h = bmp.height;
    let thumb;
    let full;
    let mime;
    try {
      // Miniatura que aparece no chat (GIF pequeno continua animado).
      thumb = file.type === 'image/gif' && file.size <= 56000 ? await readDataUrl(file) : '';
      for (const [max, q] of [[480, 0.75], [400, 0.6], [320, 0.5]]) {
        if (thumb) break;
        const url = drawSmall(bmp, max).toDataURL('image/webp', q);
        if (url.length <= 78000) thumb = url;
      }
      // Imagem inteira: GIF até 4 MB fica como está (anima); o resto vira WEBP de até 2048 px.
      if (file.type === 'image/gif' && file.size <= 4 * 1024 * 1024) {
        full = file;
        mime = 'image/gif';
      } else {
        full = await canvasBlob(drawSmall(bmp, 2048), 'image/webp', 0.9);
        mime = 'image/webp';
      }
    } finally {
      bmp.close();
    }
    if (!thumb || !full) throw Object.assign(new Error('imagem'), { userMsg: `Não consegui preparar a imagem “${file.name}”.` });
    if (full.size > FILE_MAX) throw Object.assign(new Error('grande'), { userMsg: `A imagem “${file.name}” ficou grande demais.` });
    const base = (file.name || 'imagem').replace(/\.[^.]+$/, '') || 'imagem';
    const name = (mime === 'image/gif' ? `${base}.gif` : `${base}.webp`).slice(0, 120);
    const up = await CHAT().upload(t, await fileParts(full), onProgress);
    att = { kind: 'image', name, size: full.size, mime, w, h, thumb, ...up };
  } else {
    const up = await CHAT().upload(t, await fileParts(file), onProgress);
    att = {
      kind: 'file', name: (file.name || 'arquivo').slice(0, 120), size: file.size,
      mime: (file.type || '').slice(0, 100), ...up,
    };
  }
  await CHAT().send(t, caption, att);
}

async function loadOlder() {
  if (!M.more || M.loading || !M.loaded || M.error) return;
  const all = allMessages().filter((m) => !m.pending);
  if (!all.length) return;
  const { key, t } = M;
  M.loading = true;
  renderMessages('older');
  try {
    const r = await CHAT().older(t, all[0]);
    if (M.key !== key) return;
    M.older = [...r.list, ...M.older];
    M.more = r.more;
  } catch (err) {
    console.warn('[mensagens] antigas', err && err.code);
    if (M.key === key) M.more = false;
  } finally {
    if (M.key === key) {
      M.loading = false;
      renderMessages('older');
    }
  }
}

function sizeComposer() {
  const ta = $('msgInput');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
}
async function sendChat() {
  const ta = $('msgInput');
  const text = ta.value;
  const t = M.t;
  if (!t || sendingChat || (!text.trim() && !tray.length)) return;
  ta.value = '';
  sizeComposer();
  M.atBottom = true;
  if (!tray.length) {
    CHAT().send(t, text).catch((err) => {
      toast(groupErr(err, 'Não consegui mandar a mensagem'), 'err');
      if (!ta.value && M.t === t) { ta.value = text; sizeComposer(); }
    });
    return;
  }
  // Com anexos: um por mensagem; a legenda vai com o primeiro.
  sendingChat = true;
  let caption = text;
  for (const item of tray.slice()) {
    if (M.t !== t) break;
    item.state = 'sending';
    item.progress = 0;
    renderTray();
    try {
      await sendAttachment(t, item, caption);
      caption = '';
      tray = tray.filter((x) => x !== item);
    } catch (err) {
      console.warn('[anexo]', err);
      item.state = 'error';
      toast(err.userMsg || groupErr(err, `Não consegui mandar “${item.file.name}”`), 'err', 6000);
    }
    renderTray();
  }
  sendingChat = false;
  if (caption && M.t === t && !ta.value) { ta.value = caption; sizeComposer(); }
}
async function deleteMessage(m, now) {
  const t = M.t;
  if (!now) {
    const ok = await ask({
      title: 'Apagar mensagem?',
      text: t && t.did ? 'Ela some para vocês dois.' : 'Ela some para todo mundo do grupo.',
      ok: 'Apagar',
      danger: true,
    });
    if (!ok) return;
  }
  try {
    await CHAT().remove(t, m);
    if (M.t === t) {
      M.older = M.older.filter((x) => x.id !== m.id);
      renderMessages();
    }
  } catch (err) {
    toast(groupErr(err, 'Não consegui apagar a mensagem'), 'err');
  }
}

// ----- mensagens privadas -----
const D = { list: new Map(), unsub: null, ready: false, marking: new Set() };
const DMS = () => window.SPAuth.dms;
// A outra pessoa da conversa: { uid, name }.
function dmOther(d) {
  const uid = d ? d.uids.find((u) => u !== G.uid) || '' : '';
  return { uid, name: cleanName((d && d.names[uid]) || 'Alguém') };
}
const dmUnread = (d) => !!(d.last && d.last.uid !== G.uid && d.last.at > (d.read[G.uid] || 0));

function startDms() {
  stopDms();
  D.unsub = DMS().watch(onDms, (err) => console.warn('[privadas]', err && err.code));
}
function stopDms() {
  if (D.unsub) { try { D.unsub(); } catch {} }
  Object.assign(D, { list: new Map(), unsub: null, ready: false, marking: new Set() });
  renderUnread();
}
function onDms(list) {
  const first = !D.ready;
  const prev = D.list;
  D.list = new Map(list.map((d) => [d.id, d]));
  D.ready = true;
  // Mensagem nova de alguém: som + aviso (se não estou olhando essa conversa agora).
  for (const d of list) {
    if (first || !dmUnread(d)) continue;
    const old = prev.get(d.id);
    if (old && old.last && old.last.at >= d.last.at) continue;
    if (M.t && M.t.did === d.id && G.view === 'chat' && document.hasFocus()) continue;
    sfx('message');
    toast(`💬 ${dmOther(d).name}: ${d.last.text}`, '', 6000, () => openDm(d.id, true));
  }
  if (G.wantDm && D.list.has(G.wantDm)) {
    const did = G.wantDm;
    G.wantDm = '';
    openDm(did, true);
  }
  if (M.t && M.t.did && G.view === 'chat' && document.hasFocus()) markDmRead(M.t.did);
  renderUnread();
  if (!G.gid) renderChannelList();
  if (M.t && M.t.did) renderChatHead();
}
function markDmRead(did) {
  const d = D.list.get(did);
  if (!d || !dmUnread(d) || D.marking.has(did)) return;
  D.marking.add(did);
  DMS().markRead(did).catch(() => {}).finally(() => D.marking.delete(did));
}
// Bolinha vermelha no ícone do Início com quantas conversas têm mensagem nova.
function renderUnread() {
  const n = [...D.list.values()].filter(dmUnread).length;
  $('homeBadge').textContent = n > 9 ? '9+' : String(n);
  $('homeBadge').classList.toggle('hidden', !n);
  document.title = n ? `(${n}) ScreenPLAY` : 'ScreenPLAY';
}
function openDm(did, focus) {
  if (!D.list.has(did)) return false;
  if (G.gid) closeGroup();
  G.dm = did;
  saveNav();
  const t = { did };
  if (M.key !== chatKey(t)) watchMessages(t);
  renderRail();
  renderGroupHead();
  showView('chat');
  renderChatHead();
  if (focus) $('msgInput').focus();
  markDmRead(did);
  return true;
}
// Lista de conversas privadas (coluna da esquerda, no Início).
function renderDmList(box) {
  box.appendChild(chanSection('Mensagens privadas', '', null));
  const list = [...D.list.values()]
    .filter((d) => d.last || d.id === G.dm)
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  if (!list.length) {
    box.appendChild(chanNote('Para mandar uma mensagem privada, clique em alguém na lista de membros de um grupo.'));
    return;
  }
  for (const d of list) {
    const o = dmOther(d);
    const el = document.createElement('div');
    const active = G.view === 'chat' && M.t && M.t.did === d.id;
    el.className = 'chan dm' + (active ? ' active' : '') + (dmUnread(d) ? ' unread' : '');
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    const wrap = document.createElement('span');
    wrap.className = 'av-wrap';
    const av = document.createElement('span');
    av.className = 'av';
    paintAv(av, o.uid, o.name);
    const dot = document.createElement('span');
    dot.className = 'dot' + (isOnline(o.uid) ? ' on' : '');
    wrap.append(av, dot);
    const text = document.createElement('span');
    text.className = 'dm-text';
    const nm = document.createElement('span');
    nm.className = 'dm-name ' + fxClass(o.uid);
    nm.textContent = o.name;
    const last = document.createElement('span');
    last.className = 'dm-last';
    last.textContent = d.last ? (d.last.uid === G.uid ? `Você: ${d.last.text}` : d.last.text) : '';
    text.append(nm, last);
    el.append(wrap, text);
    if (dmUnread(d)) {
      const u = document.createElement('span');
      u.className = 'unread-dot';
      el.appendChild(u);
    }
    el.onclick = () => openDm(d.id, true);
    el.onkeydown = (e) => { if (e.key === 'Enter') openDm(d.id, true); };
    box.appendChild(el);
  }
}

// ----- cartão de perfil (clicar em alguém da lista de membros ou do chat) -----
function openUserCard(uid, name, anchor, side) {
  if (!uid) return;
  const card = $('ucard');
  const me = uid === G.uid;
  const g = groupOf(G.gid);
  paintAv($('ucAv'), uid, name);
  $('ucName').textContent = name;
  $('ucName').className = fxClass(uid);
  $('ucCrown').classList.toggle('hidden', !(g && g.ownerUid === uid));
  const st = g ? memberStatus(uid) : null;
  const online = isOnline(uid) || !!st;
  $('ucDot').className = 'dot' + (online ? ' on' : '');
  $('ucStatus').textContent = st ? (st.live ? `Transmitindo em ${st.room}` : `Em ${st.room}`) : online ? 'Online' : 'Offline';
  $('ucForm').classList.toggle('hidden', me);
  $('ucEdit').classList.toggle('hidden', !me);
  $('ucMsg').value = '';
  $('ucMsg').disabled = false;
  $('ucMsg').placeholder = `Mensagem para @${name}`;
  card.dataset.uid = uid;
  card.dataset.name = name;
  card.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  let x = side === 'left' ? r.left - w - 12 : r.right + 12;
  if (x + w > innerWidth - 8) x = r.left - w - 12;
  if (x < 8) x = Math.min(innerWidth - w - 8, r.right + 12);
  card.style.left = `${Math.max(8, x)}px`;
  card.style.top = `${Math.max(8, Math.min(r.top - 20, innerHeight - h - 8))}px`;
  if (!me) setTimeout(() => $('ucMsg').focus(), 0);
}
function closeUserCard() {
  $('ucard').classList.add('hidden');
}
const cardOpen = () => !$('ucard').classList.contains('hidden');
async function sendFromCard(e) {
  e.preventDefault();
  const card = $('ucard');
  const uid = card.dataset.uid;
  const text = $('ucMsg').value.trim();
  if (!uid || !text || $('ucMsg').disabled) return;
  // Grupo em comum: o aberto agora (ou qualquer um que tenha nós dois).
  const via = (groupOf(G.gid) && G.gid)
    || ([...G.list.values()].find((g) => g.memberUids.includes(uid)) || {}).id || '';
  $('ucMsg').disabled = true;
  try {
    const did = await DMS().ensure(uid, via);
    await CHAT().send({ did }, text);
    closeUserCard();
    if (!openDm(did, true)) G.wantDm = did;   // a conversa nova ainda não chegou na lista
  } catch (err) {
    console.warn('[privadas]', err);
    toast(groupErr(err, 'Não consegui mandar a mensagem'), 'err');
    $('ucMsg').disabled = false;
  }
}

// ----- criar / entrar / convidar / sair -----
function createGroupDlg() {
  const me = window.SPAuth.profile();
  ask({
    title: 'Criar um grupo',
    text: 'É o cantinho seu e dos seus amigos. Já vem com um canal de texto e uma sala de transmissão — depois é só mandar o convite.',
    input: { label: 'Nome do grupo', value: me && me.nick ? `Grupo de ${me.nick}` : '', max: 40 },
    ok: 'Criar grupo',
    busy: 'Criando…',
    run: (v) => GAPI().createGroup(v.text),
  }).then((gid) => {
    if (!gid) return;
    G.wantGid = gid;
    if (G.list.has(gid)) { G.wantGid = ''; openGroup(gid); }
    toast('Grupo criado! Pra chamar os amigos, clique no nome do grupo → “Convidar pessoas”.', '', 6000);
  });
}

function joinGroupDlg() {
  ask({
    title: 'Entrar num grupo',
    text: 'Cole o código de convite que seu amigo mandou.',
    input: { label: 'Código de convite', placeholder: 'Ex.: K7P2QX9M', max: 12, code: true },
    ok: 'Entrar',
    busy: 'Entrando…',
    run: async (v) => {
      try {
        return await GAPI().joinGroup(v.text);
      } catch (err) {
        if (err.code === 'permission-denied') err.userMsg = 'Esse convite não vale mais. Peça um novo para quem te convidou.';
        throw err;
      }
    },
  }).then((r) => {
    if (!r) return;
    G.wantGid = r.gid;
    if (G.list.has(r.gid)) { G.wantGid = ''; openGroup(r.gid); }
    toast(r.already ? `Você já está no grupo “${r.name}”.` : `Você entrou no grupo “${r.name}”!`);
    if (!r.already) sfx('join');
  });
}

function showInvite(gid, code) {
  const g = groupOf(gid);
  if (!g) return;
  const invite = code || g.invite;
  const box = document.createElement('div');
  box.className = 'invite-box';
  const shown = document.createElement('div');
  shown.className = 'invite-code';
  shown.textContent = invite;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = 'Copiar';
  btn.onclick = () => copy(invite, 'Convite copiado! Mande pros seus amigos.');
  box.append(shown, btn);
  ask({
    title: `Convidar amigos para ${g.name}`,
    text: 'Mande este código. No ScreenPLAY, a pessoa clica em “Entrar com convite” (na barra da esquerda) e cola o código.',
    body: box,
    ok: 'Pronto',
    cancel: false,
  });
}

// Nome e foto do grupo — só quem criou o grupo vê esta opção (e o Firebase só deixa o dono salvar).
function groupSettingsDlg(gid) {
  const g = groupOf(gid);
  if (!g || g.ownerUid !== G.uid) return;
  let photo = g.photo || '';
  const top = document.createElement('div');
  top.className = 'gs-photo';
  const pic = document.createElement('button');
  pic.type = 'button';
  pic.className = 'gs-pic';
  pic.title = 'Trocar foto do grupo';
  const side = document.createElement('div');
  side.className = 'gs-side';
  const acts = document.createElement('div');
  acts.className = 'row-actions';
  const change = document.createElement('button');
  change.type = 'button';
  change.className = 'btn sm';
  change.textContent = 'Trocar foto';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn sm danger';
  remove.textContent = 'Remover';
  const note = document.createElement('small');
  note.textContent = 'A foto aparece na barra da esquerda para todo mundo do grupo.';
  acts.append(change, remove);
  side.append(acts, note);
  top.append(pic, side);
  const paint = () => {
    pic.style.backgroundImage = '';
    pic.textContent = '';
    if (photo) paintPhoto(pic, photo);
    else pic.textContent = groupInitials(($('dlgInput') && $('dlgInput').value) || g.name);
    remove.disabled = !photo;
  };
  const choose = async () => {
    const url = await pickImage();
    if (url) { photo = url; paint(); }
  };
  pic.onclick = choose;
  change.onclick = choose;
  remove.onclick = () => { photo = ''; paint(); };
  paint();
  ask({
    title: 'Configurações do grupo',
    top,
    input: { label: 'Nome do grupo', value: g.name, max: 40 },
    ok: 'Salvar',
    busy: 'Salvando…',
    run: async (v) => {
      const patch = {};
      if (v.text.trim() !== g.name) patch.name = v.text;
      if (photo !== (g.photo || '')) patch.photo = photo;
      if (Object.keys(patch).length) await GAPI().updateGroup(gid, patch);
      return Object.keys(patch).length > 0;
    },
  }).then((changed) => { if (changed) toast('Grupo atualizado!'); });
  $('dlgInput').addEventListener('input', paint);
}

async function resetInviteDlg(gid) {
  const code = await ask({
    title: 'Trocar o código de convite?',
    text: 'O código atual para de funcionar. Quem já está no grupo continua nele.',
    ok: 'Trocar código',
    run: () => GAPI().newInvite(gid),
  });
  if (code) showInvite(gid, code);
}

function deleteGroupDlg(gid) {
  const g = groupOf(gid);
  if (!g) return;
  ask({
    title: `Apagar “${g.name}”?`,
    text: 'O grupo, todos os canais e todas as mensagens somem para todo mundo. Não dá para desfazer.',
    ok: 'Apagar grupo',
    danger: true,
    busy: 'Apagando tudo…',
    run: async () => {
      if (S.group && S.group.gid === gid) leaveRoom();
      G.goneOk.add(gid);
      if (G.gid === gid) openHome();
      try {
        await GAPI().deleteGroup(gid);
      } catch (err) {
        G.goneOk.delete(gid);
        throw err;
      }
      return true;
    },
  }).then((done) => { if (done) toast(`O grupo “${g.name}” foi apagado.`); });
}

function leaveGroupDlg(gid) {
  const g = groupOf(gid);
  if (!g) return;
  ask({
    title: `Sair de “${g.name}”?`,
    text: 'Você pode voltar depois com um convite.',
    ok: 'Sair do grupo',
    danger: true,
    run: async () => {
      if (S.group && S.group.gid === gid) leaveRoom();
      G.goneOk.add(gid);
      if (G.gid === gid) openHome();
      try {
        await GAPI().leaveGroup(gid);
      } catch (err) {
        G.goneOk.delete(gid);
        throw err;
      }
      return true;
    },
  }).then((done) => { if (done) toast(`Você saiu do grupo “${g.name}”.`); });
}

function groupMenu(gid, x, y, anchor) {
  const g = groupOf(gid);
  if (!g) return;
  const items = [{ label: 'Convidar pessoas', icon: ICON.invite, run: () => showInvite(gid) }];
  if (g.ownerUid === G.uid) {
    items.push(
      '-',
      { label: 'Criar canal de texto', icon: ICON.hash, run: () => newChannel('text', gid) },
      { label: 'Criar sala de transmissão', icon: ICON.screen, run: () => newChannel('stream', gid) },
      '-',
      { label: 'Configurações do grupo', icon: ICON.cog, run: () => groupSettingsDlg(gid) },
      { label: 'Trocar código de convite', icon: ICON.reload, run: () => resetInviteDlg(gid) },
      '-',
      { label: 'Apagar grupo', icon: ICON.trash, danger: true, run: () => deleteGroupDlg(gid) },
    );
  } else {
    items.push('-', { label: 'Sair do grupo', icon: ICON.door, danger: true, run: () => leaveGroupDlg(gid) });
  }
  openMenu(items, x, y, anchor);
}

// ----- canais (só o dono do grupo) -----
function newChannel(type, gid = G.gid) {
  const text = type === 'text';
  ask({
    title: text ? 'Criar canal de texto' : 'Criar sala de transmissão',
    text: text
      ? 'Um canal para conversar por mensagens.'
      : 'Uma sala fixa do grupo: quem quiser entra, e cada um transmite a tela quando quiser.',
    input: { label: text ? 'Nome do canal' : 'Nome da sala', placeholder: text ? 'Ex.: jogos, memes, avisos' : 'Ex.: Sala 2, Jogatina', max: 30 },
    ok: 'Criar',
    run: (v) => GAPI().createChannel(gid, v.text, type),
  }).then((cid) => {
    if (cid && text && G.gid === gid && !openChat(cid, true)) G.wantCid = cid;   // ainda não chegou na lista
  });
}
function channelMenu(ch, x, y, anchor) {
  const text = ch.type === 'text';
  openMenu([
    { label: text ? 'Renomear canal' : 'Renomear sala', icon: ICON.pencil, run: () => renameChannelDlg(ch) },
    { label: text ? 'Apagar canal' : 'Apagar sala', icon: ICON.trash, danger: true, run: () => deleteChannelDlg(ch) },
  ], x, y, anchor);
}
function renameChannelDlg(ch) {
  const gid = G.gid;
  ask({
    title: ch.type === 'text' ? 'Renomear canal' : 'Renomear sala',
    input: { label: 'Nome', value: ch.name, max: 30 },
    ok: 'Salvar',
    run: (v) => GAPI().renameChannel(gid, ch.id, v.text),
  });
}
function deleteChannelDlg(ch) {
  const gid = G.gid;
  const text = ch.type === 'text';
  ask({
    title: text ? `Apagar #${ch.name}?` : `Apagar a sala “${ch.name}”?`,
    text: text
      ? 'O canal e todas as mensagens dele somem para todo mundo. Não dá para desfazer.'
      : 'A sala some para todo mundo do grupo.',
    ok: 'Apagar',
    danger: true,
    busy: 'Apagando…',
    run: async () => {
      if (S.group && S.group.cid === ch.id) leaveRoom();
      await GAPI().deleteChannel(gid, ch.id);
      return true;
    },
  });
}

// ----- menu (clique no nome do grupo, nos "…" ou com o botão direito) -----
let menuAnchor = null;
const menuOpen = () => !$('menu').classList.contains('hidden');
function openMenu(items, x, y, anchor) {
  closeMenu();
  const m = $('menu');
  m.textContent = '';
  for (const it of items) {
    if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    if (it.danger) b.className = 'danger';
    b.innerHTML = svg(it.icon, 16);
    const t = document.createElement('span');
    t.textContent = it.label;
    b.appendChild(t);
    b.onclick = () => { closeMenu(); it.run(); };
    m.appendChild(b);
  }
  menuAnchor = anchor || null;
  if (menuAnchor) menuAnchor.classList.add('open');
  m.classList.remove('hidden');
  m.style.left = Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8)) + 'px';
}
function closeMenu() {
  $('menu').classList.add('hidden');
  if (menuAnchor) menuAnchor.classList.remove('open');
  menuAnchor = null;
}

// ----- caixinha de pergunta -----
// ask({ title, text, top, input: {label, value, placeholder, max, code}, body, ok, danger, cancel, busy, run })
// Resolve com o que run() devolver (ou os valores digitados), ou null se cancelar.
let dlg = null;
function ask(opts) {
  closeMenu();
  if (dlg) closeDlg(null);
  return new Promise((resolve) => {
    dlg = { resolve, run: opts.run, busy: false, busyText: opts.busy || '' };
    $('dlgTitle').textContent = opts.title;
    $('dlgText').textContent = opts.text || '';
    $('dlgText').classList.toggle('hidden', !opts.text);
    const body = $('dlgBody');
    body.textContent = '';
    if (opts.top) body.appendChild(opts.top);
    let input = null;
    if (opts.input) {
      const label = document.createElement('label');
      label.className = 'field';
      const span = document.createElement('span');
      span.textContent = opts.input.label;
      input = document.createElement('input');
      input.type = 'text';
      input.id = 'dlgInput';
      input.maxLength = opts.input.max || 40;
      input.value = opts.input.value || '';
      input.placeholder = opts.input.placeholder || '';
      input.autocomplete = 'off';
      input.spellcheck = false;
      if (opts.input.code) {
        input.classList.add('code-input');
        input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); });
      }
      label.append(span, input);
      body.appendChild(label);
    }
    if (opts.body) body.appendChild(opts.body);
    $('dlgOk').textContent = opts.ok || 'OK';
    $('dlgOk').className = 'btn ' + (opts.danger ? 'live' : 'primary');
    $('dlgOk').disabled = false;
    $('dlgCancel').classList.toggle('hidden', opts.cancel === false);
    dlgMsg('');
    $('dlg').classList.remove('hidden');
    setTimeout(() => {
      if (input) { input.focus(); input.select(); } else $('dlgOk').focus();
    }, 0);
  });
}
function dlgMsg(text, kind = 'err') {
  const el = $('dlgMsg');
  el.textContent = text || '';
  el.className = 'msg' + (text && kind ? ' ' + kind : '');
  el.classList.toggle('hidden', !text);
}
function closeDlg(value) {
  if (!dlg) return;
  const d = dlg;
  dlg = null;
  $('dlg').classList.add('hidden');
  d.resolve(value);
}

$('dlgForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = dlg;
  if (!d || d.busy) return;
  const values = { text: $('dlgInput') ? $('dlgInput').value : '' };
  if (!d.run) { closeDlg(values); return; }
  d.busy = true;
  $('dlgOk').disabled = true;
  dlgMsg(d.busyText, '');
  try {
    const result = await d.run(values);
    if (dlg === d) closeDlg(result === undefined ? values : result);
  } catch (err) {
    if (!err.userMsg && !GROUP_ERRORS[err.code]) console.warn('[grupos]', err);
    if (dlg === d) dlgMsg(err.userMsg || groupErr(err));
  } finally {
    d.busy = false;
    if (dlg === d) $('dlgOk').disabled = false;
  }
});
$('dlgCancel').onclick = () => { if (dlg && !dlg.busy) closeDlg(null); };
$('dlg').addEventListener('mousedown', (e) => { if (e.target === $('dlg') && dlg && !dlg.busy) closeDlg(null); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('viewer').classList.contains('hidden')) closeViewer();
  else if (cardOpen()) closeUserCard();
  else if (menuOpen()) closeMenu();
  else if (dlg && !dlg.busy) closeDlg(null);
});
document.addEventListener('mousedown', (e) => {
  if (menuOpen() && !$('menu').contains(e.target) && !(menuAnchor && menuAnchor.contains(e.target))) closeMenu();
}, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

// ----- dica com o nome do grupo (passar o mouse na barra da esquerda) -----
function showTip(el) {
  const t = $('tip');
  t.textContent = el.dataset.tip;
  t.classList.remove('hidden');
  const r = el.getBoundingClientRect();
  t.style.left = r.right + 14 + 'px';
  t.style.top = r.top + r.height / 2 - t.offsetHeight / 2 + 'px';
}
const hideTip = () => $('tip').classList.add('hidden');
$('rail').addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el) showTip(el);
});
$('rail').addEventListener('mouseout', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el && !el.contains(e.relatedTarget)) hideTip();
});
$('rail').addEventListener('mouseleave', hideTip);
$('rail').addEventListener('scroll', hideTip);

// ----- eventos -----
$('homeBtn').onclick = () => { hideTip(); openHome(); };
$('addGroupBtn').onclick = () => { hideTip(); createGroupDlg(); };
$('joinGroupBtn').onclick = () => { hideTip(); joinGroupDlg(); };
$('welcomeCreate').onclick = createGroupDlg;
$('welcomeJoin').onclick = joinGroupDlg;
$('groupHead').onclick = () => {
  if (menuOpen() && menuAnchor === $('groupHead')) { closeMenu(); return; }
  const r = $('groupHead').getBoundingClientRect();
  groupMenu(G.gid, r.left + 8, r.bottom + 6, $('groupHead'));
};
$('voiceLeave').onclick = () => leaveRoom();
$('voiceOpen').onclick = () => {
  if (!S.entered) return;
  if (G.gid !== S.group.gid) openGroup(S.group.gid);   // a sala é de outro grupo: abre ele
  showView('room');
};
for (const b of document.querySelectorAll('.members-toggle')) {
  b.onclick = () => {
    membersOn = !membersOn;
    store('sp-members', membersOn ? '1' : '0');
    renderMembers();
  };
}
$('voiceShare').onclick = () => {
  if (S.localStream) stopShare();
  else if (S.entered) startShare();
};
$('msgInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
});
$('msgInput').addEventListener('input', sizeComposer);
// Anexos: botão +, colar (Ctrl+V) e arrastar pra dentro do chat.
$('attachBtn').onclick = pickFiles;
$('msgInput').addEventListener('paste', (e) => {
  const files = e.clipboardData ? [...e.clipboardData.files] : [];
  if (!files.length) return;
  e.preventDefault();
  addFiles(files);
});
let dragDepth = 0;
const dragHasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
$('chatView').addEventListener('dragenter', (e) => {
  if (!dragHasFiles(e) || !M.t) return;
  dragDepth++;
  $('dropHint').classList.remove('hidden');
});
$('chatView').addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('dropHint').classList.add('hidden');
});
$('chatView').addEventListener('drop', (e) => {
  dragDepth = 0;
  $('dropHint').classList.add('hidden');
  if (dragHasFiles(e) && M.t) addFiles(e.dataTransfer.files);
});
// Soltar arquivo fora do chat não abre nada.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());
// Imagem aberta grande.
$('viewerClose').onclick = closeViewer;
$('viewer').addEventListener('mousedown', (e) => { if (e.target === $('viewer')) closeViewer(); });
$('viewerSave').onclick = () => {
  if (!viewing) return;
  const { m, t } = viewing;
  const url = fullCache.get(m.att.fid);
  if (url) saveBytes(m.att.name, partsToBytes([url.split(',')[1]]));
  else saveAttachment(t, m.att, $('viewerSave'));
};
// Cartão de perfil.
$('ucForm').addEventListener('submit', sendFromCard);
$('ucEdit').onclick = () => { closeUserCard(); openSettings('perfil'); };
document.addEventListener('mousedown', (e) => {
  if (cardOpen() && !$('ucard').contains(e.target)) closeUserCard();
}, true);
window.addEventListener('focus', () => {
  if (M.t && M.t.did && G.view === 'chat') markDmRead(M.t.did);
});
$('composer').addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
$('msgList').addEventListener('scroll', () => {
  const box = $('msgList');
  if (!box.clientHeight) return;
  M.atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  if (box.scrollTop < 120) loadOlder();
});
// De minuto em minuto: tira das salas quem "sumiu" e passa pra offline quem parou de avisar.
setInterval(() => { if (G.gid) renderChannels(); }, 60000);

// ---------------- perfis (foto e efeito no nome) ----------------
// Cada conta tem um perfil público (foto + efeito no nome). O app só ouve o perfil de quem aparece
// na tela (chat, salas, listas) e redesenha quando algum muda.
const FX = { fire: 'Fogo', bolt: 'Raio', water: 'Água', ice: 'Gelo', neon: 'Neon', rainbow: 'Arco-íris' };
const PHOTO_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const PF = { map: new Map(), subs: new Map(), raf: 0 };

function profileOf(uid) {
  if (!uid) return null;
  if (!PF.subs.has(uid) && window.SPAuth && window.SPAuth.profile()) {
    PF.subs.set(uid, window.SPAuth.watchProfile(uid, (prof) => {
      PF.map.set(uid, prof);
      profilesChanged();
    }));
  }
  return PF.map.get(uid) || null;
}
function stopProfiles() {
  for (const unsub of PF.subs.values()) { try { unsub(); } catch {} }
  PF.subs.clear();
  PF.map.clear();
}
function fxClass(uid) {
  const prof = profileOf(uid);
  return prof && FX[prof.fx] ? `fx fx-${prof.fx}` : '';
}
function paintPhoto(el, photo) {
  if (!PHOTO_RE.test(photo)) return false;
  el.style.backgroundImage = `url("${photo}")`;
  el.style.backgroundSize = 'cover';
  el.style.backgroundPosition = 'center';
  el.textContent = '';
  return true;
}
// Bolinha com a foto da pessoa (ou a inicial do nome, num tom de cinza).
function paintAv(el, uid, name) {
  const prof = profileOf(uid);
  el.style.background = colorOf(uid || name || '?');
  if (!(prof && prof.photo && paintPhoto(el, prof.photo))) el.textContent = initial(name);
}
function profilesChanged() {
  if (PF.raf) return;
  PF.raf = requestAnimationFrame(() => {
    PF.raf = 0;
    paintMe();
    if (M.t && M.loaded) renderMessages();
    if (M.t && M.t.did) renderChatHead();
    if (S.entered) renderPeople();
    renderChannels();
  });
}

// Escolhe uma imagem do PC e devolve um quadrado 160x160 (WEBP) pronto pra guardar.
function pickImage() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      try {
        resolve(await squarePhoto(file));
      } catch {
        toast('Não consegui abrir essa imagem. Tente outra (PNG, JPG, WEBP ou GIF).', 'err');
        resolve(null);
      }
    });
    input.click();
  });
}
async function squarePhoto(file, size = 160) {
  if (file.size > 25 * 1024 * 1024) throw new Error('grande demais');
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  let url = canvas.toDataURL('image/webp', 0.86);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.88);
  return url;
}

// Meu nome e foto no rodapé da coluna dos canais (e no Perfil, se estiver aberto).
function paintMe() {
  const me = window.SPAuth && window.SPAuth.profile();
  if (!me || !me.nick) return;
  $('meName').textContent = me.nick;
  $('meName').className = fxClass(me.uid);
  paintAv($('meAv'), me.uid, me.nick);
  if (!$('settings').classList.contains('hidden')) renderProfileCard();
}

// Aba Perfil das configurações.
function renderProfileCard() {
  const me = window.SPAuth && window.SPAuth.profile();
  if (!me || !me.nick) return;
  const mine = profileOf(me.uid) || { photo: '', fx: '' };
  paintAv($('pfAv'), me.uid, me.nick);
  $('pfName').textContent = me.nick;
  $('pfName').className = fxClass(me.uid);
  $('pfEmail').textContent = me.email;
  $('pfRemove').disabled = !mine.photo;
  const grid = $('fxGrid');
  grid.textContent = '';
  for (const [key, label] of [['', 'Nenhum'], ...Object.entries(FX)]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fx-opt' + ((mine.fx || '') === key ? ' sel' : '');
    const sample = document.createElement('span');
    sample.className = 'fx-sample' + (key ? ` fx fx-${key}` : '');
    sample.textContent = me.nick;
    const name = document.createElement('small');
    name.textContent = label;
    b.append(sample, name);
    b.onclick = () => {
      if ((mine.fx || '') === key) return;
      saveMine({ fx: key }, key ? `Efeito “${label}” no seu nome!` : 'Seu nome voltou ao normal.');
    };
    grid.appendChild(b);
  }
}
// Salva meu perfil e já mostra a mudança (volta atrás se o Firebase recusar).
async function saveMine(patch, okMsg) {
  const me = window.SPAuth.profile();
  if (!me) return;
  const before = PF.map.get(me.uid) || { photo: '', fx: '' };
  PF.map.set(me.uid, { ...before, ...patch });
  profilesChanged();
  try {
    await window.SPAuth.saveProfile(patch);
    if (okMsg) toast(okMsg);
  } catch (err) {
    PF.map.set(me.uid, before);
    profilesChanged();
    toast(groupErr(err, 'Não consegui salvar seu perfil'), 'err');
  }
}
async function changeMyPhoto() {
  const url = await pickImage();
  if (url) saveMine({ photo: url }, 'Foto de perfil atualizada!');
}

$('pfAv').onclick = changeMyPhoto;
$('pfPhoto').onclick = changeMyPhoto;
$('pfRemove').onclick = () => saveMine({ photo: '' }, 'Foto de perfil removida.');
$('meAv').onclick = () => openSettings('perfil');
document.querySelector('.user-panel .me-text').onclick = () => openSettings('perfil');

// ---------------- online / offline ----------------
// Com o app aberto, cada um avisa no Firebase a cada 4 min; ao fechar o app ou sair da conta, avisa
// que saiu. Quem parou de avisar há mais de 9 min (PC desligou, app travou) aparece offline.
const PRESENCE_BEAT = 4 * 60 * 1000;
const PRESENCE_FRESH = 9 * 60 * 1000;
const PR = { map: new Map(), subs: new Map(), timer: null, uid: '', denied: false, raf: 0 };

function presenceOf(uid) {
  if (!uid) return null;
  if (!PR.subs.has(uid) && window.SPAuth && window.SPAuth.profile()) {
    PR.subs.set(uid, window.SPAuth.watchPresence(uid, (st, err) => {
      if (st) PR.map.set(uid, st);
      else if (err && err.code === 'permission-denied') PR.denied = true;
      renderMembersSoon();
    }));
  }
  return PR.map.get(uid) || null;
}
function isOnline(uid) {
  if (uid && uid === PR.uid) return true;   // eu, com o app aberto
  const st = presenceOf(uid);
  return !!(st && st.on && Date.now() - st.at < PRESENCE_FRESH);
}
function startPresence(uid) {
  if (PR.uid === uid && PR.timer) return;
  stopPresence();
  PR.uid = uid;
  const beat = () => {
    window.SPAuth.setPresence(true).catch((err) => {
      if (err && err.code === 'permission-denied') { PR.denied = true; renderMembersSoon(); }
    });
  };
  beat();
  PR.timer = setInterval(beat, PRESENCE_BEAT);
}
function stopPresence() {
  clearInterval(PR.timer);
  for (const unsub of PR.subs.values()) { try { unsub(); } catch {} }
  Object.assign(PR, { map: new Map(), subs: new Map(), timer: null, uid: '', denied: false });
}
// Avisa "offline" (sair da conta, fechar o app, reiniciar pra atualizar). Espera no máximo `ms`.
function goOffline(ms = 1200) {
  clearInterval(PR.timer);
  PR.timer = null;
  if (!PR.uid || !window.SPAuth.profile()) return Promise.resolve();
  return Promise.race([window.SPAuth.setPresence(false).catch(() => {}), sleep(ms)]);
}
function renderMembersSoon() {
  if (PR.raf) return;
  PR.raf = requestAnimationFrame(() => {
    PR.raf = 0;
    renderMembers();
    if (!G.gid) renderChannelList();
  });
}
// Fechando a janela: sai da sala, avisa que ficou offline e libera o fechamento.
if (IS_APP && window.tav.onClosing) {
  window.tav.onClosing(async () => {
    const inRoom = !!(S.peer || S.group);
    if (inRoom) leaveRoom();
    await Promise.all([goOffline(1200), sleep(inRoom ? 500 : 0)]);   // o "saí" da sala precisa de um instante
    window.tav.canClose();
  });
}

// ---------------- conta (entrar / criar conta) ----------------
const AUTH_ERRORS = {
  'auth/invalid-email': 'Esse e-mail não parece válido.',
  'auth/missing-email': 'Digite seu e-mail.',
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/invalid-login-credentials': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/missing-password': 'Digite sua senha.',
  'auth/email-already-in-use': 'Já existe uma conta com esse e-mail. Use “Entrar” ou “Esqueci minha senha”.',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'auth/too-many-requests': 'Muitas tentativas seguidas. Espere um pouco e tente de novo.',
  'auth/network-request-failed': 'Sem conexão com a internet. Confira e tente de novo.',
  'auth/user-disabled': 'Essa conta foi desativada.',
  'auth/operation-not-allowed': 'O login por e-mail ainda não foi ativado no Firebase.',
  'auth/configuration-not-found': 'O login por e-mail ainda não foi ativado no Firebase.',
  'nick/invalid': 'O usuário precisa ter de 3 a 20 caracteres: letras, números, espaço, _ - .',
  'nick/taken': 'Esse usuário já tem dono. Escolha outro.',
  'permission-denied': 'O Firebase recusou salvar o usuário. Confira as regras do Firestore.',
  'not-found': 'O banco de dados (Firestore) ainda não foi criado no Firebase.',
  'unavailable': 'Não consegui acessar o banco de dados. Confira sua internet (ou se o Firestore já foi criado no Firebase).',
};
function authErr(err) {
  return AUTH_ERRORS[err && err.code] || ('Não deu certo: ' + ((err && (err.code || err.message)) || 'erro desconhecido'));
}
function authMsg(text, kind) {
  const el = $('authMsg');
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}
let authBusy = false;
function setAuthBusy(on) {
  authBusy = on;
  for (const b of $('auth').querySelectorAll('form button')) b.disabled = on;
}

// Qual parte mostrar: 'loading' | 'login' | 'signup' | 'nick'.
function showAuth(view) {
  $('auth').classList.remove('hidden');
  $('app').classList.add('hidden');
  closeMenu();
  closeDlg(null);
  $('authLoading').classList.toggle('hidden', view !== 'loading');
  for (const [id, v] of [['loginForm', 'login'], ['signupForm', 'signup'], ['nickForm', 'nick']]) {
    $(id).classList.toggle('hidden', view !== v);
  }
  authMsg('');
  const first = { login: 'loginEmail', signup: 'signupNick', nick: 'nickOnly' }[view];
  if (first) setTimeout(() => $(first).focus(), 0);
}

function applyNick(me) {
  S.myName = me.nick;
  paintMe();
  syncMemberNames();
}

function showApp() {
  $('auth').classList.add('hidden');
  $('app').classList.remove('hidden');
}

function onAccountChange(me) {
  if (!me) {
    if (S.peer || S.group) leaveRoom();
    stopGroups();
    stopProfiles();
    stopPresence();
    $('loginPass').value = '';
    showAuth('login');
    return;
  }
  if (!me.nick) {
    if (!authBusy) showAuth('nick');   // criando a conta: o nick chega já já
    return;
  }
  applyNick(me);
  startPresence(me.uid);
  startGroups(me.uid);
  showApp();
}

async function startAccount() {
  showAuth('loading');
  if (!window.SPAuth) {
    $('authLoading').classList.add('hidden');
    authMsg('Não consegui carregar o login. Feche e abra o ScreenPLAY de novo.', 'err');
    return;
  }
  let flags = {};
  if (IS_APP && window.tav.devFlags) {
    try { flags = await window.tav.devFlags(); } catch { flags = {}; }
  }
  window.SPAuth.onChange(onAccountChange);
  try {
    await window.SPAuth.init({ emulator: flags.emulator || '' });
  } catch (err) {
    $('authLoading').classList.add('hidden');
    authMsg(authErr(err), 'err');
  }
}

async function logout() {
  closeSettings();
  if (S.peer || S.group) leaveRoom();
  await goOffline();
  stopGroups();
  stopProfiles();
  stopPresence();
  try { await window.SPAuth.signOut(); } catch (err) { toast(authErr(err), 'err'); }
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (authBusy) return;
  const email = $('loginEmail').value.trim();
  const pass = $('loginPass').value;
  if (!email) return authMsg('Digite seu e-mail.', 'err');
  if (!pass) return authMsg('Digite sua senha.', 'err');
  setAuthBusy(true);
  authMsg('Entrando…');
  try {
    await window.SPAuth.signIn(email, pass);
  } catch (err) {
    authMsg(authErr(err), 'err');
  } finally {
    setAuthBusy(false);
  }
});

$('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (authBusy) return;
  const nickRaw = $('signupNick').value;
  const email = $('signupEmail').value.trim();
  const pass = $('signupPass').value;
  try { window.SPAuth.checkNick(nickRaw); } catch (err) { return authMsg(authErr(err), 'err'); }
  if (!email) return authMsg('Digite seu e-mail.', 'err');
  if (pass.length < 6) return authMsg('A senha precisa ter pelo menos 6 caracteres.', 'err');
  if (pass !== $('signupPass2').value) return authMsg('As duas senhas não são iguais.', 'err');
  setAuthBusy(true);
  authMsg('Criando sua conta…');
  try {
    await window.SPAuth.signUp(nickRaw, email, pass);
    $('signupPass').value = '';
    $('signupPass2').value = '';
    toast(`Conta criada! Bem-vindo, ${window.SPAuth.profile().nick} 👋`);
  } catch (err) {
    authMsg(authErr(err), 'err');
  } finally {
    setAuthBusy(false);
  }
});

$('nickForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (authBusy) return;
  setAuthBusy(true);
  try {
    await window.SPAuth.setNick($('nickOnly').value);
  } catch (err) {
    authMsg(authErr(err), 'err');
  } finally {
    setAuthBusy(false);
  }
});

$('forgotBtn').onclick = async () => {
  const email = $('loginEmail').value.trim();
  if (!email) {
    authMsg('Digite seu e-mail no campo acima e clique de novo em “Esqueci minha senha”.', 'err');
    $('loginEmail').focus();
    return;
  }
  setAuthBusy(true);
  try {
    await window.SPAuth.resetPassword(email);
    authMsg('Se existir uma conta com esse e-mail, mandamos um link pra criar uma senha nova. Olhe também o spam.', 'ok');
  } catch (err) {
    authMsg(authErr(err), 'err');
  } finally {
    setAuthBusy(false);
  }
};
$('toSignup').onclick = () => {
  showAuth('signup');
  if ($('loginEmail').value) $('signupEmail').value = $('loginEmail').value;
};
$('toLogin').onclick = () => {
  showAuth('login');
  if ($('signupEmail').value) $('loginEmail').value = $('signupEmail').value;
};
$('nickLogout').onclick = logout;
$('setLogout').onclick = logout;

// ---------------- configurações (engrenagem) ----------------
function openSettings(tab) {
  $('settings').classList.remove('hidden');
  showSettingsTab(tab || 'perfil');
  fillSettings();
  document.addEventListener('keydown', onSettingsKey);
}
function closeSettings() {
  $('settings').classList.add('hidden');
  document.removeEventListener('keydown', onSettingsKey);
}
function onSettingsKey(e) {
  if (e.key === 'Escape') closeSettings();
}
function showSettingsTab(tab) {
  for (const b of document.querySelectorAll('.set-tab')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const page of document.querySelectorAll('.set-page')) page.classList.toggle('hidden', page.dataset.page !== tab);
  $('settings').querySelector('.set-body').scrollTop = 0;
}

async function fillSettings() {
  const me = window.SPAuth && window.SPAuth.profile();
  $('setName').value = me ? me.nick : '';
  $('setName').disabled = !me;
  $('setEmail').textContent = me ? me.email : 'Você ainda não entrou numa conta.';
  $('setLogout').classList.toggle('hidden', !me);
  const prefs = sharePrefs();
  $('setQuality').value = prefs.quality;
  $('setEncoder').value = prefs.encoder;
  $('setAudio').checked = prefs.audio;
  const vol = Math.round(sfxVolume * 100);
  $('setSfxVol').value = vol;
  $('setSfxVolText').textContent = vol + '%';
  renderProfileCard();
  renderThemeEditor(currentTheme());
  $('updateStatus').textContent = 'O ScreenPLAY se atualiza sozinho sempre que abre.';
  let app = null;
  if (IS_APP && window.tav.settingsGet) {
    try { app = await window.tav.settingsGet(); } catch { app = null; }
  }
  renderAutoStart(app);
  $('aboutVersion').textContent = app ? 'Versão ' + app.version : '';
}

// Iniciar com o Windows / abrir minimizado (só no app instalado).
function renderAutoStart(app) {
  const can = !!(app && app.canAutoStart);
  const on = !!(app && app.openAtLogin);
  $('setAutoStart').checked = on;
  $('setMinimized').checked = !!(app && app.startMinimized);
  $('setAutoStart').disabled = !can;
  $('setMinimized').disabled = !can || !on;
  $('autoStartNote').textContent = can
    ? 'O ScreenPLAY abre sozinho quando você liga o PC.'
    : 'Disponível no ScreenPLAY instalado.';
}
async function changeAutoStart(patch) {
  if (!IS_APP || !window.tav.settingsSet) return;
  try {
    renderAutoStart(await window.tav.settingsSet(patch));
  } catch {
    toast('Não consegui mudar essa opção agora.', 'err');
  }
}

// Trocar o nick: reserva o novo (tem que estar livre) e vale na hora, inclusive dentro da sala.
async function applyName() {
  const me = window.SPAuth && window.SPAuth.profile();
  if (!me) return;
  let nick;
  try {
    nick = window.SPAuth.checkNick($('setName').value);
  } catch (err) {
    toast(authErr(err), 'err');
    $('setName').value = me.nick;
    return;
  }
  if (nick.display === me.nick) return;
  $('setName').disabled = true;
  try {
    const updated = await window.SPAuth.setNick(nick.display);
    applyNick(updated);
    if (S.peer && S.code) {
      const mine = S.view.get(S.myId);
      if (mine) mine.name = updated.nick;
      renderPeople();
      sendState(true);
    }
    toast(`Usuário alterado para ${updated.nick}`);
  } catch (err) {
    toast(authErr(err), 'err');
    $('setName').value = me.nick;
  } finally {
    $('setName').disabled = false;
  }
}

async function checkUpdateNow() {
  const out = $('updateStatus');
  if (!IS_APP || !window.tav.checkUpdate) {
    out.textContent = 'As atualizações automáticas só funcionam no ScreenPLAY instalado.';
    return;
  }
  $('checkUpdateBtn').disabled = true;
  out.textContent = 'Procurando…';
  let r;
  try { r = await window.tav.checkUpdate(); } catch { r = { status: 'error' }; }
  $('checkUpdateBtn').disabled = false;
  out.textContent = {
    dev: 'As atualizações automáticas só funcionam no ScreenPLAY instalado.',
    latest: `Você já está na versão mais nova (${r.version}).`,
    available: `Baixando a versão ${r.version}… quando terminar, aparece o aviso para reiniciar.`,
    ready: `A versão ${r.version} já foi baixada — clique em “Reiniciar agora” no aviso lá em cima.`,
    error: 'Não consegui procurar agora. Confira sua internet e tente de novo.',
  }[r.status] || 'Não consegui procurar agora.';
  if (r.status === 'ready') {
    $('updateText').textContent = `Versão ${r.version} pronta!`;
    $('updateBar').classList.remove('hidden');
  }
}

// ---------------- personalizar (cores) ----------------
// As cores ficam no localStorage (theme-boot.js aplica antes de desenhar) e a cor de fundo também
// vai para o lado Windows, pra janela já abrir com ela.
let themeVars = {};
let themeSaveTimer = null;
const themeDefaults = () => ({ ...window.SP_THEME.PRESETS.mono.vars });
function currentTheme() {
  const saved = window.SP_THEME.load();
  return { ...themeDefaults(), ...(saved ? saved.vars : {}) };
}
function sameTheme(a, b) {
  return window.SP_THEME.KEYS.every(([k]) => String(a[k]).toLowerCase() === String(b[k]).toLowerCase());
}
function persistTheme() {
  clearTimeout(themeSaveTimer);
  themeSaveTimer = setTimeout(() => {
    window.SP_THEME.save({ vars: themeVars });
    if (IS_APP && window.tav.settingsSet) window.tav.settingsSet({ windowBg: themeVars['--bg'] }).catch(() => {});
  }, 250);
}
function markPresets() {
  for (const b of $('presetGrid').children) {
    b.classList.toggle('sel', sameTheme(window.SP_THEME.PRESETS[b.dataset.preset].vars, themeVars));
  }
}
function setThemeColor(key, value) {
  themeVars[key] = value;
  window.SP_THEME.apply(themeVars);
  persistTheme();
  markPresets();
}
function useTheme(vars) {
  themeVars = { ...themeDefaults(), ...vars };
  window.SP_THEME.apply(themeVars);
  persistTheme();
  renderThemeEditor(themeVars);
}
function resetTheme() {
  clearTimeout(themeSaveTimer);
  window.SP_THEME.save(null);
  window.SP_THEME.apply(null);
  if (IS_APP && window.tav.settingsSet) window.tav.settingsSet({ windowBg: themeDefaults()['--bg'] }).catch(() => {});
  renderThemeEditor(themeDefaults());
  toast('Cores voltaram ao padrão.');
}

function renderThemeEditor(vars) {
  themeVars = { ...vars };
  const presets = $('presetGrid');
  presets.textContent = '';
  for (const [id, preset] of Object.entries(window.SP_THEME.PRESETS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.dataset.preset = id;
    const sw = document.createElement('span');
    sw.className = 'sw';
    for (const k of ['--bg', '--panel-2', '--text', '--accent', '--live']) {
      const i = document.createElement('i');
      i.style.background = preset.vars[k];
      sw.appendChild(i);
    }
    const label = document.createElement('span');
    label.textContent = preset.name;
    b.append(sw, label);
    b.onclick = () => useTheme(preset.vars);
    presets.appendChild(b);
  }
  const grid = $('colorGrid');
  grid.textContent = '';
  for (const [key, labelText] of window.SP_THEME.KEYS) {
    const row = document.createElement('label');
    row.className = 'color-row';
    const label = document.createElement('span');
    label.textContent = labelText;
    const color = document.createElement('input');
    color.type = 'color';
    color.value = themeVars[key];
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.className = 'hex';
    hex.maxLength = 7;
    hex.spellcheck = false;
    hex.value = themeVars[key];
    color.addEventListener('input', () => {
      hex.value = color.value;
      setThemeColor(key, color.value);
    });
    hex.addEventListener('change', () => {
      let v = hex.value.trim();
      if (!v.startsWith('#')) v = '#' + v;
      if (window.SP_THEME.isHex(v)) {
        v = v.toLowerCase();
        color.value = v;
        hex.value = v;
        setThemeColor(key, v);
      } else {
        hex.value = themeVars[key];
      }
    });
    row.append(label, color, hex);
    grid.appendChild(row);
  }
  markPresets();
}

for (const b of document.querySelectorAll('[data-settings]')) b.onclick = () => openSettings();
for (const b of document.querySelectorAll('.set-tab')) b.onclick = () => showSettingsTab(b.dataset.tab);
$('setClose').onclick = closeSettings;
$('settings').addEventListener('mousedown', (e) => { if (e.target === $('settings')) closeSettings(); });   // clique fora fecha
$('setName').addEventListener('change', applyName);
$('setName').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('setQuality').addEventListener('change', (e) => store('tav-quality', e.target.value));
$('setEncoder').addEventListener('change', (e) => store('tav-encoder', e.target.value));
$('setAudio').addEventListener('change', (e) => store('tav-audio', e.target.checked ? '1' : '0'));
$('setSfxVol').addEventListener('input', (e) => {
  sfxVolume = Number(e.target.value) / 100;
  store('tav-sfx-vol', String(e.target.value));
  $('setSfxVolText').textContent = e.target.value + '%';
});
$('setSfxVol').addEventListener('change', () => sfx('join'));
$('setSfxTest').onclick = () => sfx('live');
$('setAutoStart').addEventListener('change', (e) => changeAutoStart({ openAtLogin: e.target.checked }));
$('setMinimized').addEventListener('change', (e) => changeAutoStart({ startMinimized: e.target.checked }));
$('themeReset').onclick = resetTheme;
$('checkUpdateBtn').onclick = checkUpdateNow;
$('openReleases').onclick = () => { if (IS_APP && window.tav.openReleases) window.tav.openReleases(); };

// ---------------- eventos da página ----------------
if (!IS_APP) {
  $('setAudioNote').textContent = 'Na janela que abrir, ative “Compartilhar áudio” (Tela inteira ou Guia). O microfone nunca vai junto.';
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
  if (S.peer || S.group) leaveRoom();
  goOffline(1000).then(() => window.tav.restartToUpdate());
};
$('updateLater').onclick = () => {
  $('updateBar').classList.add('hidden');
  toast('Tudo bem — a atualização instala sozinha quando você fechar o ScreenPLAY.');
};

window.addEventListener('pagehide', () => {
  stopHosting();
  try { if (S.peer) S.peer.destroy(); } catch {}
});

// Abre pela conta: se já entrou antes, vai direto pra tela inicial.
startAccount();
