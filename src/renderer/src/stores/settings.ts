// 设置状态

import { create } from 'zustand'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'

interface SettingsStore {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
  save: (next: AppSettings) => Promise<void>
  setActive: (kind: 'chat' | 'image', profileId: string | undefined) => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    const settings = await window.api.settings.get()
    set({ settings, loaded: true })
  },

  save: async (next) => {
    const saved = await window.api.settings.save(next)
    set({ settings: saved })
  },

  setActive: async (kind, profileId) => {
    const saved = await window.api.settings.setActive(kind, profileId)
    set({ settings: saved })
  }
}))
