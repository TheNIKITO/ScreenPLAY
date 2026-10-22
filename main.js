const { app, BrowserWindow, Menu, desktopCapturer, ipcMain, powerSaveBlocker, screen, session, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const presence = require('./discord');

// Permite abrir duas cópias separadas no mesmo PC (útil para testar): TAV_PROFILE=b
if (process.env.TAV_PROFILE) {
  app.setPath('userData', path.join(app.getPath('temp'), 'screenplay-' + process.env.TAV_PROFILE));
}
app.setAppUserModelId('com.screenplay.app');

const ICON = path.join(__dirname, 'assets', 'icon.png');
// Aplicativo "ScreenPLAY" no Discord Developer Portal (o nome dele aparece em "Jogando ScreenPLAY").
const DISCORD_APP_ID = '1562274053866127552';
const PRELOAD = path.join(__dirname, 'preload.js');
const CHECK_TIMEOUT = 15000;            // GitHub não respondeu: abre assim mesmo
const STALL_TIMEOUT = 30000;            // download parado: abre e termina em segundo plano
const RECHECK_EVERY = 30 * 60 * 1000;   // com o app aberto, procura de novo a cada 30 min

let splash = null;
let mainWin = null;
let allowClose = false;   // true = a página já se despediu (ou passou do tempo), pode fechar
function finishClose() {
  allowClose = true;
  if (mainWin && !mainWin.isDestroyed()) mainWin.close();
}
let splashState = { text: 'Iniciando…', progress: null, version: app.getVersion() };
let readyVersion = null;     // atualização baixada esperando reiniciar
let pendingSource = null;    // fonte escolhida no seletor, usada no próximo getDisplayMedia
let awakeBlocker = null;
let audioProc = null;        // ScreenPLAYAudio.exe (som app por app, sem o Discord)

// Aberto pelo Windows ao ligar o PC com "Abrir minimizado" ligado.
const launchedMinimized = process.argv.includes('--minimized');
const RELEASES_URL = 'https://github.com/TheNIKITO/ScreenPLAY/releases';

// Configurações que o lado Windows precisa antes da página abrir (salvas em userData/settings.json).
let settings = { startMinimized: false, windowBg: '#0a0a0a' };
function settingsFile() { return path.join(app.getPath('userData'), 'settings.json'); }
function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { /* primeira vez */ }
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (err) { console.warn('[settings]', err.message); }
}
const windowBg = () => (/^#[0-9a-f]{6}$/i.test(settings.windowBg) ? settings.windowBg : '#0a0a0a');

// Iniciar com o Windows: só no app instalado (no modo de desenvolvimento abriria o Electron puro).
const canAutoStart = () => app.isPackaged;
const loginArgs = () => (settings.startMinimized ? ['--minimized'] : []);
function getAppSettings() {
  const openAtLogin = canAutoStart()
    ? app.getLoginItemSettings({ path: process.execPath, args: loginArgs() }).openAtLogin
    : false;
  return { openAtLogin, startMinimized: !!settings.startMinimized, canAutoStart: canAutoStart(), version: app.getVersion() };
}
function setAppSettings(patch) {
  const before = getAppSettings();
  if (patch && typeof patch.startMinimized === 'boolean') settings.startMinimized = patch.startMinimized;
  if (patch && typeof patch.windowBg === 'string' && /^#[0-9a-f]{6}$/i.test(patch.windowBg)) settings.windowBg = patch.windowBg;
  saveSettings();
  const openAtLogin = patch && typeof patch.openAtLogin === 'boolean' ? patch.openAtLogin : before.openAtLogin;
  if (canAutoStart()) {
    // Mesmo nome de registro sempre: trocar "abrir minimizado" só reescreve a linha de comando.
    app.setLoginItemSettings({ openAtLogin, path: process.execPath, args: loginArgs() });
  }
  return getAppSettings();
}

// Apps que nunca entram no som da transmissão de tela inteira.
const AUDIO_EXCLUDE_NAMES = ['discord.exe', 'discordptb.exe', 'discordcanary.exe', 'screenplay.exe'];

// Uma janela só (como o Discord): abrir de novo só traz o app pra frente.
const gotLock = !!process.env.TAV_PROFILE || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = mainWin || splash;
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    stopAppAudio();
    presence.stop();
  });
}

