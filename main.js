const { app, BrowserWindow, Menu, desktopCapturer, ipcMain, powerSaveBlocker, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// Permite abrir duas cópias separadas no mesmo PC (útil para testar): TAV_PROFILE=b
if (process.env.TAV_PROFILE) {
  app.setPath('userData', path.join(app.getPath('temp'), 'screenplay-' + process.env.TAV_PROFILE));
}
app.setAppUserModelId('com.screenplay.app');

const ICON = path.join(__dirname, 'assets', 'icon.png');
const PRELOAD = path.join(__dirname, 'preload.js');
const CHECK_TIMEOUT = 15000;            // GitHub não respondeu: abre assim mesmo
const STALL_TIMEOUT = 30000;            // download parado: abre e termina em segundo plano
const RECHECK_EVERY = 30 * 60 * 1000;   // com o app aberto, procura de novo a cada 30 min

let splash = null;
let mainWin = null;
let splashState = { text: 'Iniciando…', progress: null, version: app.getVersion() };
let readyVersion = null;     // atualização baixada esperando reiniciar
let pendingSource = null;    // fonte escolhida no seletor, usada no próximo getDisplayMedia
let awakeBlocker = null;
let audioProc = null;        // ScreenPLAYAudio.exe (som app por app, sem o Discord)

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
  app.on('will-quit', stopAppAudio);
}

async function start() {
  Menu.setApplicationMenu(null);
  registerIpc();
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
    backgroundColor: '#0a0a0a',
    icon: ICON,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  lockDown(splash);
  splash.webContents.on('did-finish-load', sendSplash);
  splash.once('ready-to-show', () => splash.show());
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
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'ScreenPLAY',
    backgroundColor: '#0a0a0a',
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
    mainWin.show();
    if (splash && !splash.isDestroyed()) splash.close();
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
function registerIpc() {
  ipcMain.handle('tav:version', () => app.getVersion());

  ipcMain.on('tav:restart-update', () => {
    if (readyVersion) autoUpdater.quitAndInstall(true, true);
  });

  ipcMain.handle('tav:sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      isScreen: s.id.startsWith('screen:'),
      thumb: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : '',
    }));
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
