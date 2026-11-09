// Illustrative step player: never invokes Chrome, permissions or notifications.
const guide = document.querySelector('.install-guide');
if (guide) {
  const buttons = [...guide.querySelectorAll('[data-install-step]')];
  const panels = [...guide.querySelectorAll('.install-steps > li')];
  const play = guide.querySelector('.install-play');
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let step = 0;
  let wantsPlay = !preference.matches;
  let visible = false;
  let timer;

  function render() {
    guide.dataset.step = String(step);
    buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === step)));
    panels.forEach((panel, index) => { panel.hidden = index !== step; });
  }
  function sync() {
    clearInterval(timer);
    const running = wantsPlay && visible && !document.hidden;
    guide.dataset.running = String(running);
    guide.dataset.wantsPlay = String(wantsPlay);
    play.setAttribute('aria-label', wantsPlay ? 'Приостановить шаги установки' : 'Воспроизвести шаги установки');
    if (running) timer = setInterval(() => { step = (step + 1) % panels.length; render(); }, 3000);
  }
  buttons.forEach((button, index) => button.addEventListener('click', () => {
    wantsPlay = false;
    step = index;
    render();
    sync();
  }));
  play.addEventListener('click', () => { wantsPlay = !wantsPlay; sync(); });
  // Keep the current instructions in place while the user reads or opens details.
  panels.forEach(panel => panel.addEventListener('focusin', () => { wantsPlay = false; sync(); }));
  guide.querySelectorAll('details').forEach(details => details.addEventListener('toggle', () => {
    if (details.open) { wantsPlay = false; sync(); }
  }));
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && entry.intersectionRatio >= .15;
    sync();
  }, { threshold: [0, .15] });
  observer.observe(guide.querySelector('.install-player'));
  preference.addEventListener('change', () => { if (preference.matches) wantsPlay = false; sync(); });
  document.addEventListener('visibilitychange', sync);
  // Stop before bfcache suspension; recompute visibility when the page returns.
  window.addEventListener('pagehide', () => { clearInterval(timer); guide.dataset.running = 'false'; });
  window.addEventListener('pageshow', sync);
  guide.classList.add('is-enhanced');
  guide.querySelector('.install-controls').hidden = false;
  render();
  sync();
}
