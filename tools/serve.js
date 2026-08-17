#!/usr/bin/env node
// 정적 파일 서버. GitHub Pages 와 같은 조건(빌드 없음, 파일 그대로)에서 확인하기 위한 것.
//   node tools/serve.js [포트]

import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve(process.argv[2] === '--root' ? process.argv[3] : '.')
const PORT = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? process.env.PORT ?? 4173)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    let path = decodeURIComponent(url.pathname)
    if (path.endsWith('/')) path += 'index.html'
    // 루트 밖으로 나가지 못하게 막는다
    const full = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''))
    if (!full.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden')
      return
    }
    const info = await stat(full)
    if (info.isDirectory()) {
      res.writeHead(302, { location: `${path}/` }).end()
      return
    }
    const body = await readFile(full)
    res.writeHead(200, {
      'content-type': TYPES[extname(full)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
  }
})

server.on('error', (err) => {
  console.error(`서버를 열지 못했습니다: ${err.message}`)
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${ROOT} → http://127.0.0.1:${PORT}/`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500)
  })
}
