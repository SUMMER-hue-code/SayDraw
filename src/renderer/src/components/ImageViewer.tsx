// 双击打开的全屏图片查看器:滚轮缩放(锚定光标)/ 拖拽平移 / 旋转 / 1:1 / Esc 关闭

import { useCallback, useEffect, useRef, useState } from 'react'
import { assetUrl } from '@shared/ipc'
import { useViewerStore } from '../stores/viewer'
import { useChatStore } from '../stores/chat'

const MIN_SCALE = 0.1
const MAX_SCALE = 12

export default function ImageViewer() {
  const assetId = useViewerStore((s) => s.assetId)
  const close = useViewerStore((s) => s.close)
  const assets = useChatStore((s) => s.assets)
  const asset = assetId ? assets[assetId] : null

  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [rotate, setRotate] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  // 打开新图时重置视图
  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
    setRotate(0)
  }, [assetId])

  // Esc 关闭
  useEffect(() => {
    if (!assetId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [assetId, close])

  // 滚轮缩放(非被动监听以支持 preventDefault),缩放锚定光标
  useEffect(() => {
    const el = containerRef.current
    if (!el || !assetId) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      setScale((prevScale) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prevScale * factor))
        const rect = el.getBoundingClientRect()
        const cx = e.clientX - rect.left - rect.width / 2
        const cy = e.clientY - rect.top - rect.height / 2
        setOffset((prev) => ({
          x: cx - ((cx - prev.x) * next) / prevScale,
          y: cy - ((cy - prev.y) * next) / prevScale
        }))
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [assetId])

  const zoomBy = useCallback((factor: number) => {
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor)))
  }, [])

  if (!asset) return null

  const dragProps = {
    onPointerDown: (e: React.PointerEvent): void => {
      dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: React.PointerEvent): void => {
      const d = dragRef.current
      if (!d) return
      setOffset({ x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) })
    },
    onPointerUp: (): void => {
      dragRef.current = null
    }
  }

  const btn = 'flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-sm text-zinc-200 backdrop-blur hover:bg-black/80'

  return (
    <div className="fixed inset-0 z-[60] select-none bg-black/85 backdrop-blur-sm" onClick={close}>
      <div
        ref={containerRef}
        className="absolute inset-0 flex cursor-grab items-center justify-center overflow-hidden active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={() => {
          // 双击:适配窗口 ↔ 2 倍切换
          setScale((s) => (s >= 1.95 ? 1 : 2))
          setOffset({ x: 0, y: 0 })
        }}
        {...dragProps}
      >
        <img
          src={assetUrl(asset.sessionId, asset.fileName)}
          alt={asset.id}
          draggable={false}
          className="max-h-full max-w-full object-contain will-change-transform"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotate}deg)` }}
        />
      </div>

      {/* 顶部信息 + 右侧工具条 */}
      <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-zinc-300 backdrop-blur">
        {asset.width && asset.height ? `${asset.width} × ${asset.height}` : asset.id} · {Math.round(scale * 100)}%
      </div>
      <div className="absolute right-4 top-1/2 flex -translate-y-1/2 flex-col gap-2" onClick={(e) => e.stopPropagation()}>
        <button className={btn} title="放大" onClick={() => zoomBy(1.25)}>
          +
        </button>
        <button className={btn} title="缩小" onClick={() => zoomBy(0.8)}>
          −
        </button>
        <button
          className={btn}
          title="重置(适配窗口)"
          onClick={() => {
            setScale(1)
            setOffset({ x: 0, y: 0 })
            setRotate(0)
          }}
        >
          ⤢
        </button>
        <button className={btn} title="旋转 90°" onClick={() => setRotate((r) => r + 90)}>
          ⟳
        </button>
        <button
          className={btn}
          title="复制图片"
          onClick={() => void window.api.assets.contextMenu(asset.id)}
        >
          ⧉
        </button>
        <button className={btn} title="关闭 (Esc)" onClick={close}>
          ✕
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-zinc-500">
        滚轮缩放 · 拖拽移动 · 双击切换 100%/适配 · 右键复制/另存为
      </p>
    </div>
  )
}
