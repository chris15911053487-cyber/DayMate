import { Bell, Check, Mic, Sparkles } from 'lucide-react'
import { useAuth } from '../auth/store'
import { sampleBrief, sampleEntries, sampleEvents, sampleTasks, type SampleEvent } from '../sample'

const TONE_BAR: Record<SampleEvent['tone'], string> = {
  primary: 'bg-primary',
  accent: 'bg-accent',
  success: 'bg-success',
}

function greeting(hour: number) {
  if (hour < 6) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

function Section({ title, extra, children }: { title: string; extra?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="display text-base">{title}</h2>
        {extra && <span className="text-xs text-muted">{extra}</span>}
      </div>
      {children}
    </section>
  )
}

/** 主题样张页用的"今天"示例（示例数据）。真实首页见 pages/TodayPage.tsx。 */
export function SampleTodayView() {
  const { user } = useAuth()
  const name = user ? user.nickname || user.username : null
  const now = new Date()
  const dateText = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })

  return (
    <div className="space-y-5">
      <header className="px-1 pt-1">
        <p className="text-sm text-muted">{dateText}</p>
        <h1 className="display mt-0.5 text-[26px] leading-tight">{greeting(now.getHours())}
          {name && `，${name}`}
        </h1>
      </header>

      <div className="card relative overflow-hidden p-4">
        <div className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden />
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Sparkles size={16} />
          AI 早报
          <span className="ml-auto rounded-control bg-surface-2 px-1.5 py-0.5 text-[10px] font-normal text-muted">示例数据</span>
        </div>
        <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{sampleBrief}</p>
      </div>

      <Section title="今日安排" extra={`${sampleEvents.length} 项`}>
        <ol className="timeline-rail ml-[4rem] space-y-3 pl-4">
          {sampleEvents.map((e) => (
            <li key={e.time} className="relative">
              <span className="absolute -left-[4.75rem] top-3 w-12 text-right text-xs tabular-nums text-muted">{e.time}</span>
              <span className={`absolute -left-[1.36rem] top-3.5 size-2.5 rounded-full ring-4 ring-bg ${TONE_BAR[e.tone]}`} aria-hidden />
              <div className={`card flex items-start gap-3 p-3 ${e.done ? 'opacity-60' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className={`truncate font-medium ${e.done ? 'line-through' : ''}`}>{e.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {e.time}–{e.end}
                    {e.where && ` · ${e.where}`}
                  </p>
                </div>
                {e.remind && (
                  <span className="flex items-center gap-1 rounded-control bg-primary-soft px-2 py-1 text-[11px] text-primary">
                    <Bell size={12} /> 14:30
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="待办" extra={`${sampleTasks.filter((t) => !t.done).length} 件未完成`}>
        <ul className="card divide-y divide-line">
          {sampleTasks.map((t) => (
            <li key={t.title} className="flex items-center gap-3 px-4 py-3">
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                  t.done ? 'border-success bg-success text-primary-fg' : 'border-line'
                }`}
              >
                {t.done && <Check size={12} strokeWidth={3} />}
              </span>
              <span className={`flex-1 text-[15px] ${t.done ? 'text-muted line-through' : ''}`}>{t.title}</span>
              <span className="text-xs text-muted">{t.due}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="今日记录">
        <ul className="space-y-2">
          {sampleEntries.map((r) => (
            <li key={r.time} className="card p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <span className="tabular-nums">{r.time}</span>
                {r.voice && (
                  <span className="flex items-center gap-0.5 text-accent">
                    <Mic size={11} /> 语音
                  </span>
                )}
              </div>
              <p className="mt-1 text-[15px] leading-relaxed">{r.text}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
