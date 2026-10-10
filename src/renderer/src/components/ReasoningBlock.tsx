import { useState } from 'react'
import type { MessageBlock } from '@shared/types'
import { fmtDuration } from '../lib/format'

/**
 * 思考过程块:生成中默认展开,结束后自动折叠;手动切换后不再自动改变
 * 头部:💡 思考中/已思考 · 耗时
 */
export default function ReasoningBlock({ block, live, now }: { block: MessageBlock; live: boolean; now: number }) {
  // null = 未手动干预;lve 时展开、结束后折叠;手动切换后 sticky
  const [manual, setManual] = useState<boolean | null>(null)
  const isLive = live && block.endedAt === undefined
  const open = manual ?? isLive
  const duration = isLive ? now - (block.startedAt ?? now) : (block.endedAt ?? now) - (block.startedAt ?? now)

  return (
    <div className={`w-full border-l-2 pl-3 text-xs ${isLive ? 'border-l-violet-500' : 'border-l-zinc-700'}`}>
      <button className="flex items-center gap-1.5 py-0.5 text-zinc-400 hover:text-zinc-300" onClick={() => setManual(!open)}>
        <span className={`text-[11px] ${isLive ? 'animate-pulse text-violet-400' : 'text-zinc-500'}`}>💡</span>
        <span className="font-medium">{isLive ? '思考中' : '已思考'}</span>
        <small className="tabular-nums text-[10px] text-zinc-500">{fmtDuration(duration)}</small>
        <span className={`text-[10px] text-zinc-500 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <pre className="mt-1 max-h-80 overflow-y-auto whitespace-pre-wrap pb-1 text-[12px] leading-relaxed text-zinc-400">
          {block.text || '(思考内容为空)'}
        </pre>
      )}
    </div>
  )
}
