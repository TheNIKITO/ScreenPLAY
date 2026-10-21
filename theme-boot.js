// Tema do ScreenPLAY: as cores escolhidas em Configurações → Personalizar.
// Carregado no <head> do app e da tela de abertura, antes de desenhar, pra não piscar a cor padrão.
// O resto do app usa window.SP_THEME (lista de cores, temas prontos, aplicar/salvar).
(function () {
  'use strict';

  // [variável CSS, nome que aparece na tela de personalizar]
  const KEYS = [
    ['--bg', 'Fundo'],
    ['--panel', 'Painel lateral'],
    ['--panel-2', 'Caixas'],
    ['--panel-3', 'Destaques e avisos'],
    ['--line', 'Bordas'],
    ['--line-2', 'Bordas fortes'],
    ['--text', 'Texto'],
    ['--muted', 'Texto secundário'],
    ['--faint', 'Texto apagado'],
    ['--accent', 'Botão principal'],
    ['--on-accent', 'Texto do botão principal'],
    ['--live', 'AO VIVO'],
    ['--good', 'Conectado / ping bom'],
    ['--warn', 'Ping regular'],
    ['--bad', 'Ping ruim / erros'],
  ];

  const ALERTS = { '--live': '#ff4d5e', '--good': '#3ba55d', '--warn': '#f0b232', '--bad': '#ed4245' };
  const PRESETS = {
    mono: { name: 'Preto e branco', vars: {
      '--bg': '#0a0a0a', '--panel': '#121212', '--panel-2': '#1a1a1a', '--panel-3': '#232323', '--line': '#2a2a2a', '--line-2': '#3a3a3a',
      '--text': '#f2f2f2', '--muted': '#9a9a9a', '--faint': '#5c5c5c', '--accent': '#f2f2f2', '--on-accent': '#0a0a0a', ...ALERTS } },
    azul: { name: 'Azul meia-noite', vars: {
      '--bg': '#0a0f1e', '--panel': '#0f162b', '--panel-2': '#151e38', '--panel-3': '#1c2747', '--line': '#222c4d', '--line-2': '#33406b',
      '--text': '#edf1ff', '--muted': '#98a3c7', '--faint': '#5b668c', '--accent': '#5b8cff', '--on-accent': '#ffffff', ...ALERTS } },
    roxo: { name: 'Roxo', vars: {
      '--bg': '#0e0915', '--panel': '#150e20', '--panel-2': '#1d142c', '--panel-3': '#271b3b', '--line': '#2c2040', '--line-2': '#3f2f5c',
      '--text': '#f4eeff', '--muted': '#a899c4', '--faint': '#675a87', '--accent': '#9b6bff', '--on-accent': '#ffffff', ...ALERTS, '--live': '#ff4d7a' } },
    verde: { name: 'Verde', vars: {
      '--bg': '#07110c', '--panel': '#0b1912', '--panel-2': '#10231a', '--panel-3': '#172f23', '--line': '#1a3126', '--line-2': '#284a3a',
      '--text': '#eafff3', '--muted': '#8db6a1', '--faint': '#557566', '--accent': '#34d07a', '--on-accent': '#04140b', ...ALERTS, '--good': '#34d07a' } },
    vermelho: { name: 'Vermelho', vars: {
      '--bg': '#120909', '--panel': '#1a0d0d', '--panel-2': '#231212', '--panel-3': '#2e1818', '--line': '#331b1b', '--line-2': '#4d2828',
      '--text': '#fff0f0', '--muted': '#c79a9a', '--faint': '#875b5b', '--accent': '#ff4d5e', '--on-accent': '#ffffff', ...ALERTS, '--live': '#ff8a3d', '--bad': '#ff6b6b' } },
    claro: { name: 'Claro', vars: {
      '--bg': '#eef0f3', '--panel': '#ffffff', '--panel-2': '#f5f6f8', '--panel-3': '#e9ecf0', '--line': '#dfe3e8', '--line-2': '#c9cfd8',
      '--text': '#121418', '--muted': '#5c6370', '--faint': '#9aa1ad', '--accent': '#121418', '--on-accent': '#ffffff',
      '--live': '#e5394a', '--good': '#2e9e57', '--warn': '#c78a10', '--bad': '#d93b3e' } },
  };

  const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  function luminance(hex) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  // Aplica as cores (as que faltarem voltam ao padrão) e escolhe controles claros ou escuros.
  function apply(vars) {
    const root = document.documentElement;
    for (const [key] of KEYS) {
      if (vars && isHex(vars[key])) root.style.setProperty(key, vars[key]);
      else root.style.removeProperty(key);
    }
    const bg = vars && isHex(vars['--bg']) ? vars['--bg'] : PRESETS.mono.vars['--bg'];
    root.style.colorScheme = luminance(bg) > 0.4 ? 'light' : 'dark';
  }

  function load() {
    try {
      const theme = JSON.parse(localStorage.getItem('tav-theme') || 'null');
      return theme && theme.vars ? theme : null;
    } catch {
      return null;
    }
  }
  function save(theme) {
    try {
      if (theme) localStorage.setItem('tav-theme', JSON.stringify(theme));
      else localStorage.removeItem('tav-theme');
    } catch { /* sem armazenamento: o tema vale só até fechar */ }
  }

  const saved = load();
  if (saved) apply(saved.vars);
  window.SP_THEME = { KEYS, PRESETS, apply, load, save, isHex };
})();
