import { useEffect, useId, useState, type FormEvent } from 'react'
import { Repeat as RepeatIcon, Trash2 } from 'lucide-react'
import {
  REMINDER_OPTIONS,
  REPEAT_PRESETS,
  addDays,
  describeRepeat,
  eventInputSchema,
  minutesOf,
  presetOf,
  timeOfMinutes,
  zonedParts,
  type EventDetail,
  type EventInput,
  type Repeat,
  type RepeatPreset,
} from '@daymate/shared'
import { useCalendars, useEvent, useEventMutations, useSettings } from '../api/queries'
import { Alert, Button, FieldLabel, Modal, Switch, TextField, cn, inputCls } from '../ui'
import { useTz } from '../utils/datetime'
import { CAL_COLOR } from './calendar/colors'

export interface EventDraft {
  date: string
  time?: string
  allDay?: boolean
}

interface Form {
  title: string
  allDay: boolean
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  preset: RepeatPreset | 'custom'
  customRepeat: Repeat | null
  until: string
  calendarId: string
  location: string
  notes: string
  remind: string
}

const REMIND_LABEL: Record<number, string> = { 0: '准时', 5: '提前 5 分钟', 15: '提前 15 分钟', 30: '提前 30 分钟', 60: '提前 1 小时', 120: '提前 2 小时', 1440: '提前 1 天' }
const PRESET_LABEL: Record<RepeatPreset, string> = { none: '不重复', daily: '每天', workdays: '工作日', weekly: '每周', monthly: '每月', yearly: '每年' }

function blankForm(d: EventDraft, defaultRemind: number): Form {
  const start = d.time ?? '09:00'
  return {
    title: '',
    allDay: d.allDay ?? false,
    startDate: d.date,
    startTime: start,
    endDate: d.date,
    endTime: timeOfMinutes(Math.min(minutesOf(start) + 60, 23 * 60 + 59)),
    preset: 'none',
    customRepeat: null,
    until: '',
    calendarId: '',
    location: '',
    notes: '',
    remind: d.allDay ? 'none' : String(defaultRemind),
  }
}

function formFromEvent(e: EventDetail, tz: string): Form {
  const s = e.start ? zonedParts(e.start, tz) : null
  const en = e.end ? zonedParts(e.end, tz) : null
  const preset = presetOf(e.repeat)
  return {
    title: e.title,
    allDay: e.allDay,
    startDate: e.allDay ? e.startDate! : s!.date,
    startTime: s?.time ?? '09:00',
    endDate: e.allDay ? e.endDate! : en!.date,
    endTime: en?.time ?? '10:00',
    preset,
    customRepeat: preset === 'custom' ? e.repeat : null,
    until: e.repeat?.until ?? '',
    calendarId: e.calendarId,
    location: e.location ?? '',
    notes: e.notes ?? '',
    remind: e.remindBeforeMin.length ? String(e.remindBeforeMin[0]) : 'none',
  }
}

function toInput(f: Form): EventInput {
  let repeat: Repeat | null = f.preset === 'custom' ? f.customRepeat : f.preset === 'none' ? null : { ...REPEAT_PRESETS[f.preset] }
  if (repeat) repeat = { ...repeat, until: f.until || null, count: f.until ? null : repeat.count }
  return {
    title: f.title,
    allDay: f.allDay,
    startDate: f.startDate,
    startTime: f.allDay ? null : f.startTime,
    endDate: f.endDate,
    endTime: f.allDay ? null : f.endTime,
    repeat,
    calendarId: f.calendarId || undefined,
    location: f.location || null,
    notes: f.notes || null,
    remindBeforeMin: f.remind === 'none' ? [] : [Number(f.remind)],
  }
}

