import { readFileSync } from 'node:fs'

const nginxFiles = [
  readFileSync(new URL('../nginx.prod.conf', import.meta.url), 'utf8'),
  readFileSync(new URL('../../deploy/nginx.conf', import.meta.url), 'utf8'),
]
const hardening = readFileSync(new URL('../../backend/app/utils/http_hardening.py', import.meta.url), 'utf8')
const nginxPolicies = nginxFiles.map((nginx) => nginx.match(/add_header Content-Security-Policy "([^"]+)" always;/)?.[1])
const appBlock = hardening.match(/"Content-Security-Policy":\s*\(([\s\S]*?)\n\s*\),/)?.[1]
const appPolicy = appBlock?.match(/"([^"]*)"/g)?.map((value) => value.slice(1, -1)).join('')

if (nginxPolicies.some((policy) => !policy || policy !== appPolicy) || !appPolicy) {
  console.error('CSP mismatch between frontend/nginx.prod.conf and backend/app/utils/http_hardening.py')
  process.exit(1)
}
