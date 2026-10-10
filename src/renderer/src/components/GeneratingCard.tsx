// 生图等待动画:流光占位卡 + 阶段文案轮换 + 已等待时长

import { useEffect, useState } from 'react'
import { fmtDuration } from '../lib/format'

const PHASES = [
  '正在构思画面…',
  '调用生图服务渲染中…',
  '细节雕琢,大图可能较慢…',
  '即将完成,请稍候…'
]

export default function GeneratingCard(props: { startedAt?: number; label: string; now: number }) {
  const { startedAt, label, now } = props
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 4000)
    return () => clearInterval(timer)
  }, [])

  const elapsed = startedAt ? now - startedAt : 0

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-violet-500/30 bg-zinc-800/40">
      <div className="generating-shimmer flex h-44 flex-col items-center justify-center gap-2">
        <div className="flex items-end gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="block h-2 w-2 rounded-full bg-violet-400"
              style={{ animation: `gen-bounce 1.2s ease-in-out ${i * 0.15}s infinite` }}
            />
          ))}
        </div>
        <p className="text-xs font-medium text-zinc-200">{label} · {PHASES[phase]}</p>
        <p className="text-[10px] tabular-nums text-zinc-500">已等待 {fmtDuration(elapsed)}(超时上限可在设置调整)</p>
      </div>
    </div>
  )
}
