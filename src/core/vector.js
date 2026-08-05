export const vec = (x = 0, y = 0) => ({ x, y })
export const clone = (v) => ({ x: v.x, y: v.y })
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (v, s) => ({ x: v.x * s, y: v.y * s })
export const len = (v) => Math.hypot(v.x, v.y)
export const norm = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l } }
export const dot = (a, b) => a.x * b.x + a.y * b.y
export const fromAngle = (a, m = 1) => ({ x: Math.cos(a) * m, y: Math.sin(a) * m })
export const angleOf = (v) => Math.atan2(v.y, v.x)
export const dist = (a, b) => len(sub(a, b))
