// Keep startup feedback independent of the renderer's module and image loads.
const overlay = document.getElementById('loading-overlay');

function offerReload(message) {
  if (overlay.hidden) return;
  const text = document.createElement('span');
  text.className = 'startup-message';
  text.textContent = message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'button button-quiet';
  retry.textContent = 'Reload demo';
  retry.addEventListener('click', () => window.location.reload());
  overlay.replaceChildren(text, retry);
}

const timeout = setTimeout(() => {
  offerReload('Startup is taking longer than expected. You can reload the demo to try again.');
}, 15_000);

const observer = new MutationObserver(() => {
  if (overlay.hidden) {
    clearTimeout(timeout);
    observer.disconnect();
  }
});
observer.observe(overlay, { attributes: true, attributeFilter: ['hidden'] });

import('./app.js').catch(error => {
  clearTimeout(timeout);
  observer.disconnect();
  console.error('Demo startup failed.', error);
  offerReload('The demo could not start. Reload to download its files and try again.');
});
