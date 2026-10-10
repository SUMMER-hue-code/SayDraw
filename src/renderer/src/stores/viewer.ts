// 双击打开的图片查看器状态(全局单例)

import { create } from 'zustand'

interface ViewerStore {
  assetId: string | null
  open: (assetId: string) => void
  close: () => void
}

export const useViewerStore = create<ViewerStore>((set) => ({
  assetId: null,
  open: (assetId) => set({ assetId }),
  close: () => set({ assetId: null })
}))
