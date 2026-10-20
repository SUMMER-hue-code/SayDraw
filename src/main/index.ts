// 主进程入口:窗口、自定义资源协议(app-asset://)、单实例、崩溃兜底与生命周期

import * as electron from 'electron'
import fs from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpc } from './ipc'
import { getDb } from './store/db'
import { getSettings } from './store/settings'
import { sessionAssetsDirs } from './store/assets'
import { appendLog, logFile } from './store/log'

const { app, BrowserWindow, protocol, net, dialog } = electron

// 应用更名(ai-image-agent → saydraw/说画)后固定 userData 目录并把旧数据整体迁入,保留用户的会话/图片/设置
{
  const appData = app.getPath('appData')
  const newDataDir = join(appData, 'SayDraw')
  if (!fs.existsSync(newDataDir)) {
    const legacy = [join(appData, 'ai-image-agent'), join(appData, 'AIImage')].find((d) => fs.existsSync(d))
    if (legacy) fs.cpSync(legacy, newDataDir, { recursive: true })
  }
  app.setPath('userData', newDataDir)
}

// 自定义协议需在 app ready 前注册为特权 scheme
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1117',
    title: '说画 SayDraw',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  win.on('ready-to-show', () => win.show())

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 第二实例启动时把已有窗口带回前台 */
function focusMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// app-asset://{sessionId}/{fileName} → 工作目录/生成图片/{sessionId}/ 或 userData/assets/{sessionId}/
// 路径校验防止目录穿越
function registerAssetProtocol(): void {
  protocol.handle('app-asset', (request) => {
    const url = new URL(request.url)
    const sessionId = url.hostname
    const fileName = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (!/^[\w-]+$/.test(sessionId) || !/^[\w.-]+$/.test(fileName)) {
      return new Response('bad request', { status: 400 })
    }
    const dirs = sessionAssetsDirs(sessionId)
    let filePath = ''
    for (const dir of dirs) {
      const candidate = join(dir, fileName)
      if (candidate.startsWith(dir) && fs.existsSync(candidate)) {
        filePath = candidate
        break
      }
    }
    if (!filePath) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

// ---------- 单实例 ----------
// 两个进程同时写 app-data.json 会互相覆盖,所以第二个实例只负责把已有窗口叫到前台
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())
}

// ---------- 崩溃兜底 ----------
let crashDialogShown = false

function reportCrash(kind: string, err: unknown, withDialog: boolean): void {
  const detail = err instanceof Error ? err.stack ?? err.message : String(err)
  appendLog(`[crash] ${kind}: ${detail}`)
  if (!withDialog || crashDialogShown || !app.isReady()) return
  crashDialogShown = true
  dialog.showErrorBox(
    '说画 SayDraw 遇到异常',
    `已记录日志:${logFile()}\n\n建议重启应用;若反复出现,请把该日志文件发给我们。\n\n${detail.slice(0, 600)}`
  )
}

process.on('uncaughtException', (err) => reportCrash('uncaughtException', err, true))
process.on('unhandledRejection', (reason) => reportCrash('unhandledRejection', reason, false))

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    app.setAppUserModelId('com.saydraw.app')
    appendLog(`启动 v${app.getVersion()}(electron ${process.versions.electron},${process.platform})`)

    getDb().init()
    getSettings().load()
    registerAssetProtocol()
    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
