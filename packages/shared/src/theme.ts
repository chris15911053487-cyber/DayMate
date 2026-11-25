/** 预设主题 id。新增主题时 web 端 themes.css 要补齐同名的整套 token。 */
export const THEME_PRESETS = [
  'paper',
  'mono',
  'night',
  'ink',
  'pixel',
  'cyber',
  'terminal',
  'y2k',
  'memphis',
  'vapor',
  'newsprint',
  'blueprint',
] as const
export type ThemePreset = (typeof THEME_PRESETS)[number]

export type ThemeGroup = 'classic' | 'bold'
export const THEME_GROUP_LABELS: Record<ThemeGroup, string> = { classic: '经典', bold: '个性' }

export const THEME_LABELS: Record<ThemePreset, { name: string; tagline: string; group: ThemeGroup }> = {
  paper: { name: '暖纸手账', tagline: '米黄纸面、衬线标题、虚线时间轴', group: 'classic' },
  mono: { name: '极简黑白', tagline: '粗黑字、方角黑框、错位硬阴影', group: 'classic' },
  night: { name: '夜航', tagline: '深蓝夜色、薄荷荧光、毛玻璃卡片', group: 'classic' },
  ink: { name: '水墨', tagline: '宣纸底、楷体标题、朱砂印章红', group: 'classic' },
  pixel: { name: '像素游戏', tagline: '粗像素边框、方块阴影、等宽字', group: 'bold' },
  cyber: { name: '赛博霓虹', tagline: '黑底扫描线、粉青霓虹发光', group: 'bold' },
  terminal: { name: '复古终端', tagline: '黑底绿字、荧光余辉、虚线框', group: 'bold' },
  y2k: { name: '千禧糖果', tagline: '镭射渐变、果冻光泽、超大圆角', group: 'bold' },
  memphis: { name: '孟菲斯', tagline: '明黄底、彩色波点、撞色硬阴影', group: 'bold' },
  vapor: { name: '蒸汽波', tagline: '紫粉落日、霓虹网格、宽字距', group: 'bold' },
  newsprint: { name: '号外报纸', tagline: '新闻纸、粗衬线、双线框、红色批注', group: 'bold' },
  blueprint: { name: '工程蓝图', tagline: '蓝底白网格、制图线框、黄色标注', group: 'bold' },
}

export function isThemePreset(v: unknown): v is ThemePreset {
  return typeof v === 'string' && (THEME_PRESETS as readonly string[]).includes(v)
}
