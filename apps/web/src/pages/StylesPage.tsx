import { Bell, CalendarDays, NotebookPen, Sun, User } from 'lucide-react'
import { THEME_GROUP_LABELS, THEME_LABELS, THEME_PRESETS, type ThemeGroup, type ThemePreset } from '@daymate/shared'
import { MicButton } from '../components/MicButton'
import { SampleTodayView } from '../components/SampleTodayView'
import { useTheme } from '../theme'

/** 视觉方向样张：同一个"今天"页面分别套三套主题，并排对比（docs/技术方案.md 第 17 节 M0） */
export function StylesPage() {
  const [current, setTheme] = useTheme()
  return (
    <div className="space-y-6">
      <header className="px-1">
        <h1 className="display text-[26px]">主题样张</h1>
        <p className="mt-1 text-sm text-muted">
          同一个"今天"页面，套上 {THEME_PRESETS.length} 套不同的主题。手机上可以左右滑动查看。
        </p>
      </header>
      {(Object.keys(THEME_GROUP_LABELS) as ThemeGroup[]).map((group) => (
        <section key={group} className="space-y-3">
          <h2 className="display px-1 text-lg">{THEME_GROUP_LABELS[group]}</h2>
          <div className="-mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-4 lg:mx-0 lg:grid lg:grid-cols-[repeat(auto-fill,340px)] lg:gap-6 lg:overflow-visible lg:px-0">
            {THEME_PRESETS.filter((t) => THEME_LABELS[t].group === group).map((t) => (
              <PhoneFrame key={t} theme={t} active={current === t} onUse={() => setTheme(t)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function PhoneFrame({ theme, active, onUse }: { theme: ThemePreset; active: boolean; onUse: () => void }) {
  const { name, tagline } = THEME_LABELS[theme]
  return (
    <figure className="w-[340px] shrink-0 snap-center">
      <div data-theme={theme} className="app-surface relative h-[680px] overflow-hidden rounded-[36px] border-[6px] border-fg shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="display text-lg">DayMate</span>
          <Bell size={18} className="text-fg-2" />
        </div>
        <div className="h-[calc(100%-7.5rem)] overflow-y-auto px-4 pt-3 pb-6">
          <SampleTodayView />
        </div>
        <div className="absolute inset-x-0 bottom-0 grid h-[4.5rem] grid-cols-5 items-end border-t border-line bg-surface pb-2">
          {[Sun, CalendarDays].map((Icon, i) => (
            <Icon key={i} size={20} className={`mx-auto mb-2 ${i === 0 ? 'text-primary' : 'text-muted'}`} />
          ))}
          <div className="-mt-6 flex justify-center">
            <MicButton size="md" />
          </div>
          {[NotebookPen, User].map((Icon, i) => (
            <Icon key={i} size={20} className="mx-auto mb-2 text-muted" />
          ))}
        </div>
      </div>
      <figcaption className="mt-3 flex items-start justify-between gap-3 px-1">
        <div>
          <div className="display text-base">{name}</div>
          <div className="text-xs text-muted">{tagline}</div>
        </div>
        <button
          type="button"
          onClick={onUse}
          disabled={active}
          className="shrink-0 rounded-control bg-primary px-3 py-1.5 text-sm text-primary-fg disabled:bg-surface-2 disabled:text-muted"
        >
          {active ? '使用中' : '用这套'}
        </button>
      </figcaption>
    </figure>
  )
}
