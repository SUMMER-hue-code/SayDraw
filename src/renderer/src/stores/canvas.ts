// 画布状态:当前查看的图 + 蒙版(由 Canvas 组件生成/更新)

import { create } from 'zustand'

interface CanvasStore {
  baseAssetId: string | null
  /** OpenAI 蒙版约定:透明区域 = 需要重绘的区域 */
  maskDataUrl: string | null
  maskBaseAssetId: string | null
  brushMode: boolean
  brushSize: number
  setBase: (assetId: string | null) => void
  setMask: (dataUrl: string | null) => void
  setBrushMode: (on: boolean) => void
  setBrushSize: (size: number) => void
  clearMask: () => void
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  baseAssetId: null,
  maskDataUrl: null,
  maskBaseAssetId: null,
  brushMode: false,
  brushSize: 24,

  setBase: (assetId) => {
    // 切换底图时清掉旧蒙版
    if (get().maskBaseAssetId !== assetId) {
      set({ baseAssetId: assetId, maskDataUrl: null, maskBaseAssetId: null })
    } else {
      set({ baseAssetId: assetId })
    }
  },

  setMask: (dataUrl) => set({ maskDataUrl: dataUrl, maskBaseAssetId: dataUrl ? get().baseAssetId : null }),
  setBrushMode: (on) => set({ brushMode: on }),
  setBrushSize: (size) => set({ brushSize: size }),
  clearMask: () => set({ maskDataUrl: null, maskBaseAssetId: null })
}))
