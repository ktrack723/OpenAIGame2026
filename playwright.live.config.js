// 실제 Anthropic API 를 때리는 검사 전용 설정.
//
// 기본 E2E(playwright.config.js)와 분리해 둔다. 이쪽은 가로채기가 없어서 돈이 나가고,
// 키가 없으면 통째로 건너뛴다.
//
//   ANTHROPIC_API_KEY=sk-ant-... npm run live:browser
//
// 데스크톱 하나만 돈다 — CORS 는 뷰포트와 무관하다.

import { defineConfig, devices } from '@playwright/test'
import { chromeLaunchOptions } from './tools/chrome.js'

export default defineConfig({
  testDir: './test/live',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4322',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'live',
      use: { ...devices['Desktop Chrome'], launchOptions: chromeLaunchOptions() },
    },
  ],
  webServer: {
    command: 'node tools/serve.js 4322',
    url: 'http://127.0.0.1:4322/index.html',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
