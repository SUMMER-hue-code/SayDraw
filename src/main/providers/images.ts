// OpenAI 兼容图片接口:/images/generations(文生图)与 /images/edits(编辑/蒙版重绘)
// 归一化各家差异:b64_json 或 url 返回、size 不支持时自动降级重试

import type { ImageProfile } from '@shared/types'
import { ApiError, joinUrl, readErrorMessage, withTimeout } from './http'

const RATIO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
  '4:3': '1408x1056',
  '3:4': '1056x1408'
}

export function ratioToSize(ratio?: string): string | undefined {
  if (!ratio) return undefined
  return RATIO_SIZE[ratio.trim()]
}

interface RawImage {
  b64_json?: string
  url?: string
}

async function extractBuffers(json: { data?: RawImage[] }, timeoutMs: number): Promise<Buffer[]> {
  const items = json.data ?? []
  const out: Buffer[] = []
  for (const item of items) {
    if (item.b64_json) {
      out.push(Buffer.from(item.b64_json, 'base64'))
    } else if (item.url) {
      const res = await fetch(item.url, { signal: withTimeout(undefined, timeoutMs) })
      if (!res.ok) throw new ApiError(`下载生成图片失败(HTTP ${res.status})`, res.status)
      out.push(Buffer.from(await res.arrayBuffer()))
    }
  }
  if (!out.length) throw new ApiError('接口未返回任何图片数据')
  return out
}

function guessMime(buffer: Buffer): string {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png'
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer.length > 12 && buffer.subarray(0, 4).toString() === 'RIFF') return 'image/webp'
  return 'image/png'
}

/**
 * 可选参数(size/quality/output_format/input_fidelity)被端点拒绝时(HTTP 400 且报文提及参数不支持),
 * 自动去掉全部可选参数重试一次 —— 兼容各家用语不一的"不支持参数"报错
 */
function isUnsupportedParamError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 400 &&
    /parameter|参数|not support|unsupported|does not support|不支持/i.test(err.message)
  )
}

async function withParamFallback<T>(attempt: (withOptional: boolean) => Promise<T>): Promise<T> {
  try {
    return await attempt(true)
  } catch (err) {
    if (isUnsupportedParamError(err)) return attempt(false)
    throw err
  }
}

async function postImages(url: string, apiKey: string, body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<{ data?: RawImage[] }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: withTimeout(signal, timeoutMs)
  })
  if (!res.ok) await readErrorMessage(res)
  return (await res.json()) as { data?: RawImage[] }
}

/** 文生图;size 被拒绝(HTTP 400 且报文含 size)时自动去掉 size 重试一次 */
export async function generateImages(opts: {
  profile: ImageProfile
  prompt: string
  ratio?: string
  n: number
  timeoutMs: number
  signal?: AbortSignal
}): Promise<Buffer[]> {
  const { profile, prompt, ratio, n, timeoutMs, signal } = opts
  if (!profile.baseUrl || !profile.model) throw new ApiError('生图服务配置不完整(缺 baseUrl 或模型名)')
  if (!profile.apiKey) throw new ApiError('生图服务未配置 API Key')

  const url = joinUrl(profile.baseUrl, profile.genPath || '/images/generations')
  const size = ratioToSize(ratio)

  return withParamFallback(async (withOptional) => {
    const body: Record<string, unknown> = { model: profile.model, prompt, n }
    // 可选参数仅在配置时发送(避免严格端点拒绝未知字段);被拒绝时自动降级
    if (withOptional && size) body.size = size
    if (withOptional && profile.quality) body.quality = profile.quality
    if (withOptional && profile.outputFormat) body.output_format = profile.outputFormat

    const json = await postImages(url, profile.apiKey, body, timeoutMs, signal)
    return extractBuffers(json, timeoutMs)
  })
}

/** 编辑图片(整图指令编辑、蒙版局部重绘、多参考图融合),multipart/form-data
 * 多张输入图按 OpenAI 系惯例用重复的 image[] 字段;蒙版仅在单图时有效 */
export async function editImage(opts: {
  profile: ImageProfile
  prompt: string
  images: { buffer: Buffer; mime: string }[]
  mask?: Buffer
  ratio?: string
  timeoutMs: number
  signal?: AbortSignal
}): Promise<Buffer[]> {
  const { profile, prompt, images, mask, ratio, timeoutMs, signal } = opts
  if (!profile.baseUrl || !profile.model) throw new ApiError('生图服务配置不完整(缺 baseUrl 或模型名)')
  if (!profile.apiKey) throw new ApiError('生图服务未配置 API Key')
  if (!images.length) throw new ApiError('缺少输入图片')

  const url = joinUrl(profile.baseUrl, profile.editPath || '/images/edits')
  const size = ratioToSize(ratio)

  return withParamFallback(async (withOptional) => {
    const form = new FormData()
    form.append('model', profile.model)
    form.append('prompt', prompt)
    const toBlob = (buffer: Buffer, mime: string): { blob: Blob; ext: string } => ({
      blob: new Blob([buffer], { type: mime }),
      ext: mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
    })
    if (images.length === 1) {
      const { blob, ext } = toBlob(images[0].buffer, images[0].mime)
      form.append('image', blob, `image.${ext}`)
      if (mask) form.append('mask', new Blob([mask], { type: 'image/png' }), 'mask.png')
    } else {
      for (const img of images) {
        const { blob, ext } = toBlob(img.buffer, img.mime)
        form.append('image[]', blob, `image.${ext}`)
      }
    }
    if (withOptional && size) form.append('size', size)
    if (withOptional && profile.quality) form.append('quality', profile.quality)
    if (withOptional && profile.outputFormat) form.append('output_format', profile.outputFormat)
    if (withOptional && profile.inputFidelity) form.append('input_fidelity', profile.inputFidelity)

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${profile.apiKey}` },
      body: form,
      signal: withTimeout(signal, timeoutMs)
    })
    if (!res.ok) await readErrorMessage(res)
    const json = (await res.json()) as { data?: RawImage[] }
    return extractBuffers(json, timeoutMs)
  })
}

/** 设置页连通性测试:实际生成一张小图(会消耗少量额度) */
export async function imagePing(profile: ImageProfile, timeoutMs = 120_000): Promise<void> {
  const buffers = await generateImages({
    profile,
    prompt: 'a small red circle on white background',
    ratio: '1:1',
    n: 1,
    timeoutMs
  })
  if (!buffers.length) throw new ApiError('接口未返回图片')
}

export { guessMime }
