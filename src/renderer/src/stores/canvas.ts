// 画布状态:当前查看的图 + 编号画笔蒙版(归一化笔迹,双图导出:二值蒙版给接口、彩色标注给模型)

import { create } from 'zustand'
import type { MaskStroke } from '../lib/mask'

interface CanvasStore {
  baseAssetId: string | null
  /** 归一化笔迹(相对底图宽高),与显示分辨率无关 */
  strokes: MaskStroke[]
  /** 侧栏小画布是否处于涂抹模式 */
  brushMode: boolean
  activeBrushId: number
  /** 画笔显示直径(px,以 720px 宽的编辑视图为基准,内部换算归一化) */
  brushSize: number
  /** 接口用二值蒙版(透明=待修改) */
  maskDataUrl: string | null
  /** 模型看的彩色编号标注图 */
  overlayDataUrl: string | null
  maskBaseAssetId: string | null
  editorOpen: boolean
  setBase: (assetId: string | null) => void
  setBrushMode: (on: boolean) => void
  setActiveBrush: (id: number) => void
  setBrushSize: (size: number) => void
  /** 追加/更新一笔(同一笔移动中重复传末笔) */
  upsertStroke: (stroke: MaskStroke, isUpdate: boolean) => void
  undo: () => void
  clearStrokes: () => void
  /** 双图导出结果回填(防抖后由组件调用) */
  setMaskOutput: (mask: string | null, overlay: string | null) => void
  clearMask: () => void
  setEditorOpen: (open: boolean) => void
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  baseAssetId: null,
  strokes: [],
  brushMode: false,
  activeBrushId: 1,
  brushSize: 28,
  maskDataUrl: null,
  overlayDataUrl: null,
  maskBaseAssetId: null,
  editorOpen: false,

  setBase: (assetId) => {
    if (get().maskBaseAssetId !== assetId) {
      set({ baseAssetId: assetId, strokes: [], maskDataUrl: null, overlayDataUrl: null, maskBaseAssetId: null })
    } else {
      set({ baseAssetId: assetId })
    }
  },

  setBrushMode: (on) => set({ brushMode: on }),
  setActiveBrush: (id) => set({ activeBrushId: id }),
  setBrushSize: (size) => set({ brushSize: Math.min(120, Math.max(4, size)) }),

  upsertStroke: (stroke, isUpdate) => {
    const strokes = [...get().strokes]
    if (isUpdate && strokes.length) strokes[strokes.length - 1] = stroke
    else strokes.push(stroke)
    set({ strokes })
  },

  undo: () => set({ strokes: get().strokes.slice(0, -1) }),
  clearStrokes: () => set({ strokes: [] }),

  setMaskOutput: (mask, overlay) => set({ maskDataUrl: mask, overlayDataUrl: overlay, maskBaseAssetId: mask ? get().baseAssetId : null }),

  clearMask: () => set({ maskDataUrl: null, overlayDataUrl: null, maskBaseAssetId: null, strokes: [] }),

  setEditorOpen: (open) => set({ editorOpen: open })
}))
