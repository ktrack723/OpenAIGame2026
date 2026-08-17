// 브라우저 실행 옵션 한 군데.
//
// 개발 컨테이너에는 크로미움이 미리 깔려 있고, @playwright/test 가 기대하는 빌드 번호와
// 다를 수 있어서 있는 실행 파일을 직접 가리킨다. CI 에는 그 경로가 없으니
// executablePath 를 아예 넣지 않고 playwright 가 받은 브라우저에 맡긴다.
// (빈 문자열을 넘기면 런처가 빈 경로를 실행하려다 죽는다.)

import { existsSync } from 'node:fs'

const FALLBACK = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

export function chromeLaunchOptions() {
  const wanted = process.env.RIZZ_CHROME || FALLBACK
  return {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
    ...(existsSync(wanted) ? { executablePath: wanted } : {}),
  }
}
