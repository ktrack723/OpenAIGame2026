import { test, expect } from '@playwright/test'
import { respond } from './fake-api.js'

/** api.anthropic.com 을 가짜 모델로 바꿔치고, 호출 기록을 돌려준다. */
async function stubApi(page, tune = {}) {
  const calls = []
  let seq = 0
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const body = JSON.parse(req.postData() || '{}')
    calls.push({ headers: req.headers(), body })
    const payload = respond(body, seq++, tune)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(payload),
    })
  })
  return calls
}

async function bootWithKey(page) {
  await page.addInitScript(() => {
    localStorage.setItem('rizz.apiKey', 'sk-ant-fake-for-tests')
    localStorage.setItem('rizz.model', 'claude-opus-5')
  })
  await page.goto('/index.html')
}


/** 화면에 뜨는 진행 버튼을 눌러 대화를 끝까지 민다. */
const ACTIONABLE = '[data-testid="watch"], [data-testid="next-phase"], [data-testid="phase-go"], [data-testid="to-ending"], [data-testid="stamp"]'

async function playToEnd(page, maxSteps = 60) {
  for (let i = 0; i < maxSteps; i++) {
    // 다음에 누를 것이 나타날 때까지 기다린다(모델 호출 중에는 아무 버튼도 없다)
    await page.locator(ACTIONABLE).first().waitFor({ state: 'visible', timeout: 30_000 })
    if (await page.getByTestId('stamp').isVisible().catch(() => false)) return
    for (const id of ['to-ending', 'next-phase', 'phase-go', 'watch']) {
      const b = page.getByTestId(id)
      if (await b.isVisible().catch(() => false)) {
        await b.click()
        break
      }
    }
  }
  throw new Error('진행 버튼을 계속 눌렀는데 엔딩까지 가지 못했다')
}

/** 상담실까지 진행 */
async function toConsult(page, clientId = 'dohun') {
  await expect(page.getByText('임무 시작')).toBeVisible()
  await page.getByText('임무 시작').click()
  await page.getByText('보통 · AGENT').click()
  await page.getByTestId(`client-${clientId}`).click()
  await page.getByTestId('take').click()
  await expect(page.getByTestId('styling')).toBeVisible()
}

test.describe('부팅과 연결', () => {
  test('키가 없으면 게임이 시작되지 않는다', async ({ page }) => {
    await stubApi(page)
    await page.goto('/index.html')
    await expect(page.getByTestId('apikey')).toBeVisible()
    await expect(page.getByText('이 게임은 LLM 연결이 있어야만 돌아갑니다')).toBeVisible()
    // 임무 시작 버튼 자체가 없다
    await expect(page.getByText('임무 시작')).toHaveCount(0)
  })

  test('연결이 실패하면 접속 화면에 머문다', async ({ page }) => {
    await page.route('https://api.anthropic.com/**', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ error: { message: 'invalid x-api-key' } }),
      }),
    )
    await page.goto('/index.html')
    await page.getByTestId('apikey').fill('sk-ant-bad')
    await page.getByText('접속', { exact: true }).click()
    await expect(page.getByText(/연결 실패/)).toBeVisible()
    await expect(page.getByText('임무 시작')).toHaveCount(0)
  })

  test('브라우저 직접 호출 헤더를 보낸다', async ({ page }) => {
    const calls = await stubApi(page)
    await page.goto('/index.html')
    await page.getByTestId('apikey').fill('sk-ant-fake-for-tests')
    await page.getByText('접속', { exact: true }).click()
    await expect(page.getByText('임무 시작')).toBeVisible()

    expect(calls.length).toBeGreaterThan(0)
    const h = calls[0].headers
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(h['anthropic-version']).toBe('2023-06-01')
    expect(h['x-api-key']).toBe('sk-ant-fake-for-tests')
  })

  test('요청 본문이 Opus 5 규격을 지킨다', async ({ page }) => {
    const calls = await stubApi(page)
    await bootWithKey(page)
    await toConsult(page)
    await page.getByTestId('to-coaching').click()
    await page.getByTestId('to-speech').click()
    await page.getByTestId('begin').click()
    await expect(page.getByTestId('start-chat')).toBeVisible()

    const prep = calls.find((c) => c.body.output_config?.format?.schema?.properties?.speech_confidence)
    expect(prep, '준비 평가 호출이 있어야 한다').toBeTruthy()
    expect(prep.body.model).toBe('claude-opus-5')
    expect(prep.body.temperature).toBeUndefined()
    expect(prep.body.top_p).toBeUndefined()
    expect(prep.body.thinking).toBeUndefined()
    expect(prep.body.output_format).toBeUndefined()
    expect(prep.body.output_config.format.type).toBe('json_schema')
    expect(prep.body.system[0].cache_control.type).toBe('ephemeral')
  })
})

