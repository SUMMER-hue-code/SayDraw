// 蒙版弹窗编辑器:承载完整编辑器(工具/缩放/平移内聚在 MaskStage editor 模式)

import { useEffect } from 'react'
import { useCanvasStore } from '../stores/canvas'
import { useChatStore } from '../stores/chat'
import MaskStage from './MaskStage'

export default function MaskEditorModal() {
  const open = useCanvasStore((s) => s.editorOpen)
  const setEditorOpen = useCanvasStore((s) => s.setEditorOpen)
  const baseAssetId = useCanvasStore((s) => s.baseAssetId)
  const assets = useChatStore((s) => s.assets)
  const asset = baseAssetId ? assets[baseAssetId] : null

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setEditorOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setEditorOpen])

  if (!open || !asset) return null

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-black/85 backdrop-blur-sm">
      <header className="flex items-center gap-3 border-b border-zinc-800 bg-[#15171c] px-4 py-2">
        <span className="text-xs font-medium text-zinc-300">🖌 蒙版编辑器</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500">{asset.id}</span>
        <span className="text-[10px] text-zinc-500">不同编号画笔 = 不同修改位置,发送消息时说明各编号要改什么</span>
        <button
          className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
          onClick={() => setEditorOpen(false)}
        >
          完成
        </button>
      </header>
      <MaskStage asset={asset} mode="editor" />
    </div>
  )
}
