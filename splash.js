'use strict';

// Mostra o que o app está fazendo (procurando/baixando/instalando atualização).
window.tav.onSplash((state) => {
  document.getElementById('status').textContent = state.text;
  const bar = document.getElementById('bar');
  const fill = document.getElementById('fill');
  const known = typeof state.progress === 'number';
  bar.classList.toggle('indeterminate', !known);
  fill.style.width = known ? Math.round(Math.min(1, Math.max(0, state.progress)) * 100) + '%' : '';
  if (state.version) document.getElementById('ver').textContent = 'v' + state.version;
});
