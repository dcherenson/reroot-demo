import { cp, mkdir, rm } from 'node:fs/promises';

// Publish only the static application and its locally licensed assets.
await rm('_site', { recursive: true, force: true });
await mkdir('_site', { recursive: true });
for (const path of ['index.html', 'budget-planning.html', '.nojekyll', 'assets']) {
  await cp(path, `_site/${path}`, { recursive: true });
}
console.log('Static site ready in _site/');
