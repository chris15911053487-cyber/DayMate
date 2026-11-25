import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THEME_PRESETS } from '@daymate/shared'

/**
 * 主题再出格也得看得清：按 WCAG 公式检查每套主题关键颜色组合的对比度。
 * 半透明卡片先和页面底色混合再算（纹理、渐变算不进来，样张页人工再看一遍）。
 */
const css = readFileSync(new URL('./themes.css', import.meta.url), 'utf8')

type RGB = [number, number, number]

function themeVars(id: string): Record<string, string> {
  const m = css.match(new RegExp(`\\[data-theme='${id}'\\]\\s*\\{([^}]*)\\}`))
  if (!m) throw new Error(`themes.css 缺少主题 ${id}`)
  const vars: Record<string, string> = {}
  for (const [, k, v] of m[1]!.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[k!] = v!.trim()
  return vars
}

const rgb = (v: Record<string, string>, k: string): RGB => {
  const parts = (v[`c-${k}`] ?? '').split(/\s+/).map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) throw new Error(`缺少颜色 --c-${k}`)
  return parts as RGB
}

const mix = (top: RGB, bottom: RGB, alpha: number): RGB =>
  top.map((c, i) => c * alpha + bottom[i]! * (1 - alpha)) as RGB

function luminance([r, g, b]: RGB) {
  const ch = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

function contrast(a: RGB, b: RGB) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (l1 + 0.05) / (l2 + 0.05)
}

const REQUIRED = [
  'bg', 'surface', 'surface-2', 'line', 'card-border', 'fg', 'fg-2', 'muted', 'primary', 'primary-fg',
  'primary-soft', 'accent', 'accent-soft', 'success', 'warning', 'danger',
]

describe.each(THEME_PRESETS)('主题 %s', (id) => {
  const v = themeVars(id)
  const bg = rgb(v, 'bg')
  const card = mix(rgb(v, 'surface'), bg, Number(v['surface-alpha'] ?? 1))

  it('颜色 token 齐全', () => {
    for (const k of REQUIRED) expect(() => rgb(v, k), k).not.toThrow()
  })

  it.each([
    { label: '正文 / 页面底色', fg: 'fg', back: 'bg', min: 7 },
    { label: '正文 / 卡片', fg: 'fg', back: 'card', min: 7 },
    { label: '次要文字 / 卡片', fg: 'fg-2', back: 'card', min: 4.5 },
    { label: '弱化文字 / 卡片', fg: 'muted', back: 'card', min: 3 },
    { label: '弱化文字 / 页面底色', fg: 'muted', back: 'bg', min: 3 },
    { label: '按钮文字 / 主色', fg: 'primary-fg', back: 'primary', min: 4.5 },
    { label: '主色 / 卡片', fg: 'primary', back: 'card', min: 3 },
    { label: '主色文字 / 浅主色底', fg: 'primary', back: 'primary-soft', min: 3 },
  ])('$label ≥ $min:1', ({ fg, back: backKey, min }) => {
    const back = backKey === 'card' ? card : rgb(v, backKey)
    expect(contrast(rgb(v, fg), back)).toBeGreaterThanOrEqual(min)
  })
})
