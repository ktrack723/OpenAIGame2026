// ─── 패배 일러스트 ──────────────────────────────────────────────
// 승리 화면(Victory.js)은 환호하는 관제실을 그린다. 패배는 **같은 방**을
// 그린다 — 불이 꺼지고, 콘솔이 죽고, 창밖의 지구가 없다. 두 그림이 같은
// 구도라야 "이겼다"와 "졌다"가 같은 사건의 두 결말로 읽힌다.
//
// 자산 0개(인라인 SVG). 실패 사유마다 창밖 풍경만 갈린다:
//   EARTH_LOST  — 쪼개진 지구. 두 조각이 서서히 벌어지고 파편이 흩어진다.
//   EARTH_LASER — 같은 지구에 관통 자국. 붉은 광선이 아직 창을 가로지른다.
//   TIME_UP     — 창을 가득 채운 조르그 모성. 눈이 이쪽을 보고 있다.
//
// ※ SVG에서 CSS transform 은 transform 속성을 덮어쓴다. 위치용 <g>와
//   애니메이션용 <g>를 반드시 분리한다(Victory.js에서 같은 사고를 냈다).

const C = { rd: '#ff5c6a', zorg: '#e879f9' }

// 고개를 숙인 관제실 실루엣 — 승리 그림의 환호하는 사람과 같은 자리, 같은 크기
const mourner = (x, cls, coat, skin, bow) => `
<g transform="translate(${x},0)"><g class="${cls}">
  <path d="M-16 62 q0 -34 16 -34 q16 0 16 34 z" fill="${coat}"/>
  <circle cx="${bow * 3}" cy="${18 + bow}" r="11" fill="${skin}"/>
  <path d="M-13 36 l-9 14" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
  <path d="M13 36 l9 14" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
  <rect x="-9" y="40" width="18" height="3" rx="1.5" fill="#0b0406" opacity=".5"/>
</g></g>`

// 창밖 ① 쪼개진 지구 — 두 조각이 벌어지고 그 사이로 불빛이 샌다
const brokenEarth = (cx, cy, r) => `
<g class="dsplit">
  <path d="M${cx} ${cy - r} a${r} ${r} 0 0 0 0 ${r * 2} z" fill="#2b4f7a"/>
  <path d="M${cx - r * 0.5} ${cy - r * 0.55} a${r * 0.5} ${r * 0.5} 0 0 1 ${r * 0.4} ${r * 0.5}"
        fill="none" stroke="#4b7fb5" stroke-width="2" opacity=".7"/>
</g>
<g class="dsplit b">
  <path d="M${cx} ${cy - r} a${r} ${r} 0 0 1 0 ${r * 2} z" fill="#24456b"/>
</g>
<g class="dglow"><ellipse cx="${cx}" cy="${cy}" rx="${r * 0.35}" ry="${r}" fill="#ff8a3c" opacity=".75"/></g>
${Array.from({ length: 26 }, (_, i) => {
    const a = i * 1.37, d = r * (1.25 + (i % 6) * 0.38)
    const x = cx + Math.cos(a) * d * 1.7, y = cy + Math.sin(a) * d * 0.9
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1 + (i % 3) * 0.9).toFixed(1)}"
      fill="${i % 4 ? '#7d9ab8' : '#ff9a4d'}" opacity="${(0.5 + (i % 3) * 0.2).toFixed(2)}"/>`
  }).join('')}`

// 창밖 ② 조르그 모성 — 창을 가득 채운 검보라 원반과 눈 하나
const mothership = `
<g transform="translate(300,52)">
  <circle r="86" fill="#1a0620"/>
  <circle r="86" fill="none" stroke="${C.zorg}" stroke-width="2" opacity=".45"/>
  <circle r="62" fill="none" stroke="#7e22ce" stroke-width="10" opacity=".35"/>
  ${Array.from({ length: 8 }, (_, i) => {
    const a = i * Math.PI / 4
    return `<rect x="${(Math.cos(a) * 70 - 5).toFixed(1)}" y="${(Math.sin(a) * 70 - 5).toFixed(1)}"
      width="10" height="10" fill="${C.zorg}" opacity=".5"/>`
  }).join('')}
  <g class="deye"><ellipse rx="30" ry="22" fill="#2b0a33"/>
    <ellipse rx="13" ry="19" fill="${C.zorg}"/>
    <ellipse rx="5" ry="12" fill="#faf5ff"/></g>
</g>`

const WINDOW = {
  TIME_UP: mothership,
  EARTH_LASER: `${brokenEarth(262, 60, 36)}
    <g class="dbeam"><path d="M460 4 L120 104" stroke="${C.rd}" stroke-width="8" opacity=".75"/>
      <path d="M460 4 L120 104" stroke="#fff" stroke-width="2" opacity=".9"/></g>`,
  EARTH_LOST: brokenEarth(262, 60, 38),
}

// 사유별 한 줄 — 제목 아래에 붙는 짧은 부제. 길게 설명하지 않는다.
const TAG = {
  TIME_UP: '조르그 모성 · 성계 접수',
  EARTH_LASER: '지구 · 관통',
  EARTH_LOST: '지구 · 상실',
}

export const defeatTag = (reason) => TAG[reason] ?? '작전 종료'

export function defeatArt(reason) {
  const view = WINDOW[reason] ?? WINDOW.EARTH_LOST
  const doom = reason === 'TIME_UP'
  return `
<svg viewBox="0 0 460 210" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <rect x="0" y="0" width="460" height="126" fill="#040609"/>
  ${Array.from({ length: 40 }, (_, i) => {
    const x = (i * 97) % 460, y = (i * 53) % 120
    return `<circle cx="${x}" cy="${y}" r=".9" fill="#8fa6bb" opacity="${(0.2 + (i % 4) * 0.15).toFixed(2)}"/>`
  }).join('')}
  <!-- 멀어지는 태양 — 관제실이 어디에 떠 있는지 한 점으로만 알려 준다 -->
  <circle cx="66" cy="34" r="15" fill="#6b5320" opacity=".75"/>
  <circle cx="66" cy="34" r="26" fill="none" stroke="#6b5320" stroke-width="1.5" opacity=".3"/>
  ${view}
  <!-- 창틀 -->
  <rect x="0" y="120" width="460" height="8" fill="${doom ? '#3a1240' : '#3a1216'}"/>
  <rect x="0" y="126" width="460" height="84" fill="#0a0608"/>
  <!-- 죽은 콘솔 — 승리 그림에서는 여기가 켜져 있다 -->
  <rect x="16" y="176" width="428" height="10" rx="3" fill="#241016"/>
  ${Array.from({ length: 9 }, (_, i) =>
    `<rect x="${30 + i * 47}" y="179" width="16" height="4" rx="2"
       fill="${i === 3 ? C.rd : '#3a1c22'}" opacity="${i === 3 ? 1 : 0.7}"/>`).join('')}
  <g transform="translate(0,120)">
    ${mourner(110, 'dsci a', '#8a97a4', '#c2a084', 3)}
    ${mourner(196, 'dsci b', '#7e8b98', '#a0765a', 2)}
    ${mourner(282, 'dsci c', '#909dab', '#6f4b36', 4)}
  </g>
  <!-- 비상등 — 방 전체를 붉게(모성이면 자홍) 훑는다 -->
  <g class="dalarm"><rect x="0" y="126" width="460" height="84"
     fill="${doom ? '#a21caf' : '#7f1d2b'}" opacity=".18"/></g>
</svg>`
}
