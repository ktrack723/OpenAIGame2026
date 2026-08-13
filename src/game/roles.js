import { CFG, nukeDv } from './config.js'
import { t } from '../i18n/index.js'

// ─── 행성 태그 — 여덟 ───────────────────────────────────────────
// 태그가 안 붙은 건 전부 **일반 행성**이다. 규칙이 없는 게 규칙이라
// 마음 놓고 큐볼로 쓰면 된다.
//
//   ☠ 조르그 요새 — 부숴야 할 표적. 체력 1이라 한 번만 제대로 처박으면 된다.
//   ✷ 초엘리트    — 5스테이지부터. 체력 3. 제 핵으로 중립 행성을 지구에 처박는다.
//   🔩 금속 행성   — 무겁다. 핵으로 미는 양이 절반으로 깎인다.
//   🪐 가스 행성   — 터진다. 핵을 맞으면 그 자리에서 유폭한다.
//   🧊 얼음 행성   — 가볍다. 질량이 절반이라 두 배로 밀린다(최고의 큐볼).
//   💥 불안정 행성 — 쪼개진다. 맞은 반대쪽으로 파편 일곱 갈래를 샷건처럼 뿌린다.
//   ☄ 혜성        — 지나간다. 카이퍼 벨트를 뚫고 들어와 성계를 가로지르고 나간다.
//                   벨트에 안 튕기는 유일한 천체이고, 나머지 규칙은 전부 같다.
//
// 태그는 **행성의 종류가 정한다**(아래 TAG_BY_TYPE). 금속 행성처럼 생긴 게
// 금속 행성이고 가스 행성처럼 생긴 게 터진다 — 보이는 것과 규칙이 어긋나지 않는다.
// 조르그 요새만 예외로, 종류와 무관하게 조르그가 무장시킨 천체다.
// 표에는 **키와 숫자만** 둔다. 문장(라벨·설명·조준 한 줄)은 언어 표에 있고,
// 여기서는 role.<키> · role.<키>.brief · role.<키>.aim 세 자리를 약속으로 쓴다.
// dvScale은 게임 수치라 언어와 무관하게 여기 남는다.
export const ROLES = {
  battery: { icon: '☠', color: 0xf43f5e, dvScale: 1 },
  // 초엘리트 조르그 행성 — 5스테이지부터. 광선도 증원도 없다. **당구를 친다.**
  siege: { icon: '✷', color: 0xff3b1f, dvScale: 1 },
  armor: { icon: '🔩', color: 0x94a3b8, dvScale: CFG.ARMOR_DV },
  volatile: { icon: '🪐', color: 0xfb923c, dvScale: 1 },
  light: { icon: '🧊', color: 0x8be9ff, dvScale: 1 },
  // 연두는 이 태그 하나뿐이다. 가스(주황)와 사건이 닮았으므로 색까지 닮으면
  // 화면에서 둘이 섞인다 — "원으로 민다"와 "부채꼴로 쏜다"는 다른 계획이다.
  unstable: { icon: '💥', color: 0xa3e635, dvScale: 1 },
  // 혜성 — 규칙은 **빼기 하나**뿐이다: 카이퍼 벨트가 안 튕긴다(game.bodyBounds).
  // 그래서 dvScale은 1이다. 밀리는 것도, 부서지는 것도, 광선에 녹는 것도 남과 같다.
  comet: { icon: '☄', color: 0x7dd3fc, dvScale: 1 },
}
// 태그 문장 — 부르는 쪽은 이 셋만 쓴다. 문장에 들어갈 **게임 수치**는 여기서
// 채운다: 표에 숫자를 박아 두면 config를 고친 날 문장만 옛날 값으로 남는다.
const PCT = {
  pct: (CFG.ARMOR_DV * 100).toFixed(0),
  n: CFG.UNSTABLE_SHARDS,
  deg: (CFG.UNSTABLE_CONE * 2 * 180 / Math.PI).toFixed(0),
}
export const roleLabel = (k) => t(`role.${k}`)
export const roleBrief = (k) => t(`role.${k}.brief`, PCT)
export const roleAim = (k) => t(`role.${k}.aim`, PCT)

// 종류 → 태그. 여기 없는 종류는 전부 일반 행성이다.
export const TAG_BY_TYPE = { iron: 'armor', gas: 'volatile', ice: 'light', shard: 'unstable', comet: 'comet' }