test.describe('3D 무대', () => {
  test('WebGL 캔버스가 실제로 그려진다', async ({ page }) => {
    await stubApi(page)
    await bootWithKey(page)
    await expect(page.getByText('임무 시작')).toBeVisible()

    const info = await page.evaluate(() => {
      const c = document.getElementById('stage')
      const gl = c.getContext('webgl2') || c.getContext('webgl')
      return {
        hasCanvas: Boolean(c),
        hasGL: Boolean(gl),
        w: c.width,
        h: c.height,
        actors: Object.keys(globalThis.__rizz?.stage ? { ok: 1 } : {}),
        childCount: globalThis.__rizz?.stage?.scene?.children?.length ?? 0,
      }
    })
    expect(info.hasCanvas).toBe(true)
    expect(info.hasGL).toBe(true)
    expect(info.w).toBeGreaterThan(0)
    // 바닥/그리드/조명/간판/캐릭터 둘
    expect(info.childCount).toBeGreaterThan(6)
  })

  test('캔버스에 실제 픽셀이 칠해진다 (검은 화면이 아니다)', async ({ page }) => {
    await stubApi(page)
    await bootWithKey(page)
    await expect(page.getByText('임무 시작')).toBeVisible()
    await page.waitForTimeout(700)

    const nonBlack = await page.evaluate(() => {
      const src = document.getElementById('stage')
      const c = document.createElement('canvas')
      c.width = 160
      c.height = 100
      const ctx = c.getContext('2d')
      ctx.drawImage(src, 0, 0, c.width, c.height)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let lit = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] + d[i + 1] + d[i + 2] > 60) lit++
      }
      return lit
    })
    expect(nonBlack, '렌더 결과가 전부 어둡다 — 씬이 비었을 수 있다').toBeGreaterThan(200)
  })
})

test.describe('외모 텍스트 → 모델', () => {
  test('스타일링을 고치면 모델이 다시 세워진다', async ({ page }) => {
    await stubApi(page)
    await bootWithKey(page)
    await toConsult(page)

    const before = await page.evaluate(() => globalThis.__rizz.stage.getActor('client').spec)

    await page.getByTestId('styling').fill('분홍 머리, 흰 정장, 뿔테 안경, 헤드폰, 부츠')
    await page.waitForTimeout(500)

    const after = await page.evaluate(() => globalThis.__rizz.stage.getActor('client').spec)

    expect(after.hair.color).not.toBe(before.hair.color)
    expect(after.outfit.type).toBe('suit')
    expect(after.accessories).toContain('glasses')
    expect(after.accessories).toContain('headphones')
    expect(after.accessories).toContain('boots')
  })

  test('다른 문장은 다른 모델을 만든다', async ({ page }) => {
    await stubApi(page)
    await bootWithKey(page)
    await toConsult(page)

    const specFor = async (text) => {
      await page.getByTestId('styling').fill(text)
      await page.waitForTimeout(400)
      return page.evaluate(() => globalThis.__rizz.stage.getActor('client').spec)
    }

    const a = await specFor('검정 후드티, 짧은 머리')
    const b = await specFor('빨간 원피스, 긴 머리, 목걸이')
    expect(a.outfit.type).toBe('hoodie')
    expect(b.outfit.type).toBe('dress')
    expect(a.hair.style).not.toBe(b.hair.style)
    expect(a.outfit.color).not.toBe(b.outfit.color)
  })

  test('모델 교체 후에도 씬이 깨지지 않는다', async ({ page }) => {
    await stubApi(page)
    await bootWithKey(page)
    await toConsult(page)
    for (const s of ['정장', '원피스, 긴 머리', '후드티, 부스스한 머리', '니트, 안경, 목도리']) {
      await page.getByTestId('styling').fill(s)
      await page.waitForTimeout(280)
    }
    const ok = await page.evaluate(() => {
      const st = globalThis.__rizz.stage
      return Boolean(st.getActor('client')?.group?.parent) && st.scene.children.length > 6
    })
    expect(ok).toBe(true)
  })
})

