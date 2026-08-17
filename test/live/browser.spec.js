// 실제 키로 도는 브라우저 검증.
//
// 평소 E2E 는 api.anthropic.com 을 page.route 로 가로채기 때문에, 브라우저가 진짜
// Anthropic 서버와 말을 트는 구간 — CORS 프리플라이트 — 은 한 번도 검증되지 않는다.
// GitHub Pages 배포에서 가장 먼저 깨질 수 있는 곳이 정확히 거기다.
//
//   ANTHROPIC_API_KEY=sk-ant-... npm run live:browser
//
// 여기서는 아무것도 가로채지 않는다. 진짜 호출이 나가고 요금은 본인 계정에 붙는다.
// 기본은 준비 평가 + 두 턴(호출 9회 안쪽). 끝까지 보려면 RIZZ_LIVE_FULL=1.

import { test, expect } from '@playwright/test'
import { watchNetwork, connect, prepare, runTurns, finishRun, assertLog } from './drive.js'

const KEY = process.env.ANTHROPIC_API_KEY
const MODEL = process.env.RIZZ_MODEL || 'claude-opus-5'
const FULL = process.env.RIZZ_LIVE_FULL === '1'

test.skip(!KEY, 'ANTHROPIC_API_KEY 가 없습니다 — 실제 키가 있어야 도는 검사입니다')

test.describe('실제 API · 브라우저', () => {
  test('브라우저에서 직접 부른 호출이 CORS 를 통과한다', async ({ page }) => {
    test.setTimeout(120_000)
    const net = watchNetwork(page)

    // connect() 는 타이틀 화면이 뜰 때까지 기다린다. 프리플라이트가 막히면 여기서 죽는다.
    await connect(page, { key: KEY, model: MODEL })

    expect(net.sent.length, '실제 호출이 나가지 않았다').toBeGreaterThan(0)
    expect(
      net.failed,
      `브라우저 직접 호출이 막혔다 — CORS 또는 네트워크.\n콘솔: ${net.consoleErrors.join(' | ')}`,
    ).toEqual([])
  })

  test('실제 모델로 게임이 돈다', async ({ page }) => {
    test.setTimeout(FULL ? 1_200_000 : 300_000)
    const net = watchNetwork(page)
    await connect(page, { key: KEY, model: MODEL })

    const prep = await prepare(page)
    expect(prep.llm, '준비 평가가 모델 응답으로 채워지지 않았다').toBeTruthy()
    expect(prep.speech.confidence).toBeGreaterThanOrEqual(0)
    expect(prep.speech.confidence).toBeLessThanOrEqual(1)
    expect(prep.coaching.fidelity).toBeGreaterThanOrEqual(0)
    expect(prep.coaching.fidelity).toBeLessThanOrEqual(1)
    console.log(`\n  모델 촌평: "${prep.llm.speechComment}"\n`)

    const turns = FULL ? 20 : 2
    const log = await runTurns(page, turns)
    assertLog(log, FULL ? 14 : 2)
    for (const e of log) {
      console.log(`  ${e.clientText}\n    └ ${e.reason} (분위기 ${e.moodDelta} · 호감 ${e.loveDelta})`)
    }

    // 심판이 스키마 밖의 화제를 만들어내지 않았는가
    const known = await page.evaluate(() => {
      const g = globalThis.__rizz.game
      return [...g.client.target.likes, ...g.dossier.mines]
    })
    for (const e of log) {
      if (e.topic) expect(known, `심판이 없는 화제를 냈다: ${e.topic}`).toContain(e.topic)
    }

    if (FULL) {
      expect(await finishRun(page), '엔딩까지 가지 못했다').toBe(true)
      await expect(page.getByTestId('stamp')).toBeVisible()
      await expect(page.locator('.letter')).toContainText('김도훈')
    }

    expect(net.failed, '실제 호출 중 실패한 요청이 있다').toEqual([])
    console.log(`\n  실제 호출 ${net.sent.length}회\n`)
  })
})