// 종류별 질량 배율 — 얼음은 **가볍다**. 이게 "얼음 행성"의 메카닉 전부다:
// 같은 크기라도 질량이 절반이라 핵 한 방에 두 배로 밀린다(Δv = 임펄스/질량).
// 이 배율이 곧 '얼음' 태그의 내용이다 — 태그가 말로만 있는 게 아니라
// 질량·Δv·무게등급 숫자에 그대로 드러난다.
export const TYPE_MU_MUL = { ice: 0.55 }

// 무게 등급 — 모든 행성이 갖는 성질. "이 공을 밀 수 있는가"를 한 단어로 답한다.
// 기준은 최대 작약(12Mt)으로 얻는 Δv다. 궤도 속도가 13~25 GU/s 대역이므로
// 그와 견줘 읽으면 된다: 60이면 총알처럼 날아가고, 5면 꿈쩍도 안 한다.
export function massClass(b) {
  const dv = nukeDv(CFG.YIELD_MAX, b.mu) * dvScaleOf(b)
  const key = dv >= 60 ? 'feather' : dv >= 25 ? 'light' : dv >= 10 ? 'medium' : 'heavy'
  const color = { feather: '#7dd3fc', light: '#a5f3fc', medium: '#cbd5e1', heavy: '#f5b544' }[key]
  return { key, color, get label() { return t(`mass.${key}`) }, get hint() { return t(`mass.${key}.hint`) } }
}
// 이 천체에 붙은 주 태그의 정의(없으면 null). 조르그 요새가 최우선 —
// 금속으로 만든 요새라도 플레이어에게 먼저 읽혀야 하는 건 "표적"이라
// 요새는 role이 battery이고 금속 성질은 mods로 겹쳐 얹는다.
export const roleOf = (b) => (b && b.role) ? ROLES[b.role] : null

// 요새 위에 금속(장갑) 성질을 겹쳐 얹을 수 있다. 주 태그는 role, 덧붙은 건 mods.
// "이 공에 이 성질이 있는가"는 언제나 이 함수로 묻는다.
export const hasRole = (b, r) => !!b && (b.role === r || (!!b.mods && b.mods.includes(r)))
export const modsOf = (b) => (b && b.mods) ? b.mods : []

// 이 공에 실제로 먹히는 Δv — 금속은 절반으로 깎인다.
// 겹쳐 얹은 성질(mods)까지 보고 가장 강한 감쇠를 적용한다.
// 예측선과 실제 임펄스가 반드시 같은 함수를 써야 조준이 거짓말을 안 한다.
function dvScaleOf(b) {
  let s = ROLES[b.role]?.dvScale ?? 1
  for (const m of modsOf(b)) s = Math.min(s, ROLES[m]?.dvScale ?? 1)
  return s
}
export const effDv = (b, yld) => nukeDv(yld, b.mu) * dvScaleOf(b)

// 가스 행성 유폭 반경 — 작약량과 무관하게 그 행성의 크기로 정해진다.
// 상수라서 조준 전에 화면에 원으로 그려 줄 수 있다(= 계획이 가능하다).
export const volatileRadius = (b) => Math.max(CFG.VOLATILE_MIN_R, b.radius * CFG.VOLATILE_R)

// ─── 샷건의 제원 ───────────────────────────────────────────────
// 갈래 수·부채꼴 반각·사거리. 셋 다 **행성 크기와 무관한 상수**라 유폭 반경과
// 같은 이유로 조준 전에 그려 줄 수 있다: 어느 살을 칠지 고르는 순간 총구가
// 어디를 향하는지가 이미 정해져 있어야 계획이 성립한다.
//
// 사거리는 "TTL 동안 날아가는 거리"가 아니라 **그리는 길이**다. 파편은 태양
// 탈출속도의 다섯 배로 나가므로 그 안에서는 궤적이 사실상 직선이고, 그 너머는
// 중력이 눈에 띄게 휘기 시작해 부채꼴이 거짓말이 된다. 그래서 거기서 자른다.
export const SHARD_N = CFG.UNSTABLE_SHARDS
export const shardCone = () => CFG.UNSTABLE_CONE
export const shardReach = () => CFG.UNSTABLE_SPEED * 3
