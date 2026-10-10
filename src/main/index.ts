// 主进程入口:窗口、自定义资源协议(app-asset://)、生命周期

import * as electron from 'electron'
import fs from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpc } from './ipc'
import { getDb } from './store/db'
import { getSettings } from './store/settings'
import { sessionAssetsDirs } from './store/assets'

const { app, BrowserWindow, protocol, net } = electron

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
    title: 'AIImage',
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

app.whenReady().then(() => {
  app.setAppUserModelId('com.aiimage.app')

  getDb().init()
  getSettings().load()
  registerAssetProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
