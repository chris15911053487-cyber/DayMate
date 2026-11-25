import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { CalendarDays, Search } from 'lucide-react'
import { relativeDayLabel } from '@daymate/shared'
import { useSearch } from '../api/queries'
import { EventEditor } from '../components/EventEditor'
import { TaskList } from '../components/Tasks'
import { dateIn, useToday, useTz } from '../utils/datetime'

export function SearchPage() {
  const tz = useTz()
  const today = useToday()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState(params.get('q') ?? '')
  const q = params.get('q') ?? ''
  const { data, isFetching } = useSearch(q)
  const [eventId, setEventId] = useState<string | null>(null)

  // 停止输入 300ms 后再搜，结果地址可以收藏、返回
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (text.trim() !== q) setParams(text.trim() ? { q: text.trim() } : {}, { replace: true })
    }, 300)
    return () => window.clearTimeout(t)
  }, [text, q, setParams])

  const total = data ? data.events.length + data.tasks.length + data.entries.length : 0

  return (
    <div className="space-y-5">
      <label className="card flex items-center gap-2 px-3 py-2.5">
        <Search size={18} className="text-muted" />
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="搜日程、待办、记录"
          aria-label="搜索"
          maxLength={50}
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted"
        />
      </label>

      {q && data && !total && !isFetching && <p className="text-center text-sm text-muted">没有找到「{q}」相关的内容</p>}

      {!!data?.events.length && (
        <section className="space-y-2">
          <h2 className="display px-1 text-base">日程</h2>
          <ul className="card divide-y divide-line">
            {data.events.map((e) => {
              const day = e.allDay ? e.startDate! : dateIn(e.start!, tz)
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => setEventId(e.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                    <CalendarDays size={16} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">{e.title}</span>
                    <span className="shrink-0 text-xs text-muted">{e.repeat ? '重复 · ' : ''}{relativeDayLabel(day, today)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {!!data?.tasks.length && (
        <section className="space-y-2">
          <h2 className="display px-1 text-base">待办</h2>
          <TaskList tasks={data.tasks} />
        </section>
      )}
      {!!data?.entries.length && (
        <section className="space-y-2">
          <h2 className="display px-1 text-base">记录</h2>
          <ul className="card divide-y divide-line">
            {data.entries.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => navigate(`/journal?date=${r.date}`)} className="block w-full px-4 py-3 text-left">
                  <span className="text-xs text-muted">{relativeDayLabel(r.date, today)}</span>
                  <span className="mt-0.5 line-clamp-2 block text-[15px]">{r.content}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <EventEditor open={!!eventId} onClose={() => setEventId(null)} eventId={eventId} />
    </div>
  )
}
