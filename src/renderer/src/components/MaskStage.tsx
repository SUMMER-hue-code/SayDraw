// 蒙版画布(Konva):编号画笔笔迹(归一化存储)+ 双图导出
// view 模式:侧栏小画布(适配显示,可简单涂抹)
// editor 模式:完整编辑器——滚轮锚定缩放、平移(✋/空格/中键)、笔刷/撤销/清空、缩放控件

import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Image as KImage, Line, Group } from 'react-konva'
import type Konva from 'konva'
import type { ImageAsset } from '@shared/types'
import { assetUrl } from '@shared/ipc'
import { MASK_BRUSHES, brushOf, renderBinaryMask, renderColoredOverlay, usedBrushIds } from '../lib/mask'
import { useCanvasStore } from '../stores/canvas'

export function useHtmlImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!url) {
      setImg(null)
      return
    }
    const el = new window.Image()
    el.onload = () => setImg(el)
    el.src = url
    return () => {
      el.onload = null
    }
  }, [url])
  return img
}

/** 笔迹变化 → 防抖导出二值蒙版 + 彩色标注图回填 store */
export function useMaskExport(img: HTMLImageElement | null): void {
  const strokes = useCanvasStore((s) => s.strokes)
  const setMaskOutput = useCanvasStore((s) => s.setMaskOutput)
  useEffect(() => {
    if (!img) return
    const timer = setTimeout(() => {
      if (strokes.length === 0) {
        setMaskOutput(null, null)
        return
      }
      setMaskOutput(renderBinaryMask(strokes, img.naturalWidth, img.naturalHeight), renderColoredOverlay(strokes, img.naturalWidth, img.naturalHeight))
    }, 250)
    return () => clearTimeout(timer)
  }, [strokes, img, setMaskOutput])
}

