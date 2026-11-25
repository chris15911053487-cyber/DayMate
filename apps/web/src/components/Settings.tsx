import { useEffect, useId, useState, type FormEvent } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { CALENDAR_COLORS, zonedParts, type CalendarColor, type CalendarInfo, type Me } from '@daymate/shared'
import { api, ApiError } from '../api/client'
import { useCalendarMutations, useCalendars } from '../api/queries'
import { auth, useAuth } from '../auth/store'
import { Alert, Button, cn, inputCls } from '../ui'
import { toast } from '../ui/toast'
import { CAL_COLOR } from './calendar/colors'

const TIMEZONES: [string, string][] = [
  ['Asia/Shanghai', '北京时间'],
  ['Asia/Hong_Kong', '香港'],
  ['Asia/Taipei', '台北'],
  ['Asia/Tokyo', '东京'],
  ['Asia/Seoul', '首尔'],
  ['Asia/Singapore', '新加坡'],
  ['Asia/Bangkok', '曼谷'],
  ['Asia/Dubai', '迪拜'],
  ['Europe/London', '伦敦'],
  ['Europe/Paris', '巴黎'],
  ['Europe/Berlin', '柏林'],
  ['America/New_York', '纽约'],
  ['America/Chicago', '芝加哥'],
  ['America/Los_Angeles', '洛杉矶'],
  ['America/Vancouver', '温哥华'],
  ['Australia/Sydney', '悉尼'],
  ['Pacific/Auckland', '奥克兰'],
]

const tzLabel = (tz: string) => TIMEZONES.find(([id]) => id === tz)?.[1] ?? tz
const nowIn = (tz: string) => zonedParts(Date.now(), tz).time

/** 时区：日程、提醒都按它显示；检测到设备时区不同时提示切换 */
export function TimezoneSetting() {
  const { user } = useAuth()
  const id = useId()
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!user) return null
  const options = TIMEZONES.some(([z]) => z === user.timezone) ? TIMEZONES : [[user.timezone, user.timezone] as [string, string], ...TIMEZONES]

  async function change(tz: string) {
    try {
      auth.setUser(await api<Me>('/me', { method: 'PATCH', body: { timezone: tz } }))
      toast(`已切换到${tzLabel(tz)}时间`)
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '保存失败')
    }
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center gap-3">
        <label htmlFor={id} className="flex-1 text-[15px]">
          时区
        </label>
        <select id={id} className={cn(inputCls, 'w-auto py-1.5 text-sm')} value={user.timezone} onChange={(e) => change(e.target.value)}>
          {options.map(([tz, name]) => (
            <option key={tz} value={tz}>
              {name}（现在 {nowIn(tz)}）
            </option>
          ))}
        </select>
      </div>
      {device && device !== user.timezone && (
        <Alert
          tone="info"
          action={
            <button type="button" className="shrink-0 font-medium underline" onClick={() => change(device)}>
              切换
            </button>
          }
        >
          这台设备在{tzLabel(device)}时区（现在 {nowIn(device)}），和设置的不一样。
        </Alert>
      )}
    </div>
  )
}

function ColorPicker({ value, onChange }: { value: CalendarColor; onChange: (c: CalendarColor) => void }) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="颜色">
      {CALENDAR_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={CAL_COLOR[c].label}
          onClick={() => onChange(c)}
          className={cn('flex size-6 items-center justify-center rounded-full text-primary-fg', CAL_COLOR[c].dot, value === c && 'ring-2 ring-fg/30 ring-offset-2 ring-offset-surface')}
        >
          {value === c && <Check size={12} strokeWidth={3} />}
        </button>
      ))}
    </div>
  )
}

function CalendarRow({ cal }: { cal: CalendarInfo }) {
  const { update, remove } = useCalendarMutations()
  const [name, setName] = useState(cal.name)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => setName(cal.name), [cal.name])
  useEffect(() => {
    if (!confirming) return
    const t = window.setTimeout(() => setConfirming(false), 3000)
    return () => window.clearTimeout(t)
  }, [confirming])

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-center gap-2">
        <input
          value={name}
          maxLength={20}
          aria-label="日历本名称"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== cal.name && update.mutate({ id: cal.id, patch: { name: name.trim() } })}
          className="min-w-0 flex-1 rounded-control bg-transparent px-1 py-1 text-[15px] outline-none focus:bg-surface-2"
        />
        {cal.isDefault ? (
          <span className="text-xs text-muted">默认</span>
        ) : (
          <button
            type="button"
            onClick={() => (confirming ? remove.mutate(cal.id) : setConfirming(true))}
            className={cn('flex items-center gap-1 rounded-control px-2 py-1 text-xs', confirming ? 'bg-danger text-primary-fg' : 'text-muted hover:text-danger')}
          >
            <Trash2 size={13} />
            {confirming && '再点一次删除（里面的日程一起删）'}
          </button>
        )}
      </div>
      <ColorPicker value={cal.color} onChange={(color) => update.mutate({ id: cal.id, patch: { color } })} />
    </li>
  )
}

/** 日历本：工作、生活……各有颜色 */
export function CalendarsSetting() {
  const { data: calendars = [] } = useCalendars()
  const { create } = useCalendarMutations()
  const [name, setName] = useState('')
  const [color, setColor] = useState<CalendarColor>('accent')

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    await create.mutateAsync({ name: name.trim(), color })
    setName('')
  }

  return (
    <div className="card">
      <ul className="divide-y divide-line">
        {calendars.map((c) => (
          <CalendarRow key={c.id} cal={c} />
        ))}
      </ul>
      <form onSubmit={add} className="space-y-2 border-t border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Plus size={16} className="shrink-0 text-muted" />
          <input
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            placeholder="新建日历本，比如：工作"
            aria-label="新日历本名称"
            className="min-w-0 flex-1 bg-transparent py-1 text-[15px] outline-none placeholder:text-muted"
          />
          <Button type="submit" className="px-3 py-1 text-sm" disabled={!name.trim()} loading={create.isPending}>
            添加
          </Button>
        </div>
        <ColorPicker value={color} onChange={setColor} />
      </form>
    </div>
  )
}
