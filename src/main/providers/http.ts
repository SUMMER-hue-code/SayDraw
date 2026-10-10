// HTTP 公共设施:URL 拼接、超时/取消、SSE 解析、错误归一化

import { app } from 'electron'

export class ApiError extends Error {
  status?: number
  body?: string
  constructor(message: string, status?: number, body?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/** baseUrl(如 https://host/v1)+ 路径(/chat/completions) */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

/**
 * 网关会话头:OpenCode Go(opencode.ai)要求每个会话带稳定的 x-opencode-session,
 * 缺失会被 400 拒绝("cannot be routed efficiently");顺带自定义 User-Agent 标识客户端。
 * 其他服务不受影响(按 host 匹配才附加)。
 */
export function gatewaySessionHeaders(baseUrl: string, sessionKey: string): Record<string, string> {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    if (host === 'opencode.ai' || host.endsWith('.opencode.ai')) {
      return { 'x-opencode-session': `saydraw-${sessionKey}`, 'User-Agent': `SayDraw/${app.getVersion()}` }
    }
  } catch {
    // 非法 baseUrl 交给后续请求统一报错
  }
  return {}
}

/**
 * 规范端点 URL:分组地址是基础地址,按规范拼请求地址。
 * 显式路径(chatPath)优先;否则基础地址已含版本段(/v1、/v4 等)直接拼相对路径,
 * 不含则补 /v1 前缀 —— 如 cf.api.fan + chat/completions → /v1/chat/completions,
 * api.openai.com/v1 + chat/completions → /v1/chat/completions。
 */
export function endpointUrl(baseUrl: string, explicitPath: string | undefined, relPath: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  const rel = relPath.replace(/^\/+/, '')
  if (explicitPath?.trim()) return joinUrl(base, explicitPath.trim())
  return /\/v\d+$/.test(base) ? `${base}/${rel}` : `${base}/v1/${rel}`
}

/** 合并外部取消信号与超时 */
export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(timeoutMs)])
}

export async function readErrorMessage(res: Response): Promise<never> {
  let body = ''
  try {
    body = (await res.text()).slice(0, 500)
  } catch {
    // ignore
  }
  let hint = ''
  try {
    const json = JSON.parse(body) as { error?: { message?: string } ; message?: string }
    hint = json.error?.message ?? json.message ?? ''
  } catch {
    // 非 JSON 响应体
  }
  throw new ApiError(hint || `HTTP ${res.status}`, res.status, body)
}

/** 逐条产出 SSE data 载荷(兼容 \n 与 \r\n) */
export async function* sseDataChunks(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new ApiError('响应无内容(SSE 流为空)')
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let dataLines: string[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        if (line === '') {
          if (dataLines.length) {
            yield dataLines.join('\n')
            dataLines = []
          }
          continue
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }
        // 忽略 event:/id:/retry:/注释行
      }
    }
    if (dataLines.length) yield dataLines.join('\n')
  } finally {
    reader.releaseLock()
  }
}

export function errText(err: unknown): string {
  if (err instanceof ApiError) return `${err.message}${err.status ? `(HTTP ${err.status})` : ''}`
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return '请求超时'
    if (err.name === 'AbortError') return '已取消'
    return err.message
  }
  return String(err)
}
