// 화면 스크린샷을 찍는다. 실제로 어떻게 보이는지 눈으로 확인하기 위한 것.
//   node tools/serve.js 4321 &   그리고
//   node tools/shots.mjs [출력폴더]

import { chromium, devices } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { respond } from '../test/e2e/fake-api.js'

const OUT = process.argv[2] ?? '/tmp/shots'
const URL = process.env.RIZZ_URL ?? 'http://127.0.0.1:4321/index.html'
const CHROME = process.env.RIZZ_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
})

const VIEWS = [
  { name: 'desktop', opts: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
  { name: 'ipad', opts: { ...devices['iPad (gen 7)'], browserName: undefined, defaultBrowserType: undefined, deviceScaleFactor: 1 } },
  { name: 'iphone', opts: { ...devices['iPhone 13'], browserName: undefined, defaultBrowserType: undefined, deviceScaleFactor: 1 } },
]

for (const view of VIEWS) {
  const { defaultBrowserType, browserName, ...ctxOpts } = view.opts
  const ctx = await browser.newContext(ctxOpts)
  const page = await ctx.newPage()

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
  await page.addInitScript(() => {
    localStorage.setItem('rizz.apiKey', 'sk-ant-shot')
    localStorage.setItem('rizz.model', 'claude-opus-5')
  })

  const shot = async (name) => {
    await page.waitForTimeout(900) // 애니메이션이 자리잡을 시간
    await page.screenshot({ path: `${OUT}/${view.name}-${name}.png` })
    console.log(`${OUT}/${view.name}-${name}.png`)
  }

  await page.goto(URL)
  await page.getByText('임무 시작').waitFor({ timeout: 20000 })
  await shot('1-title')

  await page.getByText('임무 시작').click()
  await page.getByText('보통 · AGENT').click()
  await shot('2-screening')

  await page.getByTestId('client-taeo').click()
  await shot('3-dossier')

  await page.getByTestId('take').click()
  await page.getByTestId('styling').fill('흰 정장, 짧은 머리, 은 목걸이, 뿔테 안경, 구두')
  await shot('4-styling-suit')

  await page.getByTestId('styling').fill('빨간 후드티, 분홍 긴 머리, 헤드폰, 부츠, 백팩')
  await shot('5-styling-hoodie')

  await page.getByTestId('to-coaching').click()
  await page.getByTestId('coaching').fill('책이랑 고양이 얘기를 먼저 꺼내. 목소리는 낮추고, 자랑은 하지 마.')
  await page.getByTestId('to-speech').click()
  await page.getByTestId('speech').fill('태오야. 6개월 동안 매주 화요일 그 도서관에 간 건 너야. 넌 할 수 있어!')
  await page.getByTestId('begin').click()
  await page.getByTestId('start-chat').waitFor({ timeout: 30000 })
  await shot('6-prep')

  await page.getByTestId('start-chat').click()
  await page.getByTestId('phase-go').click()
  // 몇 턴 진행해서 대화 화면을 찍는다
  for (let i = 0; i < 4; i++) {
    await page.getByTestId('watch').waitFor({ timeout: 30000 })
    await page.getByTestId('watch').click()
  }
  await page.getByTestId('watch').waitFor({ timeout: 30000 })
  await shot('7-chat')

  await ctx.close()
}

await browser.close()
console.log('done')
