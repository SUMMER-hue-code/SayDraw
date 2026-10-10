import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import ChatPanel from './components/ChatPanel'
import Composer from './components/Composer'
import BriefPanel from './components/BriefPanel'
import ImageCanvas from './components/ImageCanvas'
import VersionStrip from './components/VersionStrip'
import SettingsDialog from './components/SettingsDialog'
import ImageViewer from './components/ImageViewer'
import MaskEditorModal from './components/MaskEditorModal'
import { useSessionsStore } from './stores/sessions'
import { useChatStore } from './stores/chat'
import { useSettingsStore } from './stores/settings'
export default function App() {
  const settingsOpen = useSessionsStore((s) => s.settingsOpen)
  const loadSessions = useSessionsStore((s) => s.load)
  const handleEvent = useChatStore((s) => s.handleEvent)
  const loadSettings = useSettingsStore((s) => s.load)
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    const unsubscribe = window.api.onAgentEvent((ev) => {
      handleEvent(ev)
      // 会话列表按更新时间排序,消息落盘后刷新
      if (ev.type === 'message-final' || ev.type === 'user-message') void loadSessions()
    })
    return unsubscribe
  }, [handleEvent, loadSessions])

  useEffect(() => {
    void (async () => {
      await Promise.all([loadSettings(), loadSessions()])
      setBooted(true)
    })()
  }, [loadSettings, loadSessions])

  // 首次启动自动创建一个会话
  useEffect(() => {
    if (booted && useSessionsStore.getState().sessions.length === 0) {
      void useSessionsStore.getState().create()
    }
  }, [booted])

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col border-l border-zinc-800/80 bg-[#131519]">
        <Header />
        <ChatPanel />
        <Composer />
      </main>
      <aside className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-zinc-800/80 bg-[#101216] p-3">
        <BriefPanel />
        <ImageCanvas />
        <VersionStrip />
      </aside>
      {settingsOpen && <SettingsDialog />}
      <MaskEditorModal />
      <ImageViewer />
    </div>
  )
}

function Header() {
  const currentId = useSessionsStore((s) => s.currentId)
  const sessions = useSessionsStore((s) => s.sessions)
  const setSettingsOpen = useSessionsStore((s) => s.setSettingsOpen)
  const session = sessions.find((s) => s.id === currentId)

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800/80 px-4">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">
        {session?.title ?? 'AIImage'}
      </h1>
      <button
        className="rounded-md px-2 py-1 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        onClick={() => setSettingsOpen(true)}
        title="设置"
      >
        ⚙ 设置
      </button>
    </header>
  )
}
