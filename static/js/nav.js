(() => {
  const btn = document.getElementById('navbtn');
  const panel = document.getElementById('navpanel');
  if (!btn || !panel) return;

  const close = () => {
    btn.setAttribute('aria-expanded', 'false');
    panel.classList.remove('probar__nav--open');
  };

  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    panel.classList.toggle('probar__nav--open', !open);
  });

  document.addEventListener('click', (e) => {
    if (!panel.classList.contains('probar__nav--open')) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
})();
