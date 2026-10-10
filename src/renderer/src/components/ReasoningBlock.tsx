import { useState } from 'react'
import type { MessageBlock } from '@shared/types'
import { fmtDuration } from '../lib/format'

/** 思考块最后一条非空行(流式尾行,折叠态实时展示) */
function tailLine(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim())
  const last = lines[lines.length - 1] ?? ''
  return last.length > 80 ? `${last.slice(0, 80)}…` : last
}

/**
 * 思考过程块:默认折叠(生成中也折叠),头部单行流式展示最后一行思考;
 * 展开才见全文;耗时只在真正"思考中"的块(最后一个未封口块)上跳动
 */
export default function ReasoningBlock({ block, live, now }: { block: MessageBlock; live: boolean; now: number }) {
  // 默认折叠(含生成中);手动切换后 sticky
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? false
  const isLive = live && block.endedAt === undefined
  const duration = isLive
    ? now - (block.startedAt ?? now)
    : block.endedAt !== undefined
      ? block.endedAt - (block.startedAt ?? block.endedAt)
      : 0
  const text = block.text ?? ''

  return (
    <div className="text-xs">
      <button
        className="group flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-zinc-800/40"
        onClick={() => setManual(!open)}
        title={open ? '收起思考全文' : '展开思考全文'}
      >
        <span className={`text-[11px] ${isLive ? 'animate-pulse text-violet-400' : 'text-zinc-500'}`}>💡</span>
        <span className={`shrink-0 font-medium ${isLive ? 'text-zinc-300' : 'text-zinc-400'}`}>{isLive ? '思考中' : '已思考'}</span>
        <span className="shrink-0 tabular-nums text-[10px] text-zinc-500">{fmtDuration(duration)}</span>
        {/* 折叠态:单行流式尾行 */}
        {!open && (
          <span className="min-w-0 flex-1 truncate text-[11px] leading-none text-zinc-500">
            {text.trim() ? tailLine(text) : isLive ? '…' : ''}
          </span>
        )}
        {open && <span className="flex-1" />}
        <span className={`shrink-0 text-[10px] text-zinc-500 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <pre className="mt-1 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-zinc-800/30 px-3 py-2 text-[12px] leading-relaxed text-zinc-400">
          {text || '(思考内容为空)'}
        </pre>
      )}
    </div>
  )
}
