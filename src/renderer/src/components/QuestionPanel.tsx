// ask_user 问答面板:Agent 挂起的选择题,选项按钮作答(推荐项标识),支持自由输入

import { useState } from 'react'
import type { AgentQuestionOption } from '@shared/types'
import { useChatStore } from '../stores/chat'

export default function QuestionPanel() {
  const sessionId = useChatStore((s) => s.sessionId)
  const pending = useChatStore((s) => (s.sessionId ? s.pendingQuestionBySession[s.sessionId] : undefined))
  const [freeText, setFreeText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!sessionId || !pending) return null
  const q = pending.question

  const answer = async (text: string): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    try {
      await window.api.chat.answerQuestion(sessionId, q.id, text)
      setFreeText('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mb-2 rounded-2xl border border-violet-500/50 bg-violet-500/10 px-4 py-3">
      <div className="mb-2.5 flex items-start gap-2">
        <span className="text-base">❓</span>
        <p className="text-sm font-medium leading-relaxed text-zinc-100">{q.text}</p>
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {q.options.map((opt) => (
          <OptionButton key={opt.label} opt={opt} disabled={submitting} onPick={() => void answer(opt.label)} />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && freeText.trim()) void answer(freeText.trim())
          }}
          placeholder="其他答案(自由输入)…"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600"
        />
        <button
          className="rounded-lg border border-violet-500/60 px-3 py-1.5 text-xs text-violet-300 hover:bg-violet-500/15 disabled:opacity-40"
          disabled={submitting || !freeText.trim()}
          onClick={() => void answer(freeText.trim())}
        >
          提交
        </button>
      </div>
    </div>
  )
}

function OptionButton({ opt, disabled, onPick }: { opt: AgentQuestionOption; disabled: boolean; onPick: () => void }) {
  return (
    <button
      className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
        opt.recommended
          ? 'border-violet-500 bg-violet-500/15 hover:bg-violet-500/25'
          : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-500'
      }`}
      disabled={disabled}
      onClick={onPick}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-zinc-100">{opt.label}</span>
        {opt.description && <span className="mt-0.5 block text-[11px] leading-snug text-zinc-400">{opt.description}</span>}
      </span>
      {opt.recommended && (
        <span className="shrink-0 rounded-full bg-violet-500/25 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">⭐ 推荐</span>
      )}
    </button>
  )
}
