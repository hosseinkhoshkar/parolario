// Same Vite/Rollup build, with in-process TypeScript conversion for restricted hosts.
import { build } from 'vite'
import ts from 'typescript'
import config from '../vite.config.ts'
import { createHash } from 'node:crypto'

const buildId = createHash('sha256').update(`${config.define['import.meta.env.VITE_WORTZEIT_BUILD_ID']}:portable`).digest('hex').slice(0, 16)

await build({
  ...config,
  configFile: false,
  define: {},
  esbuild: false,
  resolve: { preserveSymlinks: true },
  plugins: [{
    name: 'wortzeit-in-process-typescript',
    enforce: 'pre',
    transform(source, id) {
      if (!/\.[cm]?[jt]sx?$/.test(id)) return null
      source = source.replaceAll('process.env.NODE_ENV', '"production"')
        .replaceAll('import.meta.env.PROD', 'true')
        .replaceAll('import.meta.env.BASE_URL', '"/"')
        .replaceAll('import.meta.env.VITE_WORTZEIT_BUILD_ID', JSON.stringify(buildId))
      if (!/\.[cm]?tsx?$/.test(id) || id.includes('node_modules')) return { code: source, map: null }
      const result = ts.transpileModule(source, { fileName: id, compilerOptions: {
        target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX, sourceMap: true,
      } })
      return { code: result.outputText, map: result.sourceMapText }
    },
  }, {
    name: 'wortzeit-portable-shell-identity',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'wortzeit-build', content: buildId }, injectTo: 'head' }],
  }],
  build: { minify: false, cssMinify: false, target: false },
})
