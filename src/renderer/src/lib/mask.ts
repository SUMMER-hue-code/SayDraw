// 蒙版渲染:归一化笔迹(与显示分辨率无关)→ 合并二值蒙版(接口用)+ 彩色编号标注图(模型看)

export interface MaskBrush {
  id: number
  color: string
  name: string
}

/** 预置编号画笔:同一张图可用不同编号指定不同修改内容 */
export const MASK_BRUSHES: MaskBrush[] = [
  { id: 1, color: '#f43f5e', name: '①' },
  { id: 2, color: '#38bdf8', name: '②' },
  { id: 3, color: '#34d399', name: '③' },
  { id: 4, color: '#facc15', name: '④' }
]

/** 一笔:归一化坐标点列 [x1,y1,x2,y2,…](0-1 相对图片宽高)+ 归一化线宽(相对图片宽度) */
export interface MaskStroke {
  brushId: number
  pts: number[]
  width: number
}

export function brushOf(id: number): MaskBrush {
  return MASK_BRUSHES.find((b) => b.id === id) ?? MASK_BRUSHES[0]
}

function pathStroke(ctx: CanvasRenderingContext2D, stroke: MaskStroke, w: number, h: number, widthScale = 1): void {
  ctx.lineWidth = Math.max(1, stroke.width * w * widthScale)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(stroke.pts[0] * w, stroke.pts[1] * h)
  if (stroke.pts.length === 2) ctx.lineTo(stroke.pts[0] * w + 0.1, stroke.pts[1] * h)
  for (let i = 2; i < stroke.pts.length; i += 2) {
    ctx.lineTo(stroke.pts[i] * w, stroke.pts[i + 1] * h)
  }
  ctx.stroke()
}

/** 接口用二值蒙版:黑底不透明,任何笔迹覆盖处变透明(OpenAI 约定:透明=待修改) */
export function renderBinaryMask(strokes: MaskStroke[], w: number, h: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.strokeStyle = '#fff'
  for (const stroke of strokes) pathStroke(ctx, stroke, w, h)
  return canvas.toDataURL('image/png')
}

/** 模型看的彩色编号标注图:各编号画笔以其颜色半透明显示,并在笔迹质心画编号徽章 */
export function renderColoredOverlay(strokes: MaskStroke[], w: number, h: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.globalAlpha = 0.45
  for (const stroke of strokes) {
    ctx.strokeStyle = brushOf(stroke.brushId).color
    pathStroke(ctx, stroke, w, h)
  }
  ctx.globalAlpha = 1
  // 每个编号:取该编号笔迹的质心,画编号徽章
  for (const brush of MASK_BRUSHES) {
    const own = strokes.filter((s) => s.brushId === brush.id)
    if (!own.length) continue
    let cx = 0
    let cy = 0
    let n = 0
    for (const stroke of own) {
      for (let i = 0; i < stroke.pts.length; i += 2) {
        cx += stroke.pts[i]
        cy += stroke.pts[i + 1]
        n++
      }
    }
    cx = (cx / n) * w
    cy = (cy / n) * h
    const r = Math.max(10, Math.min(w, h) * 0.028)
    ctx.fillStyle = brush.color
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#0b0d12'
    ctx.font = `bold ${Math.round(r * 1.2)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(brush.id), cx, cy + r * 0.05)
  }
  return canvas.toDataURL('image/png')
}

export function usedBrushIds(strokes: MaskStroke[]): number[] {
  return [...new Set(strokes.map((s) => s.brushId))].sort((a, b) => a - b)
}