/** 新建 / 编辑日程。eventId 有值是编辑（重复日程改的是整个系列），否则按 draft 新建 */
export function EventEditor({ open, onClose, eventId, draft }: { open: boolean; onClose: () => void; eventId?: string | null; draft?: EventDraft }) {
  const tz = useTz()
  const { data: calendars } = useCalendars()
  const { data: existing, isLoading } = useEvent(open && eventId ? eventId : null)
  const { create, update, remove } = useEventMutations()
  const defaultRemind = useSettings().data?.defaultRemindMin ?? 15
  const [form, setForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const ids = { start: useId(), end: useId(), repeat: useId(), until: useId(), cal: useId(), remind: useId() }

  useEffect(() => {
    if (!open) return setForm(null)
    setErrors({})
    if (!eventId && draft) setForm(blankForm(draft, defaultRemind))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventId, draft])
  useEffect(() => {
    if (open && eventId && existing && !form) setForm(formFromEvent(existing, tz))
  }, [open, eventId, existing, form, tz])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => {
      if (!f) return f
      const next = { ...f, [k]: v }
      // 改开始日期时，结束日期跟着平移，保持时长
      if (k === 'startDate' && typeof v === 'string' && f.endDate >= f.startDate) {
        const span = (Date.parse(f.endDate) - Date.parse(f.startDate)) / 86400_000
        next.endDate = addDays(v, span)
      }
      // 改开始时间时，结束时间跟着平移（同一天内）
      if (k === 'startTime' && typeof v === 'string' && f.startDate === f.endDate) {
        const dur = Math.max(15, minutesOf(f.endTime) - minutesOf(f.startTime))
        next.endTime = timeOfMinutes(Math.min(minutesOf(v) + dur, 23 * 60 + 59))
      }
      return next
    })
    setErrors((e) => ({ ...e, [k]: '' }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    const input = toInput(form)
    const r = eventInputSchema.safeParse(input)
    if (!r.success) {
      const fe: Record<string, string> = {}
      for (const i of r.error.issues) fe[String(i.path[0])] ??= i.message
      return setErrors(fe)
    }
    if (eventId) await update.mutateAsync({ id: eventId, input })
    else await create.mutateAsync(input)
    onClose()
  }

  const title = eventId ? '编辑日程' : '新建日程'
  return (
    <Modal open={open} title={title} onClose={onClose}>
      {!form ? (
        <p className="py-6 text-center text-sm text-muted">{isLoading ? '加载中…' : '找不到这条日程'}</p>
      ) : (
        <form onSubmit={onSubmit} className="max-h-[70dvh] space-y-4 overflow-y-auto px-0.5 pb-1" noValidate>
          {existing?.repeat && (
            <Alert tone="info">
              <span className="inline-flex items-center gap-1">
                <RepeatIcon size={14} /> 这是重复日程，修改和删除会应用到全部重复。
              </span>
            </Alert>
          )}
          <TextField label="标题" value={form.title} onChange={(e) => set('title', e.target.value)} error={errors.title} placeholder="比如：和老王开会" autoFocus={!eventId} />

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-fg-2">全天</span>
            <Switch checked={form.allDay} onChange={(v) => set('allDay', v)} label="全天" />
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div>
              <FieldLabel htmlFor={ids.start}>开始</FieldLabel>
              <input id={ids.start} type="date" className={inputCls} value={form.startDate} onChange={(e) => e.target.value && set('startDate', e.target.value)} />
            </div>
            {!form.allDay && (
              <div className="self-end">
                <input type="time" aria-label="开始时间" className={inputCls} value={form.startTime} onChange={(e) => e.target.value && set('startTime', e.target.value)} />
              </div>
            )}
            <div>
              <FieldLabel htmlFor={ids.end}>结束</FieldLabel>
              <input id={ids.end} type="date" className={cn(inputCls, errors.endDate && 'border-danger')} value={form.endDate} min={form.startDate} onChange={(e) => e.target.value && set('endDate', e.target.value)} />
            </div>
            {!form.allDay && (
              <div className="self-end">
                <input type="time" aria-label="结束时间" className={cn(inputCls, errors.endTime && 'border-danger')} value={form.endTime} onChange={(e) => e.target.value && set('endTime', e.target.value)} />
              </div>
            )}
          </div>
          {(errors.startTime || errors.endTime || errors.endDate) && <p className="-mt-2 px-0.5 text-xs text-danger">{errors.startTime || errors.endTime || errors.endDate}</p>}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel htmlFor={ids.repeat}>重复</FieldLabel>
              <select id={ids.repeat} className={inputCls} value={form.preset} onChange={(e) => set('preset', e.target.value as Form['preset'])}>
                {(Object.keys(PRESET_LABEL) as RepeatPreset[]).map((p) => (
                  <option key={p} value={p}>
                    {PRESET_LABEL[p]}
                  </option>
                ))}
                {form.customRepeat && <option value="custom">{describeRepeat(form.customRepeat, form.startDate)}</option>}
              </select>
            </div>
            {form.preset !== 'none' && (
              <div>
                <FieldLabel htmlFor={ids.until}>重复到</FieldLabel>
                <input id={ids.until} type="date" className={inputCls} value={form.until} min={form.startDate} onChange={(e) => set('until', e.target.value)} />
              </div>
            )}
          </div>
          {form.preset !== 'none' && (
            <p className="-mt-2 px-0.5 text-xs text-muted">
              {describeRepeat(toInput(form).repeat ?? null, form.startDate)}
              {!form.until && '，一直重复'}
            </p>
          )}
          {errors.repeat && <p className="-mt-2 px-0.5 text-xs text-danger">{errors.repeat}</p>}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel htmlFor={ids.cal}>日历本</FieldLabel>
              <select id={ids.cal} className={inputCls} value={form.calendarId || calendars?.find((c) => c.isDefault)?.id || ''} onChange={(e) => set('calendarId', e.target.value)}>
                {calendars?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel htmlFor={ids.remind}>提醒</FieldLabel>
              <select id={ids.remind} className={inputCls} value={form.remind} onChange={(e) => set('remind', e.target.value)}>
                <option value="none">不提醒</option>
                {REMINDER_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {REMIND_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {calendars && calendars.length > 1 && (
            <div className="-mt-2 flex flex-wrap gap-1.5 px-0.5">
              {calendars.map((c) => (
                <span key={c.id} className="flex items-center gap-1 text-xs text-muted">
                  <span className={cn('size-2 rounded-full', CAL_COLOR[c.color].dot)} />
                  {c.name}
                </span>
              ))}
            </div>
          )}

          <TextField label="地点" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="选填" />
          <div>
            <FieldLabel>备注</FieldLabel>
            <textarea className={cn(inputCls, 'min-h-20 resize-y')} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="选填" aria-label="备注" />
          </div>

          <div className="flex gap-2 pt-1">
            {eventId && (
              <Button
                variant="ghost"
                className="text-danger"
                onClick={async () => {
                  await remove.mutateAsync(eventId)
                  onClose()
                }}
                aria-label="删除日程"
              >
                <Trash2 size={18} />
              </Button>
            )}
            <Button type="submit" block loading={create.isPending || update.isPending}>
              保存
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
