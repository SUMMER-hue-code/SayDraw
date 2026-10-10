import { useState } from 'react'
import type { ToolCallRecord } from '@shared/types'
import { fmtDuration, statusIcon, toolMeta } from '../lib/format'

/** 状态 → 左侧垂直色条颜色 */
const TONE_BAR: Record<ToolCallRecord['status'], string> = {
  running: 'bg-emerald-400',
  ok: 'bg-emerald-500',
  error: 'bg-red-500',
  rejected: 'bg-amber-500'
}

/**
 * 工具调用行:简约设计——左侧垂直短色条(状态色)+ 单行信息,无半包围卡片;
 * 点击展开参数与完整结果
 */
export default function ToolCard({ call, now }: { call: ToolCallRecord; now: number }) {
  const [expanded, setExpanded] = useState(false)
  const meta = toolMeta(call.name)
  const running = call.status === 'running'
  const duration = running && call.startedAt ? now - call.startedAt : call.durationMs

  const iconCls =
    call.status === 'error'
      ? 'text-red-400'
      : call.status === 'ok'
        ? 'text-emerald-400'
        : call.status === 'rejected'
          ? 'text-amber-400'
          : 'text-zinc-400'

  const resultSummary = running ? '执行中…' : (call.resultSummary ?? '').split('\n')[0]

  return (
    <div className="-mx-1 rounded-md px-1 hover:bg-zinc-800/30">
      <button
        className="flex w-full items-center gap-2 py-1 text-left text-xs"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* 垂直开头色条(状态色,直角简约) */}
        <span className={`h-4 w-[3px] shrink-0 rounded-[1px] ${TONE_BAR[call.status]}`} />
        <span className={`w-4 shrink-0 text-center ${iconCls}`}>
          {running ? <span className="inline-block animate-spin">◌</span> : statusIcon(call)}
        </span>
        <span className="shrink-0 font-medium text-zinc-200">{meta.label}</span>
        <span className="min-w-0 shrink truncate font-mono text-[11px] text-zinc-500">{meta.summarize(call.args)}</span>
        {!running && resultSummary && <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">→ {resultSummary}</span>}
        {running && <span className="flex-1" />}
        {duration !== undefined && <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">{fmtDuration(duration)}</span>}
        <span className={`shrink-0 text-[10px] text-zinc-500 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}>›</span>
      </button>

      {expanded && (
        <div className="mb-1 ml-[11px] space-y-2 border-l border-zinc-800 pl-3">
          <section>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">参数</p>
            <pre className="max-h-40 overflow-auto rounded-md bg-zinc-900/80 p-2 font-mono text-[11px] leading-relaxed text-zinc-300">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </section>
          {(call.resultFull || call.error) && (
            <section>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">结果</p>
              <pre
                className={`max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-900/80 p-2 font-mono text-[11px] leading-relaxed ${
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