async function start() {
  Menu.setApplicationMenu(null);
  loadSettings();
  registerIpc();
  presence.start(DISCORD_APP_ID, (msg) => console.log('[discord]', msg));
  registerDisplayMedia();
  createSplash();

  const minSplash = new Promise((r) => setTimeout(r, 1500));   // não pisca na tela
  const installing = await startupUpdate();
  if (installing) return;   // o app fecha, instala e abre de novo sozinho
  await minSplash;
  setSplash({ text: 'Iniciando…', progress: null });
  createMain();
  scheduleBackgroundChecks();
}

// ---------------- janelas ----------------
function lockDown(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function createSplash() {
  splash = new BrowserWindow({
    width: 300,
    height: 340,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    title: 'ScreenPLAY',
    backgroundColor: windowBg(),
    icon: ICON,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  lockDown(splash);
  splash.webContents.on('did-finish-load', sendSplash);
  splash.once('ready-to-show', () => { if (!launchedMinimized) splash.show(); });   // minimizado: sem tela de abertura
  splash.on('closed', () => { splash = null; });
  splash.loadFile(path.join(__dirname, 'splash.html'));
}

function setSplash(patch) {
  splashState = { ...splashState, ...patch };
  sendSplash();
}
function sendSplash() {
  if (splash && !splash.isDestroyed()) splash.webContents.send('tav:splash', splashState);
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1040,
    minHeight: 620,
    show: false,
    title: 'ScreenPLAY',
    backgroundColor: windowBg(),
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // continua transmitindo com o app minimizado
      autoplayPolicy: 'no-user-gesture-required',   // sons de aviso e áudio das telas tocam direto
    },
  });
  lockDown(mainWin);
  mainWin.webContents.on('did-finish-load', notifyUpdateReady);
  mainWin.once('ready-to-show', () => {
    if (launchedMinimized) mainWin.minimize();   // aparece só na barra de tarefas
    else mainWin.show();
    if (splash && !splash.isDestroyed()) splash.close();
  });
  // Antes de fechar, a página avisa os amigos que você ficou offline (espera no máximo 1,5 s).
  let closeAsked = false;
  mainWin.on('close', (e) => {
    if (allowClose || mainWin.webContents.isDestroyed()) return;
    e.preventDefault();
    if (closeAsked) return;
    closeAsked = true;
    mainWin.hide();   // some na hora; a despedida acontece por trás
    mainWin.webContents.send('tav:closing');
    setTimeout(finishClose, 1500);
  });
  mainWin.on('closed', () => {
    mainWin = null;
    stopAppAudio();
  });
  mainWin.loadFile(path.join(__dirname, 'index.html'));
}

// ---------------- atualização automática ----------------
function updatesEnabled() {
  return app.isPackaged || !!process.env.TAV_UPDATE_URL;
}

// Sempre existe alguém ouvindo 'error' (sem isso um erro de rede derrubaria o app).
autoUpdater.on('error', (err) => console.error('[update]', err && err.message));

// Procura atualização com a tela de abertura na frente. Resolve true se vai instalar e reiniciar.
function startupUpdate() {
  if (!updatesEnabled()) return Promise.resolve(false);
  if (process.env.TAV_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.TAV_UPDATE_URL });   // testes locais
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const arm = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => settle(false), ms);
    };
    const settle = (installing) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const [ev, fn] of handlers) autoUpdater.removeListener(ev, fn);
      resolve(installing);
    };
    const handlers = [
      ['checking-for-update', () => setSplash({ text: 'Procurando atualizações…', progress: null })],
      ['update-not-available', () => settle(false)],
      ['update-available', (info) => {
        arm(STALL_TIMEOUT);
        setSplash({ text: `Baixando a versão ${info.version}…`, progress: 0 });
      }],
      ['download-progress', (p) => {
        arm(STALL_TIMEOUT);
        setSplash({ text: `Baixando atualização… ${Math.floor(p.percent)}%`, progress: p.percent / 100 });
      }],
      ['update-downloaded', () => {
        setSplash({ text: 'Instalando atualização…', progress: 1 });
        settle(true);
        setTimeout(() => autoUpdater.quitAndInstall(true, true), 900);   // instala quieto e reabre
      }],
      ['error', () => {
        setSplash({ text: 'Não deu pra atualizar agora. Abrindo…', progress: null });
        setTimeout(() => settle(false), 1200);
      }],
    ];
    for (const [ev, fn] of handlers) autoUpdater.on(ev, fn);
    arm(CHECK_TIMEOUT);
    autoUpdater.checkForUpdates().catch(() => {});   // o erro chega pelo evento 'error'
  });
}

