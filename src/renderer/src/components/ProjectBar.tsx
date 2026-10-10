// 工作目录(项目文件夹)栏:输入框上方
// 未选择时阻断输入(强制),选择后自动初始化 要求.md / 需求规格.md / 素材/ / 生成图片/

import { useCallback, useState } from 'react'
import { useSessionsStore } from '../stores/sessions'

export interface PickResult {
  ok: boolean
  createdFiles?: string[]
  error?: string
}

/** 选择工作目录的共享逻辑(ProjectBar 与 Composer 阻断态共用) */
export function useProjectPicker() {
  const [picking, setPicking] = useState(false)
  const loadSessions = useSessionsStore((s) => s.load)

  const pick = useCallback(
    async (sessionId: string): Promise<PickResult> => {
      if (picking) return { ok: false }
      setPicking(true)
      try {
        const result = await window.api.sessions.selectProject(sessionId)
        if (!result) return { ok: false }
        await loadSessions()
        return { ok: true, createdFiles: result.createdFiles }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        setPicking(false)
      }
    },
    [picking, loadSessions]
  )

  return { pick, picking }
}

export default function ProjectBar() {
  const sessions = useSessionsStore((s) => s.sessions)
  const sessionId = useSessionsStore((s) => s.currentId)
  const session = sessions.find((s) => s.id === sessionId)
  const { pick, picking } = useProjectPicker()
  const [notice, setNotice] = useState('')

  const showNotice = (text: string): void => {
    setNotice(text)
    setTimeout(() => setNotice(''), 5000)
  }

  if (!session) return null

  return (
    <div className="mb-2 flex items-center gap-2 text-[11px]">
      {session.projectPath ? (
        <>
          <button
            className="flex min-w-0 items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-zinc-300 hover:border-violet-500/60"
            title={`${session.projectPath}\n点击重新选择工作目录`}
            onClick={() =>
              void pick(session.id).then((r) => {
                if (r.createdFiles) showNotice(`已初始化:${r.createdFiles.join('、')}`)
                else if (r.error) showNotice(r.error)
              })
            }
            disabled={picking}
          >
            📁 <span className="max-w-[240px] truncate font-medium">{displayName(session.projectPath)}</span>
            <span className="text-zinc-500">· 工作目录</span>
          </button>
          <span className="truncate text-zinc-600" title="产出图片在 生成图片/,素材放 素材/,要求.md 与 需求规格.md 自动维护">
            生成图片/ · 素材/ · 要求.md
          </span>
        </>
      ) : (
        <button
          className="flex items-center gap-1.5 rounded-full border border-dashed border-amber-500/60 px-2.5 py-1 text-amber-400 hover:border-amber-400"
          title="必须选择工作目录后才能对话:图片将存入其中,并自动创建 素材/ 与 生成图片/"
          onClick={() =>
            void pick(session.id).then((r) => {
              if (r.createdFiles) showNotice(`已初始化:${r.createdFiles.join('、')}`)
              else if (r.error) showNotice(r.error)
            })
          }
          disabled={picking}
        >
          📁 {picking ? '选择中…' : '选择工作目录(必须)'}
        </button>
      )}
      {notice && <span className="ml-auto truncate text-emerald-400/80">{notice}</span>}
    </div>
  )
}

function displayName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const base = normalized.split(/[\\/]/).pop() ?? path
  return base || path
}
