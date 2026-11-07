// Artifact/worker simulation proof; this does not substitute for a browser offline test.
import assert from 'node:assert/strict'
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import path from 'node:path'

const root = path.resolve('dist'), origin = 'https://wortzeit.test/'
const html = await readFile(path.join(root, 'index.html'), 'utf8')
const buildId = html.match(/name="wortzeit-build" content="([a-f0-9]+)"/)?.[1]
assert.ok(buildId)
assert.ok(html.includes('lang="fa" dir="rtl"'))
const workerSource = await readFile(path.join(root, 'sw.js'), 'utf8')
const assets = JSON.parse(workerSource.match(/const ASSETS = (\[[^;]+\]);/)[1])
assert.ok(assets.includes('./index.html') && assets.includes('./manifest.webmanifest'))
const responseMap = new Map()
for (const asset of assets) {
  const data = await readFile(path.join(root, asset))
  responseMap.set(new URL(asset, origin).href, new Response(data, { status: 200 }))
}
const js = (await readdir(path.join(root, 'assets'))).find(file => file.endsWith('.js'))
const bundle = await readFile(path.join(root, 'assets', js), 'utf8')
assert.ok(bundle.includes(buildId), 'Running code and worker need the same build identity')
assert.ok(!/import\.meta\.env\./.test(bundle), 'No unresolved runtime build constants')
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'))
for (const icon of manifest.icons) {
  const bytes = await readFile(path.join(root, icon.src))
  assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes)
}

function environment(failInstall = false) {
  const handlers = {}, stores = new Map()
  const storage = {
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map())
      const entries = stores.get(name)
      return {
        addAll: async urls => {
          for (const [index, url] of urls.entries()) {
            if (failInstall && index === 1) throw new Error('Incomplete download')
            entries.set(url, responseMap.get(url).clone())
          }
        },
        match: async request => entries.get(typeof request === 'string' ? request : request.url)?.clone(),
      }
    },
    match: async request => { for (const store of stores.values()) { const value = store.get(request.url); if (value) return value.clone() } },
    delete: async name => stores.delete(name),
  }
  const self = { registration: { scope: origin }, location: { origin: new URL(origin).origin },
    addEventListener: (name, handler) => { handlers[name] = handler },
    skipWaiting: async () => {}, clients: { claim: async () => {} },
  }
  runInContext(workerSource, createContext({ self, caches: storage, URL, Response, fetch: async () => { throw new Error('offline') } }))
  return { handlers, stores }
}
const complete = environment()
let installation
complete.handlers.install({ waitUntil: promise => { installation = promise } })
await installation
async function readiness(env) {
  let result, pending
  env.handlers.message({ data: { type: 'VERIFY_CACHE' }, ports: [{ postMessage: value => { result = value } }], waitUntil: value => { pending = value } })
  await pending
  return result
}
assert.equal((await readiness(complete)).ready, true)
assert.equal((await readiness(complete)).version, `wortzeit-shell-${buildId}`)
let navigation
complete.handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: origin }, respondWith: value => { navigation = value } })
assert.ok((await (await navigation).text()).includes('Wortzeit'))
const store = [...complete.stores.values()][0]
store.delete(new URL(assets[0], origin).href)
assert.equal((await readiness(complete)).ready, false)
const failed = environment(true)
failed.handlers.install({ waitUntil: promise => { installation = promise } })
await assert.rejects(installation, /Incomplete download/)
assert.equal(failed.stores.size, 0, 'Failed install removes its incomplete cache')
await mkdir('test-results', { recursive: true })
const report = { at: new Date().toISOString(), buildId, assets: assets.length,
  checks: ['all required files exist', 'matching HTML/code/worker identity', 'PNG icon dimensions', 'complete cache verified', 'missing asset rejected', 'failed install removed', 'offline navigation fallback simulated'],
  limit: 'Node worker simulation and artifact checks; not an actual browser or mobile acceptance test' }
await writeFile('test-results/dist-report.json', JSON.stringify(report, null, 2))
console.log(`PASS ${report.checks.length} artifact/worker checks; ${assets.length} assets; build ${buildId}`)