test.describe('게임 한 판', () => {
  test('처음부터 끝까지 진행되고 고백에 성공한다', async ({ page }) => {
    // 소프트웨어 렌더링(swiftshader)에서 고해상도 기기는 프레임이 느리다.
    // 14턴을 다 도는 데 시간이 걸릴 뿐, 제품 문제가 아니다.
    test.setTimeout(300_000)
    await stubApi(page, { mode: 'win' })
    await bootWithKey(page)
    await toConsult(page)

    await page.getByTestId('styling').fill('가죽 재킷, 별자리 목걸이, 헤드폰')
    await page.getByTestId('to-coaching').click()
    await page.getByTestId('coaching').fill('야식이랑 별 얘기를 먼저 꺼내. 상대 말을 끝까지 듣고 되물어. 자랑은 하지 마.')
    await page.getByTestId('to-speech').click()
    await page.getByTestId('speech').fill('도훈아. 3년 동안 새벽마다 그 편의점을 지킨 건 너야. 넌 할 수 있어!')
    await page.getByTestId('begin').click()

    await expect(page.getByTestId('start-chat')).toBeVisible()
    await page.getByTestId('start-chat').click()
    await page.getByTestId('phase-go').click()

    await playToEnd(page)

    await expect(page.getByTestId('stamp')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('stamp')).toHaveText('MISSION COMPLETE')
    await expect(page.locator('.letter')).toContainText('김도훈')

    const turns = await page.evaluate(() => globalThis.__rizz.game.log.length)
    expect(turns).toBe(14)
  })

  test('판정이 나쁘면 실패로 끝난다', async ({ page }) => {
    // 소프트웨어 렌더링(swiftshader)에서 고해상도 기기는 프레임이 느리다.
    // 14턴을 다 도는 데 시간이 걸릴 뿐, 제품 문제가 아니다.
    test.setTimeout(300_000)
    await stubApi(page, { mode: 'lose', confidence: 20, fidelity: 15 })
    await bootWithKey(page)
    await toConsult(page)
    await page.getByTestId('to-coaching').click()
    await page.getByTestId('to-speech').click()
    await page.getByTestId('begin').click()
    await page.getByTestId('start-chat').click()
    await page.getByTestId('phase-go').click()

    await playToEnd(page)
    await expect(page.getByTestId('stamp')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('stamp')).toHaveText('MISSION FAILED')
  })

  test('대화 중 호출이 끊기면 멈추고 재시도를 제안한다', async ({ page }) => {
    await stubApi(page)
    await bootWithKey(page)
    await toConsult(page)
    await page.getByTestId('to-coaching').click()
    await page.getByTestId('to-speech').click()
    await page.getByTestId('begin').click()
    await page.getByTestId('start-chat').click()
    await page.getByTestId('phase-go').click()

    // 여기서부터 서버가 죽는다
    await page.unroute('https://api.anthropic.com/**')
    await page.route('https://api.anthropic.com/**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ error: { message: 'internal' } }),
      }),
    )
    await page.getByTestId('watch').click()

    await expect(page.getByText('모델 연결이 끊겼습니다')).toBeVisible()
    await expect(page.getByText('이 게임은 오프라인 모드가 없습니다.')).toBeVisible()
    await expect(page.getByText('다시 시도')).toBeVisible()
  })

  test('개입하면 귓속말이 기록된다', async ({ page }) => {
    await stubApi(page)
    await bootWithKey(page)
    await toConsult(page)
    await page.getByTestId('to-coaching').click()
    await page.getByTestId('to-speech').click()
    await page.getByTestId('begin').click()
    await page.getByTestId('start-chat').click()
    await page.getByTestId('phase-go').click()

    await page.getByText('귓속말로 개입').click()
    await page.getByTestId('whisper').fill('지금 강아지 얘기를 꺼내.')
    await page.getByTestId('whisper-go').click()

    const left = await page.evaluate(() => globalThis.__rizz.game.interventionsLeft)
    expect(left).toBe(0)
    const pending = await page.evaluate(() => globalThis.__rizz.game.pendingIntervention?.topic)
    expect(pending).toBe('dogs')
  })
})

test.describe('반응형', () => {
  test('세로 화면에서 버튼이 화면 안에 있고 탭 하기 충분하다', async ({ page }) => {
    await stubApi(page)
    await bootWithKey(page)
    await expect(page.getByText('임무 시작')).toBeVisible()

    const vp = page.viewportSize()
    // getByText 는 버튼 안쪽 span 을 잡는다. 탭 타깃은 button 자체라 role 로 집는다.
    const btn = page.getByRole('button', { name: /임무 시작/ })
    const b = await btn.boundingBox()
    expect(b.height).toBeGreaterThanOrEqual(44) // 애플 권장 탭 타깃
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1)
    expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 1)
  })

  test('가로 스크롤이 생기지 않는다', async ({ page }) => {
    await stubApi(page)
    await bootWithKey(page)
    await toConsult(page)
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panel: (() => {
        const p = document.getElementById('panel')
        return p.scrollWidth - p.clientWidth
      })(),
    }))
    expect(overflow.doc).toBeLessThanOrEqual(1)
    expect(overflow.panel).toBeLessThanOrEqual(1)
  })

  test('입력 글자 크기가 16px 이상이다 (iOS 자동 확대 방지)', async ({ page }) => {
    await stubApi(page)
    await bootWithKey(page)
    await toConsult(page)
    const size = await page.evaluate(() => {
      const ta = document.querySelector('textarea')
      return Number.parseFloat(getComputedStyle(ta).fontSize)
    })
    expect(size).toBeGreaterThanOrEqual(16)
  })
})
