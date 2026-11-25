import { Check } from 'lucide-react'
import { THEME_GROUP_LABELS, THEME_LABELS, THEME_PRESETS, type ThemeGroup } from '@daymate/shared'
import { useTheme } from '../theme'

/** 三个色块，每块用对应主题的 token 局部渲染，所以不需要写死颜色 */
export function ThemePicker() {
  const [theme, setTheme] = useTheme()
  return (
    <div className="space-y-4">
      {(Object.keys(THEME_GROUP_LABELS) as ThemeGroup[]).map((group) => (
        <div key={group} className="space-y-2">
          <div className="px-1 text-xs text-muted">{THEME_GROUP_LABELS[group]}</div>
          <div className="grid grid-cols-3 gap-3">
            {THEME_PRESETS.filter((t) => THEME_LABELS[t].group === group).map((t) => (
        <button
          key={t}
          type="button"
          data-theme={t}
          onClick={() => setTheme(t)}
          className={`app-surface relative overflow-hidden rounded-card border-2 p-3 text-left ${
            theme === t ? 'border-primary' : 'border-line'
          }`}
        >
          <div className="flex gap-1">
            <span className="size-4 rounded-full bg-primary" />
            <span className="size-4 rounded-full bg-accent" />
            <span className="size-4 rounded-full border border-line bg-surface" />
          </div>
          <div className="display mt-3 text-sm">{THEME_LABELS[t].name}</div>
          {theme === t && (
            <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-fg">
              <Check size={12} strokeWidth={3} />
            </span>
          )}
        </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
