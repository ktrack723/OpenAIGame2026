// 외모 텍스트 → 3D 특징 명세.
//
// 입력은 두 갈래다:
//   1) 의뢰인 서류철의 고정 외모 태그 ("큰 키, 구부정한 어깨, 항상 후드티")
//   2) 플레이어가 상담실에서 직접 적은 스타일링 ("가죽 재킷, 별자리 목걸이")
//
// 둘을 합쳐 하나의 명세로 만들고, character.js 가 그걸 그대로 조립한다.
// 플레이어가 글자를 고치면 명세가 바뀌고 모델이 즉시 다시 세워진다.
//
// 순수 함수라서 브라우저 없이도 테스트된다.

const has = (hay, words) => words.some((w) => hay.includes(w))

/** 키워드 → 색. 먼저 매칭된 것이 이긴다. */
const COLOR_WORDS = [
  [['검정', '블랙', '까만', '흑', 'black'], '#1b1b20'],
  [['하양', '흰', '화이트', '백', 'white'], '#f2f2f5'],
  [['빨강', '레드', '빨간', '붉은', 'red'], '#c8324a'],
  [['파랑', '블루', '파란', '남색', '네이비', 'blue', 'navy'], '#2a4a9c'],
  [['초록', '그린', '녹색', 'green'], '#2f8f5b'],
  [['노랑', '옐로', '노란', 'yellow'], '#d9b431'],
  [['분홍', '핑크', 'pink'], '#e46ba8'],
  [['보라', '퍼플', '자주', 'purple'], '#7a4bc4'],
  [['주황', '오렌지', 'orange'], '#e07a30'],
  [['회색', '그레이', '쥐색', 'gray', 'grey'], '#7a7a85'],
  [['갈색', '브라운', '밤색', 'brown'], '#6b4a32'],
  [['베이지', '크림', '아이보리', 'beige'], '#d9c9a8'],
  [['은색', '실버', '은장', 'silver'], '#c9ccd4'],
  [['금색', '골드', '금장', 'gold'], '#d4a537'],
  [['형광', '네온', 'neon'], '#39ff9e'],
]

function colorFrom(text, fallback) {
  for (const [words, hex] of COLOR_WORDS) if (has(text, words)) return hex
  return fallback
}

/**
 * 명사에 가장 가까운 색 단어를 고른다 ("분홍 머리, 검정 재킷" → 머리는 분홍, 재킷은 검정).
 * 창 안에 색이 두 개 이상이면 목록 순서가 아니라 거리로 정해야 한다 —
 * 그렇지 않으면 문장에 먼저 등장한 색이 전부를 덮어쓴다.
 */
const BEFORE = 12 // 색이 명사 앞에 올 때 허용 거리 ("분홍 머리")
const AFTER = 6 // 뒤에 올 때 ("머리는 분홍")

function colorNear(text, nouns, fallback) {
  let best = null
  let bestDist = Infinity

  for (const noun of nouns) {
    let from = 0
    for (;;) {
      const at = text.indexOf(noun, from)
      if (at === -1) break
      for (const [words, hex] of COLOR_WORDS) {
        for (const w of words) {
          let scan = 0
          for (;;) {
            const ca = text.indexOf(w, scan)
            if (ca === -1) break
            const before = ca < at
            const dist = before ? at - (ca + w.length) : ca - (at + noun.length)
            const limit = before ? BEFORE : AFTER
            if (dist >= 0 && dist <= limit && dist < bestDist) {
              bestDist = dist
              best = hex
            }
            scan = ca + w.length
          }
        }
      }
      from = at + noun.length
    }
  }
  return best ?? fallback
}

export const HAIR_STYLES = ['short', 'messy', 'long', 'ponytail', 'bun', 'buzz', 'bob']
export const OUTFITS = ['tee', 'hoodie', 'shirt', 'jacket', 'suit', 'dress', 'knit', 'tank']

/**
 * @param {object} input
 * @param {string[]} [input.appearanceTags] 서류철 고정 외모
 * @param {string} [input.styling] 플레이어가 적은 스타일링
 * @param {string} [input.personality] 성격 태그 (자세에 약하게 반영)
 * @param {'client'|'target'} [input.role]
 * @param {string} [input.seedName] 같은 이름이면 같은 기본값이 나오게
 */
