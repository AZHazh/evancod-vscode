const { buildSync } = require('esbuild')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const outfile = path.resolve(__dirname, '../../.tmp/webview-tests/conversation.test.cjs')
buildSync({
  entryPoints: [path.join(__dirname, 'conversation.test.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  tsconfig: path.resolve(__dirname, '../tsconfig.json'),
  logLevel: 'warning',
})
const result = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit' })
process.exit(result.status ?? 1)
