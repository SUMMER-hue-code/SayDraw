// 图片资产文件管理:写入 userData/assets/{sessionId}/,维护版本链元数据

import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AssetKind, ImageAsset } from '@shared/types'
import { getDb } from './db'

export function assetsRoot(): string {
  return path.join(app.getPath('userData'), 'assets')
}

/** 会话资产目录:工作目录优先(生成图片/{sessionId}),未选工作目录的旧会话回退 userData */
export function sessionAssetsDir(sessionId: string): string {
  const session = getDb().getSession(sessionId)
  if (session?.projectPath) {
    return path.join(session.projectPath, '生成图片', sessionId)
  }
  return path.join(assetsRoot(), sessionId)
}

/** 协议/读取用:返回该资产所有可能的目录(工作目录在前) */
export function sessionAssetsDirs(sessionId: string): string[] {
  const dirs = [sessionAssetsDir(sessionId)]
  const legacy = path.join(assetsRoot(), sessionId)
  if (!dirs.includes(legacy)) dirs.push(legacy)
  return dirs
}

export function assetAbsolutePath(asset: ImageAsset): string {
  // 优先工作目录下的文件,回退旧 userData 位置
  for (const dir of sessionAssetsDirs(asset.sessionId)) {
    const p = path.join(dir, path.basename(asset.fileName))
    if (fs.existsSync(p)) return p
  }
  return path.join(sessionAssetsDirs(asset.sessionId)[0], path.basename(asset.fileName))
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

// PNG / JPEG 尺寸探测(避免引入 sharp 等原生依赖)
function probeSize(buf: Buffer, mime: string): { width?: number; height?: number } {
  try {
    if (mime === 'image/png' && buf.length > 24 && buf.readUInt32BE(12) === 0x49484452) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    if (mime === 'image/jpeg') {
      let off = 2
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) break
        const marker = buf[off + 1]
        const size = buf.readUInt16BE(off + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) }
        }
        off += 2 + size
      }
    }
  } catch {
    // 解析失败不影响主流程
  }
  return {}
}

export function newAssetId(): string {
  return `asset-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}

function persistBuffer(opts: {
  sessionId: string
  buffer: Buffer
  mime: string
  kind: AssetKind
  parentId?: string
  baseAssetId?: string
  prompt?: string
  label?: string
}): ImageAsset {
  const { sessionId, buffer, mime } = opts
  const dir = sessionAssetsDir(sessionId)
  fs.mkdirSync(dir, { recursive: true })
  const ext = MIME_EXT[mime] ?? 'png'
  const id = newAssetId()
  const fileName = `${id}.${ext}`
  fs.writeFileSync(path.join(dir, fileName), buffer)
  const { width, height } = probeSize(buffer, mime)
  const asset: ImageAsset = {
    id,
    sessionId,
    kind: opts.kind,
    parentId: opts.parentId,
    baseAssetId: opts.baseAssetId,
    label: opts.label,
    fileName,
    mime,
    width,
    height,
    prompt: opts.prompt,
    createdAt: Date.now()
  }
  return getDb().addAsset(asset)
}

export function saveDataUrlAsset(opts: {
  sessionId: string
  dataUrl: string
  kind: AssetKind
  parentId?: string
  baseAssetId?: string
  label?: string
}): ImageAsset {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(opts.dataUrl)
  if (!match) throw new Error('无法解析图片数据(data URL 格式不正确)')
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()
  const buffer = Buffer.from(match[2], 'base64')
  return persistBuffer({ ...opts, buffer, mime })
}

export function saveBufferAsset(opts: {
  sessionId: string
  buffer: Buffer
  mime: string
  kind: AssetKind
  parentId?: string
  prompt?: string
}): ImageAsset {
  return persistBuffer(opts)
}

export function readAssetBuffer(asset: ImageAsset): Buffer {
  return fs.readFileSync(assetAbsolutePath(asset))
}

export function assetToDataUrl(asset: ImageAsset): string {
  return `data:${asset.mime};base64,${readAssetBuffer(asset).toString('base64')}`
}

/** 删除会话时清理其资产目录(工作目录与旧 userData 位置都清) */
export function removeSessionAssets(sessionId: string, projectPath?: string): void {
  const dirs: string[] = []
  if (projectPath) dirs.push(path.join(projectPath, '生成图片', sessionId))
  dirs.push(path.join(assetsRoot(), sessionId))
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true })
}
