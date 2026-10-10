// 输入区附件:图片(拖拽/粘贴/选择)与文本文件(读取内容作为上下文)

import { create } from 'zustand'

export interface PendingAttachment {
  name: string
  dataUrl: string
}

export interface PendingTextFile {
  name: string
  content: string
}

interface ComposerStore {
  pending: PendingAttachment[]
  pendingTexts: PendingTextFile[]
  addFiles: (files: File[]) => Promise<void>
  removeImage: (index: number) => void
  removeText: (index: number) => void
  clear: () => void
}

const MAX_IMAGES = 6
const MAX_TEXT_FILES = 3
const MAX_TEXT_CHARS = 32_000
const TEXT_EXTS = /\.(md|txt|json|csv|log|xml|yaml|yml|ini|env|js|ts|tsx|jsx|cs|py|java|html|css|sql)$/i

export const useComposerStore = create<ComposerStore>((set, get) => ({
  pending: [],
  pendingTexts: [],

  addFiles: async (files) => {
    const images = files.filter((f) => f.type.startsWith('image/')).slice(0, MAX_IMAGES - get().pending.length)
    const texts = files
      .filter((f) => !f.type.startsWith('image/') && TEXT_EXTS.test(f.name))
      .slice(0, MAX_TEXT_FILES - get().pendingTexts.length)

    const loaded: PendingAttachment[] = []
    for (const file of images) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsDataURL(file)
      })
      loaded.push({ name: file.name, dataUrl })
    }

    const loadedTexts: PendingTextFile[] = []
    for (const file of texts) {
      const content = await file.text()
      loadedTexts.push({ name: file.name, content: content.slice(0, MAX_TEXT_CHARS) })
    }

    set({
      pending: [...get().pending, ...loaded],
      pendingTexts: [...get().pendingTexts, ...loadedTexts]
    })
  },

  removeImage: (index) => set({ pending: get().pending.filter((_, i) => i !== index) }),
  removeText: (index) => set({ pendingTexts: get().pendingTexts.filter((_, i) => i !== index) }),
  clear: () => set({ pending: [], pendingTexts: [] })
}))
