import { defineConfig, devices } from '@playwright/test'
import { chromeLaunchOptions } from './tools/chrome.js'

// 컨테이너에서 root 로 도는 경우가 많아 샌드박스를 끈다. 끄지 않으면 조용히 멈춘다.
// 미리 깔린 크로미움이 있으면 그걸 쓰고, 없으면(CI) playwright 가 받은 걸 쓴다.
const launchOptions = chromeLaunchOptions()

// 정적 사이트 그대로 띄운다 — GitHub Pages 와 같은 조건(빌드 단계 없음)에서 검증한다.
export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4321',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
    // iPad/iPhone 기술자는 defaultBrowserType 이 webkit 이다. 이 이미지에는 웹킷이 없어서
    // 크로미움으로 뷰포트·터치만 흉내 낸다 — 안 그러면 웹킷 런처가 크롬 바이너리를 물고 죽는다.
    { name: 'ipad', use: { ...devices['iPad (gen 7)'], browserName: 'chromium', launchOptions } },
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions } },
  ],
  webServer: {
    command: 'node tools/serve.js 4321',
    url: 'http://127.0.0.1:4321/index.html',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
