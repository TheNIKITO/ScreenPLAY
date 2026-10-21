// Discord Rich Presence: mostra no perfil do Discord o que você está fazendo no ScreenPLAY.
// Conversa direto com o Discord aberto no PC (pipe local \\.\pipe\discord-ipc-N), sem servidor.
//
//   const presence = require('./discord');
//   presence.start(APP_ID);
//   presence.set({ mode: 'watch', who: 'João', people: 3, since: Date.now() });
//   presence.set(null);   // limpa

const net = require('net');

const ICON_URL = 'https://raw.githubusercontent.com/TheNIKITO/ScreenPLAY/main/assets/icon.png';
const DOWNLOAD_URL = 'https://github.com/TheNIKITO/ScreenPLAY/releases/latest';
const RETRY_MS = 15000;
const MIN_GAP_MS = 4000;   // o Discord aceita ~5 mudanças de status a cada 20 s

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

let appId = '';
let sock = null;
let ready = false;
let wanted = null;         // última atividade pedida (Discord) — reenviada ao reconectar
let sentJson = '';        // o que o Discord já está mostrando
let lastSentAt = 0;
let sendTimer = null;
let retryTimer = null;
let inbox = Buffer.alloc(0);
let log = () => {};

function encode(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (appId) retryTimer = setTimeout(() => connect(0), RETRY_MS);
}

// Tenta discord-ipc-0 … 9 (o Discord usa o primeiro livre).
function connect(index) {
  if (!appId || sock) return;
  if (index > 9) { scheduleRetry(); return; }
  const s = net.createConnection(`\\\\?\\pipe\\discord-ipc-${index}`);
  let opened = false;
  s.once('connect', () => {
    opened = true;
    sock = s;
    inbox = Buffer.alloc(0);
    s.write(encode(OP_HANDSHAKE, { v: 1, client_id: appId }));
  });
  s.on('data', onData);
  s.on('error', () => {
    if (!opened) { s.destroy(); connect(index + 1); }
  });
  s.on('close', () => {
    if (sock !== s) return;
    sock = null;
    ready = false;
    log('desconectado do Discord');
    scheduleRetry();
  });
}

function onData(chunk) {
  inbox = Buffer.concat([inbox, chunk]);
  while (inbox.length >= 8) {
    const op = inbox.readInt32LE(0);
    const len = inbox.readInt32LE(4);
    if (inbox.length < 8 + len) return;
    let msg = null;
    try { msg = JSON.parse(inbox.subarray(8, 8 + len).toString('utf8')); } catch {}
    inbox = inbox.subarray(8 + len);
    if (op === OP_PING) {
      if (sock) sock.write(encode(OP_PONG, msg || {}));
    } else if (op === OP_CLOSE) {
      log('Discord recusou a conexão: ' + JSON.stringify(msg));   // ex.: Application ID inválido
      if (sock) sock.destroy();
    } else if (op === OP_FRAME && msg) {
      if (msg.evt === 'READY') {
        ready = true;
        sentJson = '';
        log('conectado ao Discord de ' + ((msg.data && msg.data.user && msg.data.user.username) || '?'));
        send();
      } else if (msg.evt === 'ERROR') {
        log('erro do Discord: ' + JSON.stringify(msg.data));
      } else if (msg.cmd === 'SET_ACTIVITY') {
        log('status no Discord: ' + JSON.stringify(msg.data));
      }
    }
  }
}

// Manda a atividade mais recente, sem repetir e respeitando o limite do Discord: mudanças rápidas
// (gente entrando e saindo) viram uma atualização só, com o estado final.
function send() {
  if (!sock || !ready) return;
  const json = JSON.stringify(wanted);
  if (json === sentJson) return;
  const wait = lastSentAt + MIN_GAP_MS - Date.now();
  if (wait > 0) {
    if (!sendTimer) sendTimer = setTimeout(() => { sendTimer = null; send(); }, wait);
    return;
  }
  const args = { pid: process.pid };
  if (wanted) args.activity = wanted;
  sock.write(encode(OP_FRAME, { cmd: 'SET_ACTIVITY', args, nonce: String(Date.now()) + Math.random() }));
  sentJson = json;
  lastSentAt = Date.now();
}

// Monta o que aparece no Discord a partir do estado do ScreenPLAY.
//  - assistindo:   lista de membros "Assistindo João" (cartão: "Assistindo ScreenPLAY" / "João")
//  - transmitindo: "Jogando ScreenPLAY" / "Transmitindo a tela · 2 assistindo"
//  - só na sala:   "Jogando ScreenPLAY" / "Na sala · 3 pessoas"
function build(state) {
  if (!state || !state.mode) return null;
  const people = Number(state.people) || 1;
  const inRoom = `Na sala com ${people} ${people === 1 ? 'pessoa' : 'pessoas'}`;
  const activity = {
    assets: { large_image: ICON_URL, large_text: 'ScreenPLAY' },
    buttons: [{ label: 'Baixar ScreenPLAY', url: DOWNLOAD_URL }],
    instance: false,
  };
  if (state.since) activity.timestamps = { start: Math.floor(Number(state.since)) };
  if (state.mode === 'watch') {
    activity.type = 3;                     // Assistindo
    activity.status_display_type = 2;      // a lista de membros mostra o "details"
    activity.details = clip(state.who || "alguém", 40);   // só o nick: "Assistindo João"
    activity.state = inRoom;
  } else if (state.mode === 'share') {
    const n = Number(state.viewers) || 0;
    activity.type = 0;                     // Jogando
    activity.details = 'Transmitindo a tela';
    activity.state = n ? `${n} ${n === 1 ? 'pessoa assistindo' : 'pessoas assistindo'}` : 'Esperando alguém assistir';
  } else {
    activity.type = 0;
    activity.details = 'Na sala';
    activity.state = inRoom;
  }
  return activity;
}

function clip(text, max) {
  const s = String(text);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

module.exports = {
  start(id, logger) {
    appId = String(id || '').trim();
    if (logger) log = logger;
    if (appId) connect(0);
  },
  set(state) {
    wanted = build(state);
    send();
  },
  stop() {
    appId = '';
    clearTimeout(retryTimer);
    clearTimeout(sendTimer);
    sendTimer = null;
    if (sock) {
      try {
        const args = { pid: process.pid };   // limpa o status na hora, sem esperar o intervalo
        if (ready) sock.write(encode(OP_FRAME, { cmd: 'SET_ACTIVITY', args, nonce: String(Date.now()) }));
      } catch {}
      sock.destroy();
    }
    sock = null;
    ready = false;
  },
};
