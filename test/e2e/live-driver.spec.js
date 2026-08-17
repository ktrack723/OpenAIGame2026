// 실제 키 검사의 대본(test/live/drive.js)이 UI 와 어긋나지 않았는지 확인한다.
//
// 실제 키 검사는 평소 CI 에서 돌지 않는다. 화면을 고치다 셀렉터가 어긋나도 아무도
// 모르고 있다가, 정작 키를 넣고 돌리는 날 헛걸음한다. 그래서 같은 대본을 가짜
// 모델로 한 번 돌려 둔다 — 여기서는 API 를 가로채므로 돈이 나가지 않는다.

import { test, expect } from '@playwright/test'
import { respond } from './fake-api.js'
import { connect, prepare, runTurns, finishRun, assertLog } from '../live/drive.js'

test('실제 키 검사 대본이 지금 화면에서 그대로 돈다', async ({ page }, testInfo) => {
  // 셀렉터가 맞는지만 보면 된다. 기기별로 세 번 돌릴 이유가 없다.
  test.skip(testInfo.project.name !== 'desktop', '대본 검증은 데스크톱 한 번이면 충분하다')
  // 소프트웨어 렌더링에서는 프레임이 느리다 — 대본은 끝까지 돌린다.
  test.setTimeout(300_000)

  let seq = 0
  await page.route('https://api.anthropic.com/**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(respond(body, seq++, { mode: 'win' })),
    })
  })

  await connect(page, { key: 'sk-ant-fake-for-tests', model: 'claude-opus-5' })

  const prep = await prepare(page)
  expect(prep.llm).toBeTruthy()
  expect(prep.speech.confidence).toBeGreaterThanOrEqual(0)
  expect(prep.speech.confidence).toBeLessThanOrEqual(1)

  // 실제 키 검사의 기본값과 같은 경로 — 정확히 두 턴만 민다.
  // 마지막 턴이 끝나기 전에 기록을 읽으면 여기서 1 이 나온다.
  const log = await runTurns(page, 2)
  assertLog(log, 2)
  expect(log.length, '누른 만큼의 턴이 기록되지 않았다').toBe(2)

  // 그리고 남은 턴을 끝까지 — 단계 전환과 엔딩까지 대본이 통하는지
  expect(await finishRun(page)).toBe(true)
  assertLog(await page.evaluate(() => globalThis.__rizz.game.log), 14)
  await expect(page.getByTestId('stamp')).toBeVisible()
  await expect(page.locator('.letter')).toContainText('김도훈')
})
