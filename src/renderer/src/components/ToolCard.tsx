import { useState } from 'react'
import type { ToolCallRecord } from '@shared/types'
import { fmtDuration, statusIcon, toolMeta } from '../lib/format'

/**
 * 工具调用卡片:默认折叠的单行卡;展开显示参数与完整结果
 * 折叠行:[状态图标] 标签 参数摘要 → 结果摘要 · 耗时 ›
 */
export default function ToolCard({ call, now }: { call: ToolCallRecord; now: number }) {
  const [expanded, setExpanded] = useState(false)
  const meta = toolMeta(call.name)
  const running = call.status === 'running'
  const duration = running && call.startedAt ? now - call.startedAt : call.durationMs

  const toneCls =
    call.status === 'error'
      ? 'border-l-2 border-l-red-500'
      : call.status === 'rejected'
        ? 'border-l-2 border-l-amber-500'
        : call.status === 'ok' && (meta.kind === 'write' || meta.kind === 'image' || meta.kind === 'brief')
          ? 'border-l-2 border-l-emerald-500'
          : 'border-l-2 border-l-transparent'

  const iconCls =
    call.status === 'error' ? 'text-red-400' : call.status === 'ok' ? 'text-emerald-400' : call.status === 'rejected' ? 'text-amber-400' : 'text-zinc-400'

  const resultSummary = running ? '执行中…' : (call.resultSummary ?? '').split('\n')[0]

  return (
    <div className={`w-full overflow-hidden rounded-lg bg-zinc-800/50 ${toneCls}`}>
      <button
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-zinc-800"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={`w-4 shrink-0 text-center ${iconCls}`}>
          {running ? <span className="inline-block animate-spin">◌</span> : statusIcon(call)}
        </span>
        <span className="shrink-0 font-medium text-zinc-200">{meta.label}</span>
        <span className="min-w-0 shrink truncate font-mono text-[11px] text-zinc-400">{meta.summarize(call.args)}</span>
        {!running && resultSummary && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">→ {resultSummary}</span>
        )}
        {running && <span className="flex-1" />}
        {duration !== undefined && <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">{fmtDuration(duration)}</span>}
        <span className={`shrink-0 text-zinc-500 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}>›</span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-zinc-700/60 px-3 py-2">
          <section>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">参数</p>
            <pre className="max-h-40 overflow-auto rounded bg-zinc-900/80 p-2 font-mono text-[11px] leading-relaxed text-zinc-300">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </section>
          {(call.resultFull || call.error) && (
            <section>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">结果</p>
              <pre
                className={`max-h-56 overflow-auto whitespace-pre-wrap rounded bg-zinc-900/80 p-2 font-mono text-[11px] leading-relaxed ${
                  call.status === 'error' ? 'text-red-300' : 'text-zinc-300'
                }`}
              >
                {call.resultFull ?? call.error}
              </pre>
            </section>
          )}
          {call.assetIds && call.assetIds.length > 0 && (
            <p className="text-[10px] text-zinc-500">产出资产:{call.assetIds.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  )
}