// Com o app aberto: baixa novidades em segundo plano e avisa que dá pra reiniciar.
function scheduleBackgroundChecks() {
  if (!updatesEnabled()) return;
  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = info.version;
    notifyUpdateReady();
  });
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), RECHECK_EVERY);
}

function notifyUpdateReady() {
  if (readyVersion && mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('tav:update-ready', readyVersion);
}

// ---------------- ponte com a página ----------------
// Marca do processador e da placa de vídeo (Intel / AMD / NVIDIA), para a caixa de codificador.
let hardwareCache = null;
async function hardwareInfo() {
  if (hardwareCache) return hardwareCache;
  const cpuModel = (os.cpus()[0] || {}).model || '';
  const cpu = /intel/i.test(cpuModel) ? 'Intel' : /\bamd\b|ryzen|athlon/i.test(cpuModel) ? 'AMD' : '';
  let gpu = '';
  try {
    const info = await app.getGPUInfo('basic');
    const devices = (info && info.gpuDevice) || [];
    const dev = devices.find((d) => d.active) || devices[0];
    if (dev) gpu = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x1022: 'AMD', 0x8086: 'Intel' }[dev.vendorId] || '';
  } catch (err) {
    console.warn('[hardware]', err && err.message);
  }
  hardwareCache = { cpu, gpu };
  return hardwareCache;
}

function registerIpc() {
  ipcMain.handle('tav:version', () => app.getVersion());
  ipcMain.handle('tav:hardware', () => hardwareInfo());
  ipcMain.handle('tav:settings-get', () => getAppSettings());
  // Testes: TAV_FIREBASE_EMULATOR=127.0.0.1 usa o Firebase local (emulador) em vez do de verdade.
  ipcMain.handle('tav:dev-flags', () => ({ emulator: process.env.TAV_FIREBASE_EMULATOR || '' }));
  ipcMain.handle('tav:settings-set', (_e, patch) => setAppSettings(patch || {}));

  // "Procurar atualização agora" (Configurações → Sobre). Se tiver, baixa em segundo plano e o
  // aviso "Versão X pronta" aparece quando terminar.
  ipcMain.handle('tav:check-update', async () => {
    if (!updatesEnabled()) return { status: 'dev', version: app.getVersion() };
    if (readyVersion) return { status: 'ready', version: readyVersion };
    try {
      const result = await autoUpdater.checkForUpdates();
      const latest = result && result.updateInfo && result.updateInfo.version;
      const available = result && typeof result.isUpdateAvailable === 'boolean'
        ? result.isUpdateAvailable
        : !!latest && latest !== app.getVersion();
      return available ? { status: 'available', version: latest } : { status: 'latest', version: app.getVersion() };
    } catch (err) {
      return { status: 'error', message: err && err.message };
    }
  });

  // Só abre a página de versões do ScreenPLAY no navegador.
  ipcMain.on('tav:open-releases', () => { shell.openExternal(RELEASES_URL); });

  // Status no Discord (Rich Presence). A página manda só o estado; o texto é montado em discord.js.
  ipcMain.on('tav:presence', (_e, state) => {
    if (!state || typeof state !== 'object') return presence.set(null);
    presence.set({
      mode: ['share', 'watch', 'room'].includes(state.mode) ? state.mode : null,
      who: String(state.who || '').slice(0, 60),
      people: Number(state.people) || 1,
      viewers: Number(state.viewers) || 0,
      since: Number(state.since) || 0,
    });
  });

  ipcMain.on('tav:restart-update', () => {
    if (!readyVersion) return;
    allowClose = true;   // a página já avisou que ficou offline
    autoUpdater.quitAndInstall(true, true);
  });
  ipcMain.on('tav:can-close', finishClose);

  ipcMain.handle('tav:sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    const displays = screen.getAllDisplays();
    const primaryId = screen.getPrimaryDisplay().id;
    return sources.map((s) => {
      const d = displays.find((x) => String(x.id) === s.display_id);
      return {
        id: s.id,
        name: s.name,
        isScreen: s.id.startsWith('screen:'),
        width: d ? Math.round(d.size.width * d.scaleFactor) : 0,
        height: d ? Math.round(d.size.height * d.scaleFactor) : 0,
        primary: !!d && d.id === primaryId,
        thumb: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : '',
      };
    });
  });

  ipcMain.handle('tav:select', (_e, id, withAudio) => {
    pendingSource = { id: String(id), audio: !!withAudio };
  });

  ipcMain.handle('tav:audio-start', (e, opts) => startAppAudio(e.sender, opts || {}));
  ipcMain.handle('tav:audio-stop', () => stopAppAudio());

  ipcMain.on('tav:awake', (_e, on) => {
    if (on && awakeBlocker === null) {
      awakeBlocker = powerSaveBlocker.start('prevent-display-sleep');
    } else if (!on && awakeBlocker !== null) {
      powerSaveBlocker.stop(awakeBlocker);
      awakeBlocker = null;
    }
  });
}

