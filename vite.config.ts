import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const hash = createHash('sha256')
function hashTree(directory: string) {
  for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(directory, item.name)
    if (item.isDirectory()) hashTree(file)
    else { hash.update(file); hash.update(readFileSync(file)) }
  }
}
hashTree('src')
hashTree('public')
hashTree('scripts')
hash.update(readFileSync('package.json'))
hash.update(readFileSync('package-lock.json'))
hash.update(readFileSync('index.html'))
hash.update(readFileSync('vite.config.ts'))
const buildId = hash.digest('hex').slice(0, 16)

export default defineConfig({
  define: { 'import.meta.env.VITE_WORTZEIT_BUILD_ID': JSON.stringify(buildId) },
  plugins: [react(), {
    name: 'wortzeit-shell-identity',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'wortzeit-build', content: buildId }, injectTo: 'head' }],
  }],
})
