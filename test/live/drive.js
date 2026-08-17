// 실제 키 검사의 "대본".
//
// 여기 있는 함수는 두 곳에서 쓴다.
//   1) test/live/browser.spec.js — 진짜 키로, 가로채기 없이.
//   2) test/e2e/live-driver.spec.js — 가짜 모델로, 대본이 UI 와 어긋나지 않았는지만.
//
// 2번이 있는 이유: 실제 키 검사는 평소 CI 에서 돌지 않으니, 화면이 바뀌어도 아무도
// 모른 채 썩는다. 정작 키를 넣고 돌리는 날 셀렉터가 안 맞아 헛걸음하는 게 최악이다.

import { expect } from '@playwright/test'

/** 진짜 호출과 실패를 모두 기록한다. CORS 로 막히면 requestfailed 로 잡힌다. */
export function watchNetwork(page) {
  const sent = []
  const failed = []
  const consoleErrors = []
  page.on('request', (r) => {
    if (r.url().startsWith('https://api.anthropic.com')) sent.push(`${r.method()} ${r.url()}`)
  })
  page.on('requestfailed', (r) => {
    if (r.url().startsWith('https://api.anthropic.com')) {
      failed.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText ?? '?'}`)
    }
  })
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  return { sent, failed, consoleErrors }
}

/** 키 화면에 키를 넣고 접속한다. 여기를 통과하면 브라우저 직접 호출이 뚫렸다는 뜻이다. */
export async function connect(page, { key, model }) {
  await page.goto('/index.html')
  await expect(page.getByTestId('apikey')).toBeVisible()
  await page.getByTestId('apikey').fill(key)
  await page.locator('#modelId').fill(model)
  await page.getByText('접속', { exact: true }).click()
  await expect(page.getByText('임무 시작')).toBeVisible({ timeout: 60_000 })
}

/** 의뢰인을 고르고 상담을 마쳐 준비 평가까지 돌린다. */
export async function prepare(page, { clientId = 'dohun' } = {}) {
  await page.getByText('임무 시작').click()
  await page.getByText('보통 · AGENT').click()
  await page.getByTestId(`client-${clientId}`).click()
  await page.getByTestId('take').click()

  await page.getByTestId('styling').fill('가죽 재킷, 별자리 목걸이, 낡은 헤드폰')
  await page.getByTestId('to-coaching').click()
  await page
    .getByTestId('coaching')
    .fill('야식이랑 별 얘기를 먼저 꺼내. 상대 말을 끝까지 듣고 되물어. 자랑은 하지 마.')
  await page.getByTestId('to-speech').click()
  await page
    .getByTestId('speech')
    .fill(
      '도훈아. 3년 동안 새벽마다 그 편의점을 지킨 건 너야. 삼각김밥 두 개 남겨둔 것도 너고. ' +
        '넌 충분히 성실한 사람이야. 오늘은 솔직하게 가. 넌 할 수 있어!',
    )
  await page.getByTestId('begin').click()

  // 준비 평가는 구조화 출력을 쓴다 — 파싱이 깨지면 여기서 못 넘어간다
  await expect(page.getByTestId('start-chat')).toBeVisible({ timeout: 90_000 })
  return page.evaluate(() => globalThis.__rizz.game.prep)
}

const ACTIONABLE =
  '[data-testid="watch"], [data-testid="next-phase"], [data-testid="phase-go"], [data-testid="to-ending"], [data-testid="stamp"]'

/**
 * 대화를 턴 수만큼 민다. 단계가 바뀌면 버튼 이름도 바뀌므로 그때그때 골라 누른다.
 * @returns {Promise<object[]>} game.log
 */
export async function runTurns(page, turns, { perTurnTimeout = 120_000 } = {}) {
  await page.getByTestId('start-chat').click()
  await page.getByTestId('phase-go').click()

  for (let i = 0; i < turns; i++) {
    await page.locator(ACTIONABLE).first().waitFor({ state: 'visible', timeout: perTurnTimeout })
    if (await page.getByTestId('stamp').isVisible().catch(() => false)) break
    if (await page.getByTestId('to-ending').isVisible().catch(() => false)) break
    for (const id of ['next-phase', 'phase-go', 'watch']) {
      const b = page.getByTestId(id)
      if (await b.isVisible().catch(() => false)) {
        await b.click()
        break
      }
    }
  }
  // 마지막으로 누른 턴은 아직 모델을 부르는 중이다. 버튼이 다시 뜰 때까지 기다리지 않으면
  // 그 턴을 통째로 놓친 기록을 읽게 된다.
  await page.locator(ACTIONABLE).first().waitFor({ state: 'visible', timeout: perTurnTimeout })
  return page.evaluate(() => globalThis.__rizz.game.log)
}

/** 남은 버튼을 계속 눌러 도장이 찍힐 때까지 간다. */
export async function finishRun(page, { timeout = 120_000, maxSteps = 40 } = {}) {
  for (let i = 0; i < maxSteps; i++) {
    await page.locator(ACTIONABLE).first().waitFor({ state: 'visible', timeout })
    if (await page.getByTestId('stamp').isVisible().catch(() => false)) return true
    for (const id of ['to-ending', 'next-phase', 'phase-go', 'watch']) {
      const b = page.getByTestId(id)
      if (await b.isVisible().catch(() => false)) {
        await b.click()
        break
      }
    }
  }
  return false
}

/** 대사·판정이 실제 값으로 채워졌는지. 가짜 모델이든 진짜 모델이든 같은 기준이다. */
export function assertLog(log, minTurns) {
  expect(log.length, '대사가 쌓이지 않았다').toBeGreaterThanOrEqual(minTurns)
  for (const e of log) {
    expect(e.clientText.trim().length, '의뢰인 대사가 비었다').toBeGreaterThan(0)
    expect(e.targetText.trim().length, '상대 대사가 비었다').toBeGreaterThan(0)
    expect(Number.isInteger(e.moodDelta), `분위기 변화가 정수가 아니다: ${e.moodDelta}`).toBe(true)
    expect(Number.isInteger(e.loveDelta), `호감 변화가 정수가 아니다: ${e.loveDelta}`).toBe(true)
    // 심판 값(±14) + 중립점 복귀 드리프트(±2)
    expect(Math.abs(e.moodDelta)).toBeLessThanOrEqual(16)
    expect(Math.abs(e.loveDelta)).toBeLessThanOrEqual(11)
  }
}
