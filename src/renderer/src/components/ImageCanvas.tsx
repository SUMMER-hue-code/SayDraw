import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Image as KImage, Line } from 'react-konva'
import type Konva from 'konva'
import { assetUrl } from '@shared/ipc'
import { useChatStore } from '../stores/chat'
import { useCanvasStore } from '../stores/canvas'
import { useViewerStore } from '../stores/viewer'

const MAX_CANVAS_H = 380

function useHtmlImage(url: string | null): HTMLImageElement | null {
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

interface Stroke {
  points: number[] // 舞台显示坐标 [x1,y1,x2,y2,...]
}

export default function ImageCanvas() {
  const baseAssetId = useCanvasStore((s) => s.baseAssetId)
  const assets = useChatStore((s) => s.assets)
  const brushMode = useCanvasStore((s) => s.brushMode)
  const brushSize = useCanvasStore((s) => s.brushSize)
  const setBrushMode = useCanvasStore((s) => s.setBrushMode)
  const setBrushSize = useCanvasStore((s) => s.setBrushSize)
  const setMask = useCanvasStore((s) => s.setMask)
  const maskDataUrl = useCanvasStore((s) => s.maskDataUrl)

  const asset = baseAssetId ? assets[baseAssetId] : null
  const img = useHtmlImage(asset ? assetUrl(asset.sessionId, asset.fileName) : null)

  const wrapRef = useRef<HTMLDivElement>(null)
  const [availW, setAvailW] = useState(0)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const drawingRef = useRef(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setAvailW(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 切换底图 → 清空笔迹
  useEffect(() => {
    setStrokes([])
  }, [baseAssetId])

  const scale = img ? Math.min(availW / img.naturalWidth, MAX_CANVAS_H / img.naturalHeight, 2) : 1
  const stageW = img ? Math.round(img.naturalWidth * scale) : 0
  const stageH = img ? Math.round(img.naturalHeight * scale) : 0

  // 笔迹变化 → 生成 OpenAI 约定蒙版(透明区域 = 待重绘),防抖
  useEffect(() => {
    if (!img || !asset) return
    const timer = setTimeout(() => {
      if (strokes.length === 0) {
        setMask(null)
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = Math.max(1, brushSize / scale)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const stroke of strokes) {
        ctx.beginPath()
        ctx.moveTo(stroke.points[0] / scale, stroke.points[1] / scale)
        if (stroke.points.length === 2) {
          ctx.lineTo(stroke.points[0] / scale + 0.1, stroke.points[1] / scale)
        }
        for (let i = 2; i < stroke.points.length; i += 2) {
          ctx.lineTo(stroke.points[i] / scale, stroke.points[i + 1] / scale)
        }
        ctx.stroke()
      }
      setMask(canvas.toDataURL('image/png'))
    }, 250)
    return () => clearTimeout(timer)
  }, [strokes, img, asset, brushSize, scale, setMask])

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    if (!brushMode || !img) return
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos) return
    drawingRef.current = true
    setStrokes((prev) => [...prev, { points: [pos.x, pos.y] }])
  }

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    if (!drawingRef.current) return
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos) return
    setStrokes((prev) => {
      if (prev.length === 0) return prev
      const copy = [...prev]
      const last = copy[copy.length - 1]
      copy[copy.length - 1] = { points: [...last.points, pos.x, pos.y] }
      return copy
    })
  }

  const finishStroke = (): void => {
    drawingRef.current = false
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-[#15171c]">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 px-3 py-2">
        <h2 className="mr-auto text-xs font-semibold tracking-wide text-zinc-300">🖼 画布</h2>
        <div className="flex overflow-hidden rounded-lg border border-zinc-700">
          <button
            className={`px-2.5 py-1 text-[11px] ${!brushMode ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:bg-zinc-800'}`}
            onClick={() => setBrushMode(false)}
          >
            预览
          </button>
          <button
            className={`px-2.5 py-1 text-[11px] ${brushMode ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'}`}
            onClick={() => setBrushMode(true)}
            disabled={!asset}
          >
            涂抹蒙版
          </button>
        </div>
        {brushMode && (
          <>
            <input
              type="range"
              min={6}
              max={72}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-16 accent-violet-500"
              title={`笔刷 ${brushSize}px`}
            />
            <button
              className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800"
              onClick={() => setStrokes((prev) => prev.slice(0, -1))}
              disabled={strokes.length === 0}
            >
              撤销
            </button>
            <button
              className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800"
              onClick={() => setStrokes([])}
              disabled={strokes.length === 0}
            >
              清空
            </button>
          </>
        )}
      </header>

      <div
        ref={wrapRef}
        className="flex items-center justify-center overflow-hidden p-2"
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
        {!asset || !img ? (
          <div className="flex h-40 w-full items-center justify-center rounded-lg border border-dashed border-zinc-800 text-[11px] text-zinc-600">
            生成 / 上传的图片会显示在这里,点击聊天中的图片即可载入
          </div>
        ) : (
          <Stage
            width={stageW}
            height={stageH}
            style={{ cursor: brushMode ? 'crosshair' : 'default', borderRadius: 8 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={finishStroke}
            onMouseLeave={finishStroke}
            onTouchStart={handleMouseDown}
            onTouchMove={handleMouseMove}
            onTouchEnd={finishStroke}
          >
            <Layer>
              <KImage image={img} width={stageW} height={stageH} />
              {strokes.map((stroke, i) => (
                <Line
                  key={i}
                  points={stroke.points}
                  stroke="#fb7185"
                  strokeWidth={brushSize}
                  opacity={0.55}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              ))}
            </Layer>
          </Stage>
        )}
      </div>

      {maskDataUrl && (
        <p className="border-t border-zinc-800/80 px-3 py-2 text-[11px] text-amber-400/90">
          🖌 蒙版已就绪:在输入框描述要改成什么,发送时会自动附带(红色区域将被重绘)
        </p>
      )}
    </section>
  )
}
