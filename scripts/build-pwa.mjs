import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('dist')
async function files(directory) {
  const items = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(items.map(item => item.isDirectory() ? files(path.join(directory, item.name))
    : [path.join(directory, item.name)]))).flat()
}
const assets = (await files(root)).filter(file => !file.endsWith('sw.js'))
assets.sort()
const html = await readFile(path.join(root, 'index.html'), 'utf8')
const version = html.match(/name="wortzeit-build" content="([a-f0-9]+)"/)?.[1]
if (!version) throw new Error('Missing build identity; refusing to generate an unversioned offline shell')
const urls = assets.map(file => `./${path.relative(root, file).replaceAll('\\', '/')}`)
const worker = `const CACHE = 'wortzeit-shell-${version}';
const ASSETS = ${JSON.stringify(urls)};
const urls = ASSETS.map(asset => new URL(asset, self.registration.scope).href);
self.addEventListener('install', event => event.waitUntil((async () => {
  try { const cache = await caches.open(CACHE); await cache.addAll(urls); await self.skipWaiting(); }
  catch (error) { await caches.delete(CACHE); throw error; }
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  // Older open tabs may still request their own immutable assets.
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (event.request.mode === 'navigate') {
      try { return await fetch(event.request); }
      catch { return await cache.match(new URL('./index.html', self.registration.scope).href) || Response.error(); }
    }
    return await cache.match(event.request) || await caches.match(event.request) || fetch(event.request);
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'VERIFY_CACHE') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const present = await Promise.all(urls.map(url => cache.match(url)));
    event.ports[0]?.postMessage({ ready: present.every(response => response?.ok), version: CACHE });
  })());
});
`
await writeFile(path.join(root, 'sw.js'), worker)
console.log(`PWA: ${urls.length} required assets, cache ${version}`)
