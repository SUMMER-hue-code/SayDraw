// 模型列表拉取(OpenAI 规范 GET /models;Anthropic 规范 GET /v1/models)
// DeepSeek 等服务会返回元数据(上下文窗口/输出上限/输入模态/推理档位),用于选模型时自动填参

import type { ApiFormat, ModelInfo } from '@shared/types'
import { ApiError, endpointUrl, gatewaySessionHeaders, joinUrl, readErrorMessage, withTimeout } from './http'

interface RawModel {
  id?: string
  name?: string
  context_window?: number
  max_output_tokens?: number
  input_modalities?: string[]
  effort?: { supported_levels?: string[] }
  // Anthropic 规范字段
  display_name?: string
}

export async function listModels(opts: {
  baseUrl: string
  apiKey: string
  apiFormat?: ApiFormat
  timeoutMs?: number
}): Promise<ModelInfo[]> {
  const { baseUrl, apiKey, apiFormat = 'openai', timeoutMs = 20_000 } = opts
  if (!baseUrl || !apiKey) throw new ApiError('请先填写 Base URL 与 API Key')

  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
  const url = endpointUrl(baseUrl, undefined, 'models')
  Object.assign(headers, gatewaySessionHeaders(url, 'settings'))
  if (apiFormat === 'anthropic') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
    delete headers.Authorization
  }

  let res = await fetch(url, { headers, signal: withTimeout(undefined, timeoutMs) })
  if (!res.ok && res.status === 404 && apiFormat !== 'anthropic') {
    // 版本路径猜测落空(如服务在根路径提供 /models):去 /v1 前缀再试一次
    const alt = joinUrl(baseUrl, '/models')
    const retry = await fetch(alt, { headers: gatewaySessionHeaders(alt, 'settings'), signal: withTimeout(undefined, timeoutMs) })
    if (retry.ok) res = retry
  }
  if (!res.ok) await readErrorMessage(res)
  const json = (await res.json()) as { data?: RawModel[]; models?: RawModel[] }
  const items = json.data ?? json.models ?? []
  const infos = items
    .filter((i) => i.id)
    .map<ModelInfo>((i) => ({
      id: i.id!,
      name: i.name ?? i.display_name,
      contextWindow: i.context_window,
      maxOutputTokens: i.max_output_tokens,
      inputModalities: i.input_modalities,
      effortLevels: i.effort?.supported_levels
    }))
  if (!infos.length) throw new ApiError('接口未返回模型列表')
  return infos.sort((a, b) => a.id.localeCompare(b.id))
}
