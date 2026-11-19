import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const envFiles = ['.env', '.env.local', '.env.production', '.env.production.local']
let fromFiles
for (const file of envFiles) {
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) continue
  const line = readFileSync(path, 'utf8').split(/\r?\n/).find((entry) => /^\s*(?:export\s+)?VITE_API_BASE_URL\s*=/.test(entry) && !/^\s*#/.test(entry))
  if (line) {
    const value = line.slice(line.indexOf('=') + 1).trim()
    fromFiles = value.startsWith('"') || value.startsWith("'")
      ? value.replace(/^(['"])(.*)\1$/, '$2')
      : value.replace(/\s+#.*$/, '').trim()
  }
}
const raw = String(process.env.VITE_API_BASE_URL ?? fromFiles ?? '').trim()

if (!raw) process.exit(0)

const fail = () => {
  console.error('Invalid VITE_API_BASE_URL: use an HTTPS URL or a same-origin relative path.')
  process.exit(1)
}

if (raw.startsWith('//') || raw.includes('\\')) fail()
if (raw.startsWith('/')) {
  if (/^\/{2,}/.test(raw) || /[\s\u0000-\u001f]/.test(raw)) fail()
  process.exit(0)
}

try {
  const parsed = new URL(raw)
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) fail()
} catch {
  fail()
}
