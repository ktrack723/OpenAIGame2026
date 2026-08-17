// 터미널 입출력 계층.
//
// TTY 면 방향키 메뉴 + 원시 키 입력, 파이프로 들어오면 줄 단위 입력으로 자동 전환한다.
// 후자가 없으면 스크립트로 한 판을 끝까지 돌려보는 테스트를 못 한다.

import readline from 'node:readline'

const useColor =
  !process.env.NO_COLOR && !process.argv.includes('--no-color') && process.stdout.isTTY !== false

const code = (n) => (useColor ? `\x1b[${n}m` : '')

export const C = {
  reset: code(0),
  bold: code(1),
  dim: code(2),
  italic: code(3),
  red: code(31),
  green: code(32),
  yellow: code(33),
  blue: code(34),
  magenta: code(35),
  cyan: code(36),
  white: code(37),
  gray: code(90),
  brightMagenta: code(95),
  brightCyan: code(96),
  brightYellow: code(93),
  brightGreen: code(92),
  brightRed: code(91),
}

export const WIDTH = 78

/** 한글·한자·전각은 두 칸을 먹는다. 이걸 안 세면 모든 상자가 틀어진다. */
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/

export function dw(str) {
  let n = 0
  for (const ch of String(str ?? '')) {
    if (ch === '\x1b') continue
    n += WIDE.test(ch) ? 2 : 1
  }
  return n
}