export function parseAppearance(input = {}) {
  const parts = [
    ...(input.appearanceTags ?? []),
    input.styling ?? '',
    ...(input.personality ?? []),
  ]
  const text = parts.join(' , ').toLowerCase()
  const styling = String(input.styling ?? '').toLowerCase()

  // 이름으로 고정 시드 — 태그가 없어도 캐릭터마다 다르게 보인다
  let h = 2166136261
  for (const ch of String(input.seedName ?? 'x')) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  const rand = (n) => ((h >>> (n * 3)) & 255) / 255

  // ── 체형
  let height = 1
  if (has(text, ['큰 키', '장신', '키가 크', '키 큰', 'tall', '슈퍼 톨', 'super tall'])) height = 1.12
  if (has(text, ['작은 키', '단신', '키가 작', '작은키', 'short', '자그마'])) height = 0.9

  let build = 0.42 + rand(0) * 0.12
  if (has(text, ['넓은 어깨', '떡대', '근육', '건장', '탄탄', '우람', 'gigachad', '기가차드'])) build = 0.85
  if (has(text, ['마른', '호리호리', '왜소', '가녀린', '슬림', 'slim'])) build = 0.2

  let posture = 0.05
  if (has(text, ['구부정', '굽은', '움츠', '숙인'])) posture = 0.55
  if (has(text, ['꼿꼿', '반듯', '당당', '자신감', '대담'])) posture = 0
  if (has(text, ['소심', '자기 비하', '자존감 낮', '눈치'])) posture = Math.max(posture, 0.35)

  // ── 머리
  let hairStyle = input.role === 'target' ? 'bob' : 'short'
  if (has(text, ['부스스', '헝클', '떡진', 'messy'])) hairStyle = 'messy'
  if (has(text, ['긴 머리', '장발', '긴머리', 'long hair'])) hairStyle = 'long'
  if (has(text, ['포니테일', '묶은 머리', '하나로 묶'])) hairStyle = 'ponytail'
  if (has(text, ['쪽진', '올림머리', '번 헤어', '상투'])) hairStyle = 'bun'
  if (has(text, ['짧은 머리', '숏컷', '스포츠머리', '빡빡', '삭발', '대머리', 'bald', '민머리'])) hairStyle = 'buzz'
  if (has(text, ['단발'])) hairStyle = 'bob'

  const hairColor = colorNear(text, ['머리', '브릿지', '헤어', 'hair'], has(text, ['흑발']) ? '#151519' : '#2a2118')

  // ── 옷
  let outfit = 'tee'
  if (has(text, ['후드'])) outfit = 'hoodie'
  if (has(text, ['셔츠', '체크', '남방', 'shirt'])) outfit = 'shirt'
  if (has(text, ['재킷', '자켓', '잠바', '점퍼', '가죽', 'jacket'])) outfit = 'jacket'
  if (has(text, ['정장', '수트', '슈트', '턱시도', '양복', 'suit', 'tuxedo'])) outfit = 'suit'
  if (has(text, ['원피스', '드레스', '치마', '스커트', 'dress'])) outfit = 'dress'
  if (has(text, ['니트', '스웨터', '가디건', '카디건'])) outfit = 'knit'
  if (has(text, ['나시', '민소매', '탱크탑'])) outfit = 'tank'

  // 옷 색은 스타일링 문장에서 먼저 찾고, 없으면 전체 텍스트, 그것도 없으면 기본값
  const outfitColor =
    colorNear(styling, ['재킷', '자켓', '셔츠', '후드', '정장', '니트', '드레스', '티', '옷'], null) ??
    colorNear(text, ['재킷', '자켓', '셔츠', '후드', '정장', '니트', '드레스', '티', '옷'], null) ??
    colorFrom(styling, null) ??
    ['#39405c', '#4a3b52', '#33474a', '#52403a'][Math.floor(rand(1) * 4)]

  // ── 액세서리
  const acc = new Set()
  if (has(text, ['안경', '뿔테', '선글라스', 'glasses'])) acc.add('glasses')
  if (has(text, ['헤드폰', '헤드셋', '이어폰'])) acc.add('headphones')
  if (has(text, ['목걸이', '펜던트', '체인', 'necklace'])) acc.add('necklace')
  if (has(text, ['피어싱', '귀걸이', 'piercing'])) acc.add('earring')
  if (has(text, ['타투', '문신', 'tattoo'])) acc.add('tattoo')
  if (has(text, ['사원증', '명찰', '목걸이 카드', '뱃지', '배지'])) acc.add('badge')
  if (has(text, ['모자', '캡', '비니', '카우보이', 'hat', 'cap'])) acc.add('hat')
  if (has(text, ['목도리', '머플러', '스카프', 'scarf'])) acc.add('scarf')
  if (has(text, ['시계', '손목시계', 'watch'])) acc.add('watch')
  if (has(text, ['부츠', '워커', '구두', 'boots'])) acc.add('boots')
  if (has(text, ['우산', 'umbrella'])) acc.add('umbrella')
  if (has(text, ['앞치마', 'apron'])) acc.add('apron')
  if (has(text, ['반창고', '붕대', '보호대'])) acc.add('bandage')
  if (has(text, ['마스크', 'mask'])) acc.add('mask')
  if (has(text, ['가방', '백팩', '배낭'])) acc.add('backpack')

  // ── 분위기(림 라이트 색). 스타일링 태그가 판을 지배한다.
  const aura =
    colorFrom(styling, null) ??
    (input.role === 'target' ? '#ffd166' : '#4cd6ff')

  // ── 피부/얼굴
  const skin = ['#e9c6a4', '#dbb08c', '#c99270', '#f0d4b8'][Math.floor(rand(2) * 4)]
  const darkCircles = has(text, ['다크서클', '눈 밑', '피곤', '야간', '밤형'])
  const blush = input.role === 'target'

  return {
    height,
    build,
    posture,
    skin,
    darkCircles,
    blush,
    hair: { style: hairStyle, color: hairColor },
    outfit: { type: outfit, color: outfitColor },
    accessories: [...acc],
    aura,
  }
}

/** 두 명세가 실질적으로 같은지 — 같으면 모델을 다시 세우지 않는다. */
export function sameAppearance(a, b) {
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}
