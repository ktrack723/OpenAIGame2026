import { ko } from './ko.js'
import { en } from './en.js'
import { ja } from './ja.js'
import { zhHans } from './zh-Hans.js'
import { zhHant } from './zh-Hant.js'

// ─── 말 ─────────────────────────────────────────────────────────
// 화면에 뜨는 모든 문장은 여기를 지난다. 코드에는 **키만** 남고, 문장은
// 언어 표에만 산다. 그래야 "이 문구를 다섯 군데서 조금씩 다르게 쓰고 있었다"가
// 생기지 않는다 — 키가 하나면 문장도 하나다.
//
// 원본은 한국어(ko)다. 다른 표에 키가 없으면 한국어로 떨어지고, 한국어에도
// 없으면 키 자체를 보여 준다 — 화면이 비는 것보다 키가 보이는 게 낫다.
// (개발 중에 오탈자 키를 바로 알아채라고 일부러 이렇게 뒀다.)

export const LANGS = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh-Hans', label: '简体中文' },
  { code: 'zh-Hant', label: '繁體中文' },
]

const TABLES = { ko, en, ja, 'zh-Hans': zhHans, 'zh-Hant': zhHant }
const STORE = 'planetpool.lang'

// 브라우저가 말하는 언어에서 우리가 가진 표 하나를 고른다.
// 중국어는 간체/번체가 지역으로 갈린다: TW·HK·MO만 번체로 본다.
function detect() {
  // 브라우저 밖(헤드리스 검증·계측 스크립트)에서도 import되므로 전역이 없어도
  // 굴러가야 한다. 여기서 던지면 게임 로직 전체가 같이 못 뜬다.
  try {
    const saved = globalThis.localStorage?.getItem(STORE)
    if (saved && TABLES[saved]) return saved
  } catch { /* 사생활 보호 모드 — 저장 못 해도 게임은 돌아야 한다 */ }
  const nav = globalThis.navigator
  if (!nav) return 'ko'
  for (const raw of nav.languages ?? [nav.language ?? 'ko']) {
    const l = String(raw).toLowerCase()
    if (l.startsWith('ko')) return 'ko'
    if (l.startsWith('ja')) return 'ja'
    if (l.startsWith('zh')) return /hant|tw|hk|mo/.test(l) ? 'zh-Hant' : 'zh-Hans'
    if (l.startsWith('en')) return 'en'
  }
  return 'ko'
}

let lang = detect()
const listeners = new Set()

export const getLang = () => lang
export const langLabel = () => LANGS.find(l => l.code === lang)?.label ?? lang

export function setLang(code) {
  if (!TABLES[code] || code === lang) return
  lang = code
  try { globalThis.localStorage?.setItem(STORE, code) } catch { /* 무시 */ }
  markHtml()
  for (const fn of listeners) fn(code)
}

// 언어가 바뀌면 알려 준다. 매 프레임 다시 그리는 것(HUD 숫자·문구)은 저절로
// 따라오지만, 한 번 만들고 마는 것(버튼 라벨·튜토리얼 카드)은 이걸 받아 고쳐야 한다.
export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }

// 값이 또 다른 문구일 수도 있다(msg()가 만든 {k,p}). 그때는 **지금** 번역한다 —
// 넣는 쪽에서 미리 문자열로 만들어 두면 그 조각만 옛 언어로 굳는다.
const fill = (s, p) => p
  ? s.replace(/\{(\w+)\}/g, (m, k) => {
    const v = p[k]
    if (v === undefined || v === null) return m
    return typeof v === 'object' && v.k ? t(v.k, v.p) : v
  })
  : s

export function t(key, params) {
  const s = TABLES[lang]?.[key] ?? ko[key]
  return s === undefined ? key : fill(s, params)
}

// 배열로 된 항목(같은 사건에 대한 여러 대사) — 그중 하나를 고르는 건 부르는 쪽 몫이다.
export function tList(key) {
  const v = TABLES[lang]?.[key] ?? ko[key]
  return Array.isArray(v) ? v : []
}

// ─── 나중에 번역할 문구 ─────────────────────────────────────────
// 게임 로직은 문장을 만들지 않는다. **무슨 일이 있었는지**만 남기고(키 + 값),
// 화면에 뜨는 순간에 번역한다. 그래서 판이 도는 중에 언어를 바꿔도 이미 떠 있던
// 메시지까지 같이 바뀐다 — 문자열로 굳혀 두면 그것만 옛 언어로 남는다.
export const msg = (k, p) => ({ k, p })
export const tx = (m) => (m == null ? '' : typeof m === 'string' ? m : t(m.k, m.p))

// 천체 이름 — 태양계 천체는 표에 있고(nameKey), 조르그가 보낸 것은 생성된
// 고유명이라(Zorg Krath-4b) 그대로 쓴다. 부르는 쪽은 구분할 필요가 없다.
export const nameOf = (b) => (b && b.nameKey ? t(b.nameKey) : (b && b.name) || '')

// <html lang="…"> — 브라우저의 줄바꿈·글꼴 선택이 이 값을 본다(CJK는 특히).
function markHtml() { try { globalThis.document.documentElement.lang = lang } catch { /* DOM 없음 */ } }
markHtml()
