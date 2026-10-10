import { BRIEF_SLOTS } from '@shared/types'
import { useChatStore } from '../stores/chat'

export default function BriefPanel() {
  const brief = useChatStore((s) => s.brief)
  const send = useChatStore((s) => s.send)
  const streamingActive = useChatStore((s) => (s.sessionId ? Boolean(s.streamingBySession[s.sessionId]?.active) : false))
  const messages = useChatStore((s) => s.messages)

  const hasSubject = Boolean(brief.subject?.trim())
  const hasRatio = Boolean(brief.aspectRatio?.trim())
  const ready = hasSubject && hasRatio && !brief.confirmedAt
  const empty = messages.length === 0

  return (
    <section className="rounded-xl border border-zinc-800 bg-[#15171c]">
      <header className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-zinc-300">📋 需求规格</h2>
        {brief.confirmedAt ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-400">已确认</span>
        ) : (
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">待确认</span>
        )}
      </header>

      <div className="space-y-1.5 px-3 py-2.5">
        {empty && <p className="py-2 text-center text-[11px] text-zinc-600">开始对话后,AI 会在这里逐步记录需求</p>}
        {BRIEF_SLOTS.map((slot) => {
          const value = brief[slot.key]
          const filled = typeof value === 'string' && value.trim()
          return (
            <div key={slot.key} className="flex items-start gap-2 text-xs">
              <span className={`mt-0.5 w-14 shrink-0 ${slot.required ? 'text-zinc-300' : 'text-zinc-500'}`}>
                {slot.required && <span className="mr-0.5 text-violet-400">*</span>}
                {slot.label}
              </span>
              {filled ? (
                <span className="min-w-0 flex-1 break-words rounded bg-zinc-800/70 px-1.5 py-0.5 text-zinc-200">{value}</span>
              ) : (
                <span className="flex-1 text-zinc-600">{slot.hint}</span>
              )}
            </div>
          )
        })}
      </div>

      <div className="border-t border-zinc-800/80 px-3 py-2.5">
        {brief.confirmedAt ? (
          <p className="text-[11px] leading-relaxed text-zinc-500">需求已确认。生成后如需调整,继续对话即可(重大修改会重新确认)。</p>
        ) : ready ? (
          <button
            disabled={streamingActive}
            className="w-full rounded-lg bg-emerald-600 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
            onClick={() => void send('我确认以上需求摘要,请开始生成图片。', [], true)}
          >
            ✓ 确认需求,开始生成
          </button>
        ) : (
          <p className="text-[11px] leading-relaxed text-zinc-500">
            带星号的槽位补齐后可一键确认;AI 也会主动向你提问补齐需求。
          </p>
        )}
      </div>
    </section>
  )
}
