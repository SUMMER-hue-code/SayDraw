// 画布面板(侧栏):图片预览 + 蒙版笔迹预览;蒙版编辑一律进大窗口编辑器

import { useChatStore } from '../stores/chat'
import { useCanvasStore } from '../stores/canvas'
import { useViewerStore } from '../stores/viewer'
import MaskStage from './MaskStage'
import { usedBrushIds } from '../lib/mask'

export default function ImageCanvas() {
  const baseAssetId = useCanvasStore((s) => s.baseAssetId)
  const assets = useChatStore((s) => s.assets)
  const brushMode = useCanvasStore((s) => s.brushMode)
  const setBrushMode = useCanvasStore((s) => s.setBrushMode)
  const strokes = useCanvasStore((s) => s.strokes)
  const clearStrokes = useCanvasStore((s) => s.clearStrokes)
  const maskDataUrl = useCanvasStore((s) => s.maskDataUrl)
  const setEditorOpen = useCanvasStore((s) => s.setEditorOpen)
  const promote = useChatStore((s) => s.promote)

  const asset = baseAssetId ? assets[baseAssetId] : null

  if (!asset) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-[#15171c]">
        <header className="border-b border-zinc-800/80 px-3 py-2">
          <h2 className="text-xs font-semibold tracking-wide text-zinc-300">🖼 画布</h2>
        </header>
        <div className="flex h-40 items-center justify-center p-2 text-center text-[11px] text-zinc-600">
          生成 / 上传的图片会显示在这里,点击聊天中的图片即可载入
        </div>
      </section>
    )
  }

  const usedIds = usedBrushIds(strokes)

  return (
    <section className="rounded-xl border border-zinc-800 bg-[#15171c]">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 px-3 py-2">
        <h2 className="mr-auto text-xs font-semibold tracking-wide text-zinc-300">🖼 画布</h2>
        {asset.draft && (
          <button
            className="rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-medium text-black hover:bg-amber-300"
            title="把这张候选设为正式版本(其余同批候选保持待选)"
            onClick={() => void promote(asset.id)}
          >
            ✓ 选用这张
          </button>
        )}
        {brushMode && maskDataUrl && (
          <button className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800" onClick={clearStrokes} disabled={!strokes.length}>
            清除蒙版
          </button>
        )}
        <button
          className={`rounded-lg px-2.5 py-1 text-[11px] ${brushMode ? 'bg-emerald-600 text-white' : 'border border-zinc-700 text-zinc-300 hover:border-emerald-500 hover:text-emerald-300'}`}
          title={brushMode ? '蒙版编辑中:点击打开大窗口编辑器' : '涂抹蒙版:在大窗口编辑器中精细标注修改区域(支持编号画笔多处修改)'}
          onClick={() => {
            setBrushMode(true)
            setEditorOpen(true)
          }}
        >
          🖌 {maskDataUrl ? `蒙版${usedIds.length ? ` · ${usedIds.length} 处` : ''} · 编辑` : '涂抹蒙版'}
        </button>
      </header>

      <div
        className="p-2"
        onContextMenu={(e) => {
          if (asset && asset.kind !== 'mask') {
            e.preventDefault()
            void window.api.assets.contextMenu(asset.id)
          }
        }}
        onDoubleClick={() => {
          if (asset && asset.kind !== 'mask') useViewerStore.getState().open(asset.id)
        }}
        title={asset ? '双击放大查看 · 右键复制/另存为' : undefined}
      >
        <MaskStage asset={asset} mode="view" maxH={380} />
      </div>

      {maskDataUrl && (
        <p className="border-t border-zinc-800/80 px-3 py-2 text-[11px] text-amber-400/90">
          🖌 蒙版已就绪{usedIds.length > 1 ? `(编号 ${usedIds.join('、')} 共 ${usedIds.length} 处)` : ''}:在输入框描述
          {usedIds.length > 1 ? '每个编号' : ''}要改成什么,发送时自动附带
        </p>
      )}
    </section>
  )
}
