import { useState } from 'react'
import { Link } from 'react-router'
import { Lightbulb, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { splitKey, weekdayLabel, type BriefKind, type Occurrence, type TodayData } from '@daymate/shared'
import { useGenerateBrief, useTodayData } from '../api/queries'
import { ApiError } from '../api/client'
import { toast } from '../ui/toast'
import { useAuth } from '../auth/store'
import { OccurrenceList } from '../components/calendar/OccurrenceList'
import { EntryComposer, EntryList } from '../components/Entries'
import { EventEditor, type EventDraft } from '../components/EventEditor'
import { QuickAddTask, TaskList } from '../components/Tasks'
import { timeIn, useTz } from '../utils/datetime'

function greeting(hour: number) {
  if (hour < 6) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/** 规则生成的今日概览（不调 AI）：还没有早报 / 复盘时显示 */
function overview(d: TodayData, tz: string): string {
  const now = Date.now()
  const timed = d.events.filter((o) => !o.allDay)
  const next = timed.find((o) => Date.parse(o.start!) > now)
  const ongoing = timed.find((o) => Date.parse(o.start!) <= now && Date.parse(o.end!) > now)
  const open = d.tasks.filter((t) => !t.done)
  const late = open.filter((t) => t.dueDate && t.dueDate < d.date)
  const parts: string[] = []
  if (!d.events.length) parts.push('今天没有安排')
  else parts.push(`今天有 ${d.events.length} 个安排`)
  if (ongoing) parts.push(`正在进行「${ongoing.title}」`)
  else if (next) {
    const mins = Math.round((Date.parse(next.start!) - now) / 60_000)
    const left = mins < 60 ? `${mins} 分钟后` : `${Math.floor(mins / 60)} 小时后`
    parts.push(`下一个是 ${timeIn(next.start!, tz)} 的「${next.title}」（${left}）`)
  } else if (timed.length) parts.push('今天的安排都结束了')
  if (open.length) parts.push(`还有 ${open.length} 件待办${late.length ? `，其中 ${late.length} 件已逾期` : ''}`)
  return parts.join('，') + '。'
}

export function TodayPage() {
  const tz = useTz()
  const { user } = useAuth()
  const { data, isLoading } = useTodayData()
  const [editor, setEditor] = useState<{ eventId?: string; draft?: EventDraft } | null>(null)
  const hour = Number(timeIn(new Date().toISOString(), tz).slice(0, 2))
  const name = user ? user.nickname || user.username : ''

  if (isLoading || !data) return <p className="py-10 text-center text-sm text-muted">加载中…</p>
  const { month, day } = splitKey(data.date)
  const open = (o: Occurrence) => setEditor({ eventId: o.eventId })

  return (
    <div className="space-y-6">
      <header className="px-1 pt-1">
        <p className="text-sm text-muted">
          {month}月{day}日 {weekdayLabel(data.date)}
        </p>
        <h1 className="display mt-0.5 text-[26px] leading-tight">
          {greeting(hour)}
          {name && `，${name}`}
        </h1>
      </header>

      <BriefCard data={data} hour={hour} tz={tz} />

      <section className="space-y-2">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="display text-base">今日安排</h2>
          <button type="button" className="flex items-center gap-0.5 text-sm text-primary" onClick={() => setEditor({ draft: { date: data.date } })}>
            <Plus size={14} /> 新建
          </button>
        </div>
        <OccurrenceList items={data.events} day={data.date} onOpen={open} empty="今天没有安排。点「新建」，或按住下面的按钮说一句" />
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="display text-base">待办</h2>
          <Link to="/tasks" className="text-sm text-primary">
            全部待办
          </Link>
        </div>
        <QuickAddTask defaultDue="today" />
        <TaskList tasks={data.tasks} />
      </section>

      <section className="space-y-2">
        <h2 className="display px-1 text-base">今日记录</h2>
        <EntryComposer date={data.date} events={data.events} />
        <EntryList entries={data.entries} events={data.events} />
      </section>

      <EventEditor open={!!editor} onClose={() => setEditor(null)} eventId={editor?.eventId} draft={editor?.draft} />
    </div>
  )
}

/** 首页顶部：有晚间复盘显示复盘，否则显示早报；都还没有就显示规则概览，可以手动让 AI 写 */
function BriefCard({ data, hour, tz }: { data: TodayData; hour: number; tz: string }) {
  const gen = useGenerateBrief()
  const brief = data.briefs.evening ?? data.briefs.morning
  const wantKind: BriefKind = hour >= 17 ? 'evening' : 'morning'
  const title = brief ? (brief.kind === 'evening' ? '今日复盘' : 'AI 早报') : '今日概览'
  const generate = (kind: BriefKind) =>
    gen.mutate(kind, { onError: (err) => toast(err instanceof ApiError ? err.message : '生成失败，请稍后再试') })

  return (
    <div className="card relative overflow-hidden p-4">
      <div className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden />
      <div className="flex items-center gap-2 text-sm font-medium text-primary">
        <Sparkles size={16} /> {title}
        {brief && (
          <button
            type="button"
            onClick={() => generate(brief.kind)}
            disabled={gen.isPending}
            aria-label="重新生成"
            className="ml-auto p-1 text-muted hover:text-primary disabled:animate-spin"
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>
      <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{brief ? brief.summary : overview(data, tz)}</p>
      {brief && brief.suggestions.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {brief.suggestions.map((t) => (
            <li key={t} className="flex items-start gap-2 text-sm text-fg-2">
              <Lightbulb size={14} className="mt-0.5 shrink-0 text-accent" />
              {t}
            </li>
          ))}
        </ul>
      )}
      {!brief && (
        <button type="button" onClick={() => generate(wantKind)} disabled={gen.isPending} className="mt-3 text-sm font-medium text-primary disabled:opacity-60">
          {gen.isPending ? 'AI 正在写…' : wantKind === 'evening' ? '让 AI 写今天的复盘' : '让 AI 写今天的早报'}
        </button>
      )}
      {brief?.model === 'rule' && <p className="mt-2 text-xs text-muted">AI 暂时不可用，这是自动汇总的。</p>}
    </div>
  )
}
