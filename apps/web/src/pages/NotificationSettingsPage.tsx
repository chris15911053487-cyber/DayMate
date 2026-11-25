import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BellRing, Mail, Smartphone } from 'lucide-react'
import { REMINDER_OPTIONS, type SettingsPatch, type UserSettings } from '@daymate/shared'
import { api, ApiError } from '../api/client'
import { useSaveSettings, useSettings } from '../api/queries'
import { useAuth } from '../auth/store'
import { disablePush, enablePush, pushCapability, type PushCapability } from '../push/device'
import { Alert, Button, Switch, cn, inputCls } from '../ui'
import { toast } from '../ui/toast'

const REMIND_LABEL: Record<number, string> = { 0: '准时', 5: '提前 5 分钟', 15: '提前 15 分钟', 30: '提前 30 分钟', 60: '提前 1 小时', 120: '提前 2 小时', 1440: '提前 1 天' }

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[15px]">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

/** 这台设备的浏览器推送：显示能不能用、为什么不能用，一键开关 */
function DevicePush() {
  const qc = useQueryClient()
  const [cap, setCap] = useState<PushCapability | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = () => pushCapability().then(setCap)
  useEffect(() => {
    void refresh()
  }, [])

  async function toggle(on: boolean) {
    setBusy(true)
    try {
      if (on) await enablePush()
      else await disablePush()
      toast(on ? '这台设备已开启推送' : '这台设备已关闭推送')
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  return (
    <div className="card divide-y divide-line">
      <Row label="这台设备的推送通知" hint={cap?.state === 'subscribed' ? '已开启，锁屏也能收到提醒' : '开启后，提醒会以系统通知弹出'}>
        {cap && (cap.state === 'available' || cap.state === 'subscribed') ? (
          <Switch label="这台设备的推送通知" checked={cap.state === 'subscribed'} onChange={(v) => !busy && toggle(v)} />
        ) : (
          <Smartphone size={18} className="text-muted" />
        )}
      </Row>
      {cap && 'reason' in cap && (
        <div className="px-4 py-3">
          <Alert tone="info">{cap.reason}</Alert>
        </div>
      )}
      <div className="px-4 py-3">
        <Button
          variant="secondary"
          block
          onClick={async () => {
            try {
              await api('/push/test', { method: 'POST' })
              toast('已发送测试通知，看看收到没有')
              void qc.invalidateQueries({ queryKey: ['notifications'] })
            } catch (err) {
              toast(err instanceof ApiError ? err.message : '发送失败')
            }
          }}
        >
          <BellRing size={16} /> 发一条测试通知
        </Button>
      </div>
    </div>
  )
}

export function NotificationSettingsPage() {
  const { user } = useAuth()
  const { data: s } = useSettings()
  const save = useSaveSettings()
  if (!s || !user) return <p className="py-10 text-center text-sm text-muted">加载中…</p>
  const set = (patch: SettingsPatch) => save.mutate(patch)
  const time = (value: string, onChange: (v: string) => void, label: string, disabled?: boolean) => (
    <input type="time" aria-label={label} disabled={disabled} className={cn(inputCls, 'w-auto py-1.5 text-sm disabled:opacity-50')} value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
  )
  const channel = (group: keyof UserSettings['channels'], ch: 'webpush' | 'email', label: string) => (
    <Switch label={label} checked={s.channels[group][ch]} onChange={(v) => set({ channels: { [group]: { [ch]: v } } })} />
  )

  return (
    <div className="space-y-6">
      <h1 className="display px-1 text-[22px]">提醒与推送</h1>

      <section className="space-y-2">
        <h2 className="display px-1 text-base">这台设备</h2>
        <DevicePush />
      </section>

      <section className="space-y-2">
        <h2 className="display px-1 text-base">怎么通知我</h2>
        <div className="card divide-y divide-line">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-5 px-4 pb-1 pt-3 text-xs text-muted">
            <span />
            <span className="flex items-center gap-1"><BellRing size={12} />推送</span>
            <span className="flex items-center gap-1"><Mail size={12} />邮件</span>
          </div>
          {([['reminder', '日程和待办提醒'], ['brief', '早报和晚间复盘']] as const).map(([g, label]) => (
            <div key={g} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-5 px-4 py-3">
              <span className="text-[15px]">{label}</span>
              {channel(g, 'webpush', `${label}：推送`)}
              {channel(g, 'email', `${label}：邮件`)}
            </div>
          ))}
          <p className="px-4 py-3 text-xs leading-relaxed text-muted">
            站内消息总会保留。邮件发到 {user.email}
            {!user.emailVerified && '（邮箱还没验证，验证后才会发）'}。
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="display px-1 text-base">AI 早报与晚间复盘</h2>
        <div className="card divide-y divide-line">
          <Row label="早报" hint="今天的安排、待办和建议">
            {time(s.morningBrief.time, (v) => set({ morningBrief: { ...s.morningBrief, time: v } }), '早报时间', !s.morningBrief.enabled)}
            <Switch label="早报" checked={s.morningBrief.enabled} onChange={(v) => set({ morningBrief: { ...s.morningBrief, enabled: v } })} />
          </Row>
          <Row label="晚间复盘" hint="回顾今天、给明天的建议">
            {time(s.eveningReview.time, (v) => set({ eveningReview: { ...s.eveningReview, time: v } }), '复盘时间', !s.eveningReview.enabled)}
            <Switch label="晚间复盘" checked={s.eveningReview.enabled} onChange={(v) => set({ eveningReview: { ...s.eveningReview, enabled: v } })} />
          </Row>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="display px-1 text-base">其他</h2>
        <div className="card divide-y divide-line">
          <Row label="免打扰" hint="这段时间不推送早报和建议；你自己设的日程提醒照常">
            <Switch label="免打扰" checked={s.quietHours.enabled} onChange={(v) => set({ quietHours: { ...s.quietHours, enabled: v } })} />
          </Row>
          {s.quietHours.enabled && (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-fg-2">
              从 {time(s.quietHours.start, (v) => set({ quietHours: { ...s.quietHours, start: v } }), '免打扰开始')} 到 {time(s.quietHours.end, (v) => set({ quietHours: { ...s.quietHours, end: v } }), '免打扰结束')}
            </div>
          )}
          <Row label="新日程默认提醒" hint="语音、文字新建日程时用">
            <select aria-label="新日程默认提醒" className={cn(inputCls, 'w-auto py-1.5 text-sm')} value={s.defaultRemindMin} onChange={(e) => set({ defaultRemindMin: Number(e.target.value) })}>
              {REMINDER_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {REMIND_LABEL[m]}
                </option>
              ))}
            </select>
          </Row>
        </div>
      </section>
    </div>
  )
}
