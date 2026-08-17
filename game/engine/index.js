import { createLocalEngine } from './local.js'
import { createLlmEngine } from './llm.js'

/**
 * 'auto' 는 키가 있으면 LLM, 없으면 오프라인.
 * 게임이 키 유무로 못 켜지는 일은 없어야 한다.
 */
export function resolveEngineMode(requested) {
  const mode = requested ?? process.env.RIZZ_ENGINE ?? 'auto'
  if (mode === 'auto') return process.env.ANTHROPIC_API_KEY ? 'llm' : 'local'
  return mode
}

export function createEngine(mode, opts = {}) {
  return resolveEngineMode(mode) === 'llm' ? createLlmEngine(opts) : createLocalEngine()
}

export { createLocalEngine, createLlmEngine }