// ---------------- som app por app (ScreenPLAYAudio.exe) ----------------
function audioHelperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'ScreenPLAYAudio.exe')
    : path.join(__dirname, 'native', 'ScreenPLAYAudio.exe');
}

// Tela inteira: som do PC menos Discord e o próprio ScreenPLAY. Janela: só o som daquele app.
// Resolve { ok, mode } — se não der (Windows antigo etc.), a página usa o som do PC inteiro.
function startAppAudio(sender, { sourceId }) {
  stopAppAudio();
  return new Promise((resolve) => {
    const exe = audioHelperPath();
    if (process.platform !== 'win32' || !fs.existsSync(exe)) return resolve({ ok: false, error: 'missing helper' });
    const win = /^window:(\d+):/.exec(String(sourceId || ''));
    const args = win
      ? ['--include-hwnd', win[1]]
      : ['--exclude-pids', String(process.pid), '--exclude-names', AUDIO_EXCLUDE_NAMES.join(',')];
    const proc = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    audioProc = proc;

    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      done({ ok: false, error: 'timeout' });
      if (audioProc === proc) stopAppAudio();
    }, 3000);

    let errText = '';
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (text) => {
      errText += text;
      let nl;
      while ((nl = errText.indexOf('\n')) >= 0) {
        const line = errText.slice(0, nl).trim();
        errText = errText.slice(nl + 1);
        if (line === 'READY') done({ ok: true, mode: win ? 'app' : 'system' });
        else if (line.startsWith('ERROR')) done({ ok: false, error: line });
        else if (line) console.log('[audio]', line);
      }
    });

    // PCM 48 kHz/16 bits/estéreo: manda para a página em blocos de ~20 ms (múltiplos de 4 bytes).
    let pending = Buffer.alloc(0);
    proc.stdout.on('data', (chunk) => {
      if (audioProc !== proc || sender.isDestroyed()) return;
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const usable = pending.length - (pending.length % 4);
      if (usable >= 3840) {
        sender.send('tav:pcm', pending.subarray(0, usable));
        pending = pending.subarray(usable);
      }
    });

    proc.on('error', (err) => done({ ok: false, error: err.message }));
    proc.on('exit', (code) => {
      done({ ok: false, error: 'exit ' + code });
      if (audioProc === proc) {
        audioProc = null;
        if (!sender.isDestroyed()) sender.send('tav:audio-ended');
      }
    });
  });
}

function stopAppAudio() {
  if (!audioProc) return;
  const proc = audioProc;
  audioProc = null;
  try { proc.stdin.end(); } catch {}
  try { proc.kill(); } catch {}
}

// Responde ao getDisplayMedia da página com a tela/janela escolhida no seletor do app.
// 'loopback' é o áudio do sistema no Windows — nunca o microfone.
function registerDisplayMedia() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const sel = pendingSource;
    pendingSource = null;
    try {
      if (!sel) return callback({});
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
      });
      const source = sources.find((s) => s.id === sel.id);
      if (!source) return callback({});
      if (sel.audio && request.audioRequested) callback({ video: source, audio: 'loopback' });
      else callback({ video: source });
    } catch (err) {
      console.error('[display-media]', err);
      callback({});
    }
  });
}
