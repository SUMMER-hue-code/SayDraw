// HTTP 公共设施:URL 拼接、超时/取消、SSE 解析、错误归一化

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