export default function MaskStage(props: { asset: ImageAsset; mode: 'view' | 'editor'; maxH?: number }) {
  const { asset, mode, maxH = 380 } = props
  const editor = mode === 'editor'
  const img = useHtmlImage(assetUrl(asset.sessionId, asset.fileName))
  useMaskExport(img)

  const strokes = useCanvasStore((s) => s.strokes)
  const activeBrushId = useCanvasStore((s) => s.activeBrushId)
  const setActiveBrush = useCanvasStore((s) => s.setActiveBrush)
  const brushSize = useCanvasStore((s) => s.brushSize)
  const setBrushSize = useCanvasStore((s) => s.setBrushSize)
  const upsertStroke = useCanvasStore((s) => s.upsertStroke)
  const undo = useCanvasStore((s) => s.undo)
  const clearStrokes = useCanvasStore((s) => s.clearStrokes)

  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const groupRef = useRef<Konva.Group>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 缩放与平移(editor)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null) // null = 居中
  const [panMode, setPanMode] = useState(false)
  const spaceRef = useRef(false)
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const drawingRef = useRef(false)

  const baseFit = img
    ? editor
      ? Math.min((size.w - 24) / img.naturalWidth, (size.h - 24) / img.naturalHeight, 4)
      : Math.min(size.w / img.naturalWidth, maxH / img.naturalHeight, 2)
    : 1
  const contentW = img ? img.naturalWidth * baseFit : 0
  const contentH = img ? img.naturalHeight * baseFit : 0
  const effZoom = Math.min(10, Math.max(0.05, zoom))
  const effOffset = offset ?? { x: (size.w - contentW * effZoom) / 2, y: (size.h - contentH * effZoom) / 2 }

  const zoomAt = (factor: number, px?: number, py?: number): void => {
    const stage = stageRef.current
    const pointer = px !== undefined && py !== undefined ? { x: px, y: py } : (stage?.getPointerPosition() ?? { x: size.w / 2, y: size.h / 2 })
    setZoom((z) => {
      const next = Math.min(10, Math.max(0.05, z * factor))
      setOffset((o) => {
        const base = o ?? { x: (size.w - contentW * next) / 2, y: (size.h - contentH * next) / 2 }
        const cx = (pointer.x - base.x) / z
        const cy = (pointer.y - base.y) / z
        return { x: pointer.x - cx * next, y: pointer.y - cy * next }
      })
      return next
    })
  }

  // 滚轮缩放(非被动监听,锚定光标)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || !editor) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, size.w, size.h, contentW, contentH])

  // 空格按住 = 平移;Ctrl+Z 撤销;[ ] 笔刷大小
  useEffect(() => {
    if (!editor) return
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'Space') spaceRef.current = true
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      }
      if (e.key === '[') setBrushSize(useCanvasStore.getState().brushSize - 6)
      if (e.key === ']') setBrushSize(useCanvasStore.getState().brushSize + 6)
    }
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') spaceRef.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  /** 指针 → 内容归一化坐标(经缩放平移变换) */
  const pointerNormalized = (): { x: number; y: number } | null => {
    const rel = groupRef.current?.getRelativePointerPosition()
    if (!rel || !contentW || !contentH) return null
    return { x: Math.min(1, Math.max(0, rel.x / contentW)), y: Math.min(1, Math.max(0, rel.y / contentH)) }
  }

  const wantPan = (e: Konva.KonvaEventObject<MouseEvent>): boolean => panMode || spaceRef.current || e.evt.button === 1

  const handleDown = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    if (!img || !editor) return // view 模式只读预览,编辑一律在 editor 弹窗
    const stage = stageRef.current
    const pos = stage?.getPointerPosition()
    if (!pos) return
    if (wantPan(e)) {
      panRef.current = { sx: pos.x, sy: pos.y, ox: effOffset.x, oy: effOffset.y }
      return
    }
    const p = pointerNormalized()
    if (!p) return
    drawingRef.current = true
    upsertStroke({ brushId: activeBrushId, pts: [p.x, p.y], width: brushSize / 720 }, false)
  }

  const handleMove = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    const stage = stageRef.current
    const pos = stage?.getPointerPosition()
    if (panRef.current && pos) {
      const d = panRef.current
      setOffset({ x: d.ox + (pos.x - d.sx), y: d.oy + (pos.y - d.sy) })
      return
    }
    if (!drawingRef.current) return
    const p = pointerNormalized()
    if (!p) return
    const strokesNow = useCanvasStore.getState().strokes
    const last = strokesNow[strokesNow.length - 1]
    if (!last) return
    upsertStroke({ ...last, pts: [...last.pts, p.x, p.y] }, true)
  }

  const finishPointer = (): void => {
    drawingRef.current = false
    panRef.current = null
  }

  const usedIds = usedBrushIds(strokes)
  const cursor = editor ? (panMode ? 'grab' : 'crosshair') : 'default'

  return (
    <div
      ref={wrapRef}
      className={`relative overflow-hidden ${editor ? 'flex h-full w-full flex-1' : 'flex items-center justify-center p-2'}`}
      style={editor ? { minHeight: 0 } : undefined}
      onContextMenu={(e) => editor && e.preventDefault()}
    >
      {/* editor 工具浮层 */}
      {editor && (
        <div className="absolute left-1/2 top-3 z-10 flex max-w-[95%] flex-wrap items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-[#1b1d23]/95 px-2.5 py-1.5 shadow-xl backdrop-blur">
          {MASK_BRUSHES.map((b) => (
            <button
              key={b.id}
              className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-all ${
                activeBrushId === b.id ? 'scale-110 border-white' : 'border-transparent opacity-75 hover:opacity-100'
              }`}
              style={{ backgroundColor: `${b.color}55`, color: b.color }}
              title={`画笔 ${b.name}(第 ${b.id} 处修改)${usedIds.includes(b.id) ? ' · 已使用' : ''}`}
              onClick={() => setActiveBrush(b.id)}
            >
              {b.id}
            </button>
          ))}
          <span className="mx-0.5 h-5 w-px bg-zinc-700" />
          <input
            type="range"
            min={4}
            max={200}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-24 accent-emerald-500"
            title={`笔刷 ${brushSize}px([ / ] 调整)`}
          />
          <span className="w-8 text-center font-mono text-[10px] text-zinc-400">{brushSize}</span>
          <span className="mx-0.5 h-5 w-px bg-zinc-700" />
          <button className="rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800" disabled={!strokes.length} onClick={undo} title="撤销 (Ctrl+Z)">
            撤销
          </button>
          <button className="rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800" disabled={!strokes.length} onClick={clearStrokes} title="清空全部笔迹">
            清空
          </button>
          <span className="mx-0.5 h-5 w-px bg-zinc-700" />
          <button
            className={`rounded px-2 py-1 text-[11px] ${panMode ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'}`}
            onClick={() => setPanMode((p) => !p)}
            title="平移模式(或按住空格拖拽 / 中键拖拽)"
          >
            ✋
          </button>
          <button className="rounded px-1.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800" onClick={() => zoomAt(1 / 1.25)} title="缩小">
            −
          </button>
          <span className="w-10 text-center font-mono text-[10px] text-zinc-400">{Math.round(effZoom * 100)}%</span>
          <button className="rounded px-1.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800" onClick={() => zoomAt(1.25)} title="放大">
            +
          </button>
          <button
            className="rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800"
            onClick={() => {
              setZoom(1)
              setOffset(null)
            }}
            title="适配窗口"
          >
            适配
          </button>
        </div>
      )}

      {editor && (
        <p className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-3 py-1 text-[10px] text-zinc-400 backdrop-blur">
          滚轮缩放 · 空格/✋/中键平移 · [{usedIds.length ? `已标记 ${usedIds.length} 处(编号 ${usedIds.join('、')})` : '尚未涂抹'}]
        </p>
      )}

      {img && (
        <Stage
          ref={stageRef}
          width={editor ? size.w : contentW}
          height={editor ? size.h : contentH}
          style={{ cursor, borderRadius: 8, display: 'block' }}
          onMouseDown={handleDown}
          onMouseMove={handleMove}
          onMouseUp={finishPointer}
          onMouseLeave={finishPointer}
        >
          <Layer>
            <Group ref={groupRef} x={editor ? effOffset.x : 0} y={editor ? effOffset.y : 0} scaleX={editor ? effZoom : 1} scaleY={editor ? effZoom : 1}>
              <KImage image={img} width={contentW} height={contentH} />
              {strokes.map((stroke, i) => (
                <Line
                  key={i}
                  points={stroke.pts.flatMap((v, idx) => (idx % 2 === 0 ? [v * contentW, stroke.pts[idx + 1] * contentH] : []))}
                  stroke={brushOf(stroke.brushId).color}
                  strokeWidth={Math.max(1, stroke.width * contentW)}
                  opacity={0.55}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              ))}
            </Group>
          </Layer>
        </Stage>
      )}
    </div>
  )
}
