import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Info, MessageCircle, RotateCcw, Sparkles } from 'lucide-react'
import type { CommitResult, ParseResult } from '@daymate/shared'
import { api, ApiError } from '../api/client'
import { Alert, Button, Modal, cn, inputCls } from '../ui'
import { toast } from '../ui/toast'
import { useToday } from '../utils/datetime'
import { closeAssistant, useAssistant } from './assistant'
import { DraftCard, type CardItem } from './DraftCard'
import { VoiceButton } from './VoiceButton'

/** 卡片初始值：带时间的日程没说提醒就用默认 15 分钟，界面上直接看得到 */
function toCards(r: ParseResult): CardItem[] {
  return r.items
    .filter((i): i is CardItem => i.type !== 'query')
    .map((i) => (i.type === 'event' && i.remindBeforeMin == null ? { ...i, remindBeforeMin: i.allDay || !i.startTime ? [] : [15] } : i))
}

/**
 * 助手面板（docs/技术方案.md 6.3）：上面是"我听到的"（可改），下面是 AI 拆出的卡片（可改、可删、可换类型），
 * 全部保存后一次提交。提问直接显示回答。
 */
export function AssistantSheet() {
  const a = useAssistant()
  const today = useToday()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [voiceLogId, setVoiceLogId] = useState<string | null>(null)
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('text')
  const [parsedText, setParsedText] = useState<string | null>(null)
  const [result, setResult] = useState<ParseResult | null>(null)
  const [cards, setCards] = useState<CardItem[]>([])
  const [busy, setBusy] = useState<'parse' | 'save' | null>(null)
  const [error, setError] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)

  async function runParse(t: string, mode: 'voice' | 'text', logId: string | null) {
    if (!t.trim()) return
    setBusy('parse')
    setError('')
    try {
      const r = await api<ParseResult>('/assistant/parse', { method: 'POST', body: { text: t, inputMode: mode, voiceLogId: logId } })
      setResult(r)
      setCards(toCards(r))
      setParsedText(t)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '出错了，请稍后再试')
    } finally {
      setBusy(null)
    }
  }

  // 每次打开：重置；语音进来的直接解析，打字的聚焦输入框
  useEffect(() => {
    if (!a.open) return
    setText(a.text)
    setVoiceLogId(a.voiceLogId)
    setInputMode(a.inputMode)
    setResult(null)
    setCards([])
    setParsedText(null)
    setError('')
    if (a.text) void runParse(a.text, a.inputMode, a.voiceLogId)
    else window.setTimeout(() => textRef.current?.focus(), 50)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.seq, a.open])

  async function save() {
    if (!cards.length) return
    setBusy('save')
    setError('')
    try {
      const items = cards.map(({ conflicts: _c, ...rest }) => rest)
      const r = await api<CommitResult>('/assistant/commit', {
        method: 'POST',
        body: { items, inputMode, voiceLogId, finalText: inputMode === 'voice' ? text : null },
      })
      await Promise.all(['events', 'today', 'tasks', 'entries', 'search'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast(`已保存：${r.created.map((c) => c.title).join('、')}`)
      closeAssistant()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败，请稍后再试')
    } finally {
      setBusy(null)
    }
  }

  const onSubmitText = (e: FormEvent) => {
    e.preventDefault()
    void runParse(text, inputMode, voiceLogId)
  }
  const edited = parsedText !== null && text.trim() !== parsedText.trim()

  return (
    <Modal open={a.open} title={inputMode === 'voice' ? '我听到的' : '说点什么'} onClose={closeAssistant}>
      <div className="max-h-[72dvh] space-y-3 overflow-y-auto px-0.5 pb-1">
        <form onSubmit={onSubmitText} className="space-y-2">
          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) onSubmitText(e)
            }}
            rows={2}
            maxLength={1000}
            aria-label="要说的话"
            placeholder="比如：明天下午三点和老王开会，提前半小时提醒我"
            className={cn(inputCls, 'resize-none text-[16px] leading-relaxed')}
          />
          <div className="flex items-center gap-2">
            <VoiceButton
              size="sm"
              className="shadow-none ring-0"
              onText={(r) => {
                // 接着说：文字接在后面，整段重新理解（一次最长 60 秒，长内容分几段说）
                const joined = text.trim() ? `${text.trim()}${/[。！？.!?，,]$/.test(text.trim()) ? '' : '，'}${r.text}` : r.text
                setText(joined)
                setVoiceLogId(r.voiceLogId)
                setInputMode('voice')
                void runParse(joined, 'voice', r.voiceLogId)
              }}
              onTap={() => textRef.current?.focus()}
            />
            <span className="text-xs text-muted">{text.trim() ? '按住接着说' : '按住说话'}</span>
            {(parsedText === null || edited) && (
              <Button type="submit" className="ml-auto px-3 py-1.5 text-sm" loading={busy === 'parse'} disabled={!text.trim()}>
                {edited ? (
                  <>
                    <RotateCcw size={14} /> 重新理解
                  </>
                ) : (
                  <>
                    <Sparkles size={14} /> 交给 AI
                  </>
                )}
              </Button>
            )}
          </div>
        </form>

        {busy === 'parse' && (
          <div className="space-y-2" aria-label="正在理解">
            {[0, 1].map((i) => (
              <div key={i} className="card h-24 animate-pulse bg-surface-2" />
            ))}
          </div>
        )}
        {error && <Alert tone="error">{error}</Alert>}

        {result && busy !== 'parse' && (
          <>
            {result.answer && (
              <div className="card flex gap-2.5 p-3.5">
                <MessageCircle size={18} className="mt-0.5 shrink-0 text-primary" />
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{result.answer}</p>
              </div>
            )}
            {result.fallback ? (
              <Alert tone="info">{result.reply}</Alert>
            ) : (
              result.reply && cards.length > 0 && <p className="px-1 text-sm text-fg-2">{result.reply}</p>
            )}
            {result.assumptions.length > 0 && (
              <ul className="space-y-1 px-1">
                {result.assumptions.map((s) => (
                  <li key={s} className="flex items-start gap-1.5 text-xs text-muted">
                    <Info size={13} className="mt-px shrink-0" /> {s}
                  </li>
                ))}
              </ul>
            )}
            {cards.map((c, i) => (
              <DraftCard
                key={i}
                item={c}
                today={today}
                onChange={(next) => setCards((list) => list.map((x, j) => (j === i ? { ...next, conflicts: x.type === 'event' && next.type === 'event' ? x.conflicts : undefined } : x)))}
                onRemove={() => setCards((list) => list.filter((_, j) => j !== i))}
              />
            ))}
            {cards.length > 0 ? (
              <Button block loading={busy === 'save'} onClick={save} disabled={edited}>
                {edited ? '内容改了，先点「重新理解」' : cards.length > 1 ? `全部保存（${cards.length} 条）` : '保存'}
              </Button>
            ) : (
              !result.answer && <p className="py-2 text-center text-sm text-muted">都删掉了。可以重说一遍，或者关掉。</p>
            )}
            {result.answer && cards.length === 0 && (
              <Button block variant="secondary" onClick={closeAssistant}>
                好的
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