/** ANSI 코드를 뺀 표시 폭 */
export function visibleWidth(str) {
  return dw(String(str ?? '').replace(/\x1b\[[0-9;]*m/g, ''))
}

export function padEnd(str, width) {
  const pad = width - visibleWidth(str)
  return str + ' '.repeat(Math.max(0, pad))
}

export function padStart(str, width) {
  const pad = width - visibleWidth(str)
  return ' '.repeat(Math.max(0, pad)) + str
}

export function center(str, width) {
  const pad = width - visibleWidth(str)
  const left = Math.max(0, Math.floor(pad / 2))
  return ' '.repeat(left) + str + ' '.repeat(Math.max(0, pad - left))
}

export function write(s = '') {
  process.stdout.write(s)
}

export function line(s = '') {
  process.stdout.write(`${s}\n`)
}

export function clear() {
  if (process.stdout.isTTY) write('\x1b[2J\x1b[H')
  else write('\n')
}

/** 폭보다 긴 한 덩어리를 강제로 자른다(공백 없는 긴 한국어/URL 대비). */
function chop(word, width) {
  const parts = []
  let cur = ''
    for (const ch of word) {
    if (visibleWidth(cur) + dw(ch) > width && cur !== '') {
      parts.push(cur)
      cur = ch
    } else {
      cur += ch
    }
  }
  if (cur !== '') parts.push(cur)
  return parts
}

/** 표시 폭 기준 줄바꿈 */
export function wrap(text, width = WIDTH - 4) {
  const out = []
  for (const paragraph of String(text ?? '').split('\n')) {
    let cur = ''
    for (const token of paragraph.split(/(\s+)/)) {
      // 토큰 하나가 이미 폭보다 넓으면 쪼개야 한다. 안 그러면 상자를 뚫는다.
      const pieces = visibleWidth(token) > width ? chop(token, width) : [token]
      for (const word of pieces) {
        if (visibleWidth(cur + word) > width && cur.trim()) {
          out.push(cur.trimEnd())
          cur = word.trimStart()
        } else {
          cur += word
        }
      }
    }
    out.push(cur.trimEnd())
  }
  return out
}

export function rule(char = '─', width = WIDTH, color = C.gray) {
  line(color + char.repeat(width) + C.reset)
}

export function box(lines, { title = '', width = WIDTH, color = C.cyan } = {}) {
  const inner = width - 2
  const head = title
    ? `${color}┌─ ${C.bold}${title}${C.reset}${color} ${'─'.repeat(Math.max(0, inner - 3 - visibleWidth(title)))}┐${C.reset}`
    : `${color}┌${'─'.repeat(inner)}┐${C.reset}`
  line(head)
  for (const l of lines) {
    line(`${color}│${C.reset}${padEnd(` ${l}`, inner)}${color}│${C.reset}`)
  }
  line(`${color}└${'─'.repeat(inner)}┘${C.reset}`)
}

/** 게이지 바. 분위기/호감을 한눈에 보여주는 핵심 위젯. */
export function bar(label, value, max = 100, width = 28, color = C.brightMagenta) {
  const ratio = Math.max(0, Math.min(1, value / max))
  const filled = Math.round(ratio * width)
  const track = `${color}${'█'.repeat(filled)}${C.gray}${'░'.repeat(width - filled)}${C.reset}`
  return `${padEnd(label, 8)} ${track} ${padStart(String(Math.round(value)), 3)}`
}

export function deltaTag(n) {
  if (n > 0) return `${C.brightGreen}▲${n}${C.reset}`
  if (n < 0) return `${C.brightRed}▼${Math.abs(n)}${C.reset}`
  return `${C.gray}—${C.reset}`
}

// ─────────────────────────────────────────────────────────── 입력

const isTTY = () => Boolean(process.stdin.isTTY)

let pipedLines = null
let pipedIndex = 0

/** 파이프 입력을 한 번에 읽어 큐로 만든다(비대화형 실행용). */
async function ensurePiped() {
  if (pipedLines) return
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  pipedLines = Buffer.concat(chunks).toString('utf8').split('\n')
}

async function nextPipedLine() {
  await ensurePiped()
  if (pipedIndex >= pipedLines.length) {
    // 파이프 입력이 끝났다 = 세션 종료. 빈 문자열을 무한히 돌려주면
    // 메뉴가 기본 선택으로 영원히 반복해서 테스트가 멈추지 않는다.
    line(`\n${C.gray}(입력이 끝나 단말기를 종료합니다)${C.reset}`)
    process.exit(0)
  }
  return pipedLines[pipedIndex++]
}

export async function readLine(prompt = '') {
  if (!isTTY()) {
    const v = await nextPipedLine()
    line(`${prompt}${C.dim}${v}${C.reset}`)
    return v
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await new Promise((resolve) => rl.question(prompt, resolve))
  } finally {
    rl.close()
  }
}

/** 키 하나. 비대화형이면 한 줄을 읽어 첫 글자를 쓴다. */
export async function readKey() {
  if (!isTTY()) {
    const v = await nextPipedLine()
    return v.length ? v[0] : '\r'
  }
  return new Promise((resolve) => {
    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    stdin.setRawMode(true)
    stdin.resume()
    const onData = (buf) => {
      stdin.removeListener('data', onData)
      stdin.setRawMode(Boolean(wasRaw))
      stdin.pause()
      const s = buf.toString('utf8')
      if (s === '') {
        line(`\n${C.gray}중단합니다.${C.reset}`)
        process.exit(0)
      }
      resolve(s)
    }
    stdin.on('data', onData)
  })
}

export async function pause(msg = '계속하려면 아무 키나…') {
  line('')
  write(`${C.gray}${msg}${C.reset}`)
  await readKey()
  line('')
}

/**
 * 방향키 메뉴. TTY 가 아니면 번호 입력으로 떨어진다.
 * @param {{label:string, hint?:string, value:any}[]} items
 */
export async function menu(items, { title = '', footer = '' } = {}) {
  if (!isTTY()) {
    if (title) line(`${C.bold}${title}${C.reset}`)
    items.forEach((it, i) => line(`  ${i + 1}) ${it.label}${it.hint ? `  ${C.gray}${it.hint}${C.reset}` : ''}`))
    const raw = (await readLine('선택 번호> ')).trim()
    const idx = Number.parseInt(raw, 10) - 1
    return items[Number.isFinite(idx) && idx >= 0 && idx < items.length ? idx : 0].value
  }

  let cursor = 0
  const render = (first) => {
    if (!first) write(`\x1b[${items.length + (title ? 2 : 0) + (footer ? 1 : 0)}A`)
    if (title) {
      line(`${C.bold}${C.brightCyan}${title}${C.reset}`)
      line('')
    }
    items.forEach((it, i) => {
      const on = i === cursor
      const marker = on ? `${C.brightMagenta}▶${C.reset}` : ' '
      const label = on ? `${C.bold}${C.white}${it.label}${C.reset}` : `${C.gray}${it.label}${C.reset}`
      const hint = it.hint ? `  ${C.dim}${it.hint}${C.reset}` : ''
      line(`${marker} ${padEnd(label + hint, WIDTH - 3)}`)
    })
    if (footer) line(`${C.gray}${footer}${C.reset}`)
  }

  render(true)
  for (;;) {
    const key = await readKey()
    if (key === '[A' || key === 'k') cursor = (cursor - 1 + items.length) % items.length
    else if (key === '[B' || key === 'j') cursor = (cursor + 1) % items.length
    else if (key === '\r' || key === '\n' || key === ' ') return items[cursor].value
    else if (/^[1-9]$/.test(key)) {
      const i = Number(key) - 1
      if (i < items.length) return items[i].value
    } else if (key === 'q') {
      line(`\n${C.gray}종료합니다.${C.reset}`)
      process.exit(0)
    } else continue
    render(false)
  }
}

/** 여러 줄 자유 입력. 빈 줄로 끝낸다. 한 줄만 쓰고 엔터쳐도 된다. */
export async function readParagraph(prompt, { hint = '' } = {}) {
  line(`${C.brightCyan}${prompt}${C.reset}`)
  if (hint) line(`${C.gray}${hint}${C.reset}`)
  line(`${C.gray}(여러 줄 가능 · 빈 줄에서 엔터를 치면 끝)${C.reset}`)
  const parts = []
  for (;;) {
    const l = await readLine(`${C.magenta}│ ${C.reset}`)
    if (l.trim() === '') break
    parts.push(l)
    if (!isTTY() && parts.length > 40) break
  }
  return parts.join('\n')
}

let fastMode = process.argv.includes('--fast') || !process.stdout.isTTY

export function setFast(v) {
  fastMode = v
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 타자기 효과. --fast 이거나 파이프면 즉시 출력한다. */
export async function type(text, { delay = 12, prefix = '' } = {}) {
  const lines = wrap(text)
  for (const l of lines) {
    if (fastMode) {
      line(prefix + l)
      continue
    }
    write(prefix)
    for (const ch of l) {
      write(ch)
      await sleep(delay)
    }
    line('')
  }
}
