// Agent 编排循环:上下文构建 → LLM 流式 ↔ 工具调用 → 硬确认门 → 结果落盘
// 迭代次数不设上限,由模型自行判断进度;用户可随时取消
// 每轮产出按序 blocks(text / reasoning / tool),供前端块式渲染与折叠展示

import { randomUUID } from 'node:crypto'
import type { AgentEvent, ChatMessage, FileTextAttachment, ImageAsset, ImageBrief, MessageBlock, ToolCallRecord } from '@shared/types'
import { getDb } from '../store/db'
import { getSettings } from '../store/settings'
import { assetToDataUrl } from '../store/assets'
import { syncSpecFile } from '../store/projects'
import { streamChatCompletion, type ContentPart, type LLMMessage, type LLMToolCall } from '../providers/chat'
import { errText } from '../providers/http'
import { cancelSessionQuestions } from './askUser'
import { buildSystemMessage } from './systemPrompt'
import { TOOL_DEFS, executeTool, type ToolCtx } from './tools'

const activeRuns = new Map<string, AbortController>()

/** 单张图粗估 token(视觉模型通用量级) */
const IMAGE_TOKEN_EST = 1300
const FILE_TEXT_MAX = 16_000

export function isRunning(sessionId: string): boolean {
  return activeRuns.has(sessionId)
}

export function cancelRun(sessionId: string): boolean {
  const ctrl = activeRuns.get(sessionId)
  if (!ctrl) return false
  ctrl.abort()
  return true
}

const KIND_LABEL: Record<string, string> = {
  'user-upload': '用户上传',
  generated: '生成',
  edited: '编辑',
  mask: '蒙版'
}

function estimateTextTokens(text: string): number {
  // 中英混合粗估:约 2 字符/token
  return Math.ceil(text.length / 2)
}

/** 按模型上下文窗口裁剪历史(保底最近 6 条,裁最老的) */
function trimByContextWindow(messages: LLMMessage[], contextWindow: number, maxOutputTokens: number): LLMMessage[] {
  const budget = Math.max(4000, contextWindow - maxOutputTokens - 1000)
  const estimate = (msgs: LLMMessage[]): number =>
    msgs.reduce((sum, m) => {
      if (typeof m.content === 'string') return sum + estimateTextTokens(m.content)
      let s = 0
      for (const part of m.content) {
        if (part.type === 'text') s += estimateTextTokens(part.text)
        else s += IMAGE_TOKEN_EST
      }
      return sum + s
    }, 0)

  const out = [...messages]
  while (estimate(out) > budget && out.length > 7) {
    // system 消息(首条)永不裁
    out.splice(1, 1)
  }
  return out
}

/** 构建图片标注 + 图片本体的 content parts */
function buildAssetParts(assets: ImageAsset[], visionEnabled: boolean): ContentPart[] {
  const parts: ContentPart[] = []
  const notes: string[] = []
  for (const asset of assets) {
    if (asset.kind === 'mask') {
      notes.push(`[图片 ${asset.id}(蒙版,作用于 ${asset.baseAssetId ?? '上一张图'}:涂抹区域为用户想修改的部分)]`)
    } else {
      notes.push(`[图片 ${asset.id}(${KIND_LABEL[asset.kind] ?? asset.kind})]`)
    }
    if (visionEnabled) {
      parts.push({ type: 'image_url', image_url: { url: assetToDataUrl(asset) } })
    }
  }
  return [{ type: 'text', text: notes.join('\n') }, ...parts.filter((p) => p.type === 'image_url')]
}

/** 把会话历史映射为 LLM 消息,并在尾部附上会话最近图片(连续修图的关键:模型始终看得到最新画面) */
function buildContext(sessionId: string, brief: ImageBrief): LLMMessage[] {
  const db = getDb()
  const settings = getSettings().load()
  const history = db.messages(sessionId)
  const session = db.getSession(sessionId)
  const chatProfile = getSettings().activeChatProfile()
  const visionEnabled = chatProfile?.supportsVision !== false

  // 图片预算:只带最近 N 张(含蒙版),过老的丢弃
  const referenced: string[] = []
  for (const m of history) {
    for (const id of m.assetIds) referenced.push(id)
  }
  const budget = new Set(referenced.slice(-settings.maxHistoryImages))
  const attached = new Set<string>()

  const messages: LLMMessage[] = [
    { role: 'system', content: buildSystemMessage(brief, session?.projectPath) }
  ]

  for (const m of history) {
    if (m.role === 'user') {
      const assets = m.assetIds
        .map((id) => db.asset(id))
        .filter((a): a is ImageAsset => a !== undefined && budget.has(a.id))
      const textParts: string[] = [m.text.trim() || '(用户发送了图片)']
      // 文本附件以引用块注入
      for (const f of m.fileTexts ?? []) {
        textParts.push(`[附件 ${f.name}]\n${f.content.slice(0, FILE_TEXT_MAX)}`)
      }
      if (assets.length) {
        const parts: ContentPart[] = [{ type: 'text', text: textParts.join('\n\n') }, ...buildAssetParts(assets, visionEnabled)]
        for (const a of assets) attached.add(a.id)
        messages.push({ role: 'user', content: parts })
      } else {
        messages.push({ role: 'user', content: textParts.join('\n\n') })
      }
    } else {
      let text = m.text
      if (m.assetIds.length) text = `${text}\n[本轮产出图片:${m.assetIds.join(', ')}]`
      messages.push({ role: 'assistant', content: text })
    }
  }

  // 尾部补充"尚未附着在历史中的最近图片",保证连续修图时模型看到最新画面
  const visionImages = visionEnabled
    ? db
        .assets(sessionId)
        .filter((a) => a.kind !== 'mask' && !attached.has(a.id))
        .slice(-Math.min(3, settings.maxHistoryImages))
    : []
  if (visionImages.length) {
    const parts = buildAssetParts(visionImages, true)
    const note = parts[0].type === 'text' ? parts[0].text : ''
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: `【图片上下文】当前会话最近的图片(最新在后),供你了解当前画面状态:\n${note}` },
        ...parts.filter((p) => p.type === 'image_url')
      ]
    })
  }

  const contextWindow = chatProfile?.contextWindow || 65536
  const maxOutputTokens = chatProfile?.maxOutputTokens || 8192
  return trimByContextWindow(messages, contextWindow, maxOutputTokens)
}

function toLlmToolCall(call: { id: string; name: string; args: Record<string, unknown> }): LLMToolCall {
  return {
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.args) }
  }
}

export interface RunOptions {
  text: string
  assetIds?: string[]
  fileTexts?: FileTextAttachment[]
  /** 用户通过界面按钮确认需求(brief.confirmedAt 直接生效) */
  confirmBrief?: boolean
}

/** 确认门:①未确认需求禁止文生图 ②本轮已生成过图片时,继续 generate/edit 需先经 ask_user 征得用户同意 */
function gateCheck(toolName: string, brief: ImageBrief, imageOps: number, askApproval: boolean): string | null {
  if (toolName === 'generate_image' && !brief.confirmedAt) {
    return (
      'REJECTED:需求规格尚未经用户确认,禁止生成。' +
      '请立即:1) 向用户分条复述完整需求摘要;2) 调用 ask_user 询问"确认无误,开始生成吗?"(选项如 确认生成/需要调整,推荐前者);' +
      '3) 用户确认后调用 update_brief(confirmed=true),再调用 generate_image。'
    )
  }
  if ((toolName === 'generate_image' || toolName === 'edit_image') && imageOps >= 1 && !askApproval) {
    return (
      'REJECTED:本轮已生成过图片,继续调整需先征得用户同意。' +
      '请调用 ask_user 以选择题形式询问(如 保持这版[推荐] / 再调暗一点 / 换构图),用户同意后再重试本工具;' +
      '用户选择保留时应直接总结收尾,不再生成。'
    )
  }
  return null
}

/** 轮内展示块构建器:text / reasoning / tool 按发生顺序追加 */
class BlockCollector {
  blocks: MessageBlock[] = []
  text = ''
  reasoning = ''

  /** 关闭当前思考块(文本或工具开始时调用) */
  closeReasoning(): void {
    const last = this.blocks[this.blocks.length - 1]
    if (last?.type === 'reasoning') last.endedAt = Date.now()
  }

  pushReasoning(piece: string): void {
    const last = this.blocks[this.blocks.length - 1]
    if (last?.type === 'reasoning') {
      last.text = (last.text ?? '') + piece
    } else {
      this.closeReasoning()
      this.blocks.push({ type: 'reasoning', text: piece, startedAt: Date.now() })
    }
    this.reasoning += piece
  }

  pushText(piece: string): void {
    const last = this.blocks[this.blocks.length - 1]
    if (last?.type === 'text') {
      last.text = (last.text ?? '') + piece
    } else {
      this.closeReasoning()
      this.blocks.push({ type: 'text', text: piece })
    }
    this.text += piece
  }

  pushTool(record: ToolCallRecord): void {
    this.closeReasoning()
    this.blocks.push({ type: 'tool', tool: record })
  }

  finishReasoning(): void {
    this.closeReasoning()
  }
}

export async function runAgentTurn(sessionId: string, opts: RunOptions, emit: (ev: AgentEvent) => void): Promise<void> {
  if (activeRuns.has(sessionId)) throw new Error('当前会话正在处理中,请等待完成或点击停止')
  const db = getDb()
  const settingsStore = getSettings()
  const chatProfile = settingsStore.activeChatProfile()
  if (!chatProfile) throw new Error('尚未配置对话服务:请打开"设置"添加语言模型配置')

  const abort = new AbortController()
  activeRuns.set(sessionId, abort)

  const startedAt = Date.now()
  const collector = new BlockCollector()
  const toolRecords: ToolCallRecord[] = []
  const runAssetIds: string[] = []
  let stopReason: ChatMessage['stopReason'] = 'completed'
  // 迭代确认门状态:用户发消息即视为对本轮首个图片操作的授权;之后的自判微调需 ask_user 逐次确认
  let imageOps = 0
  let askApproval = false

  const finalize = (): ChatMessage | null => {
    collector.finishReasoning()
    if (!collector.text.trim() && !collector.reasoning.trim() && toolRecords.length === 0) return null
    return {
      id: randomUUID(),
      sessionId,
      role: 'assistant',
      text: collector.text.trim(),
      blocks: collector.blocks,
      assetIds: [...new Set(runAssetIds)],
      toolCalls: toolRecords,
      reasoning: collector.reasoning.trim() || undefined,
      createdAt: Date.now(),
      startedAt,
      durationMs: Date.now() - startedAt,
      stopReason
    }
  }

  try {
    emit({ type: 'run-start', sessionId })

    // 需求确认(界面按钮路径):直接开启确认门
    let brief = db.brief(sessionId)
    if (opts.confirmBrief && !brief.confirmedAt) {
      brief = db.patchBrief(sessionId, {}, true)
      emit({ type: 'brief-updated', sessionId, brief })
      syncSpecFile(sessionId)
    }

    const userMessage: ChatMessage = {
      id: randomUUID(),
      sessionId,
      role: 'user',
      text: opts.text,
      assetIds: opts.assetIds ?? [],
      fileTexts: opts.fileTexts,
      createdAt: Date.now()
    }
    db.addMessage(userMessage)
    emit({ type: 'user-message', sessionId, message: userMessage })

    const llmMessages = buildContext(sessionId, brief)
    const timeoutMs = settingsStore.load().chatTimeoutMs

    // 无迭代上限:由模型自行判断何时结束(无工具调用的纯文本回复即结束)
    for (;;) {
      if (abort.signal.aborted) break
      brief = db.brief(sessionId)

      const result = await streamChatCompletion({
        profile: chatProfile,
        messages: llmMessages,
        tools: TOOL_DEFS,
        timeoutMs,
        signal: abort.signal,
        onDelta: (t) => {
          collector.pushText(t)
          emit({ type: 'delta', sessionId, text: t })
        },
        onReasoningDelta: (t) => {
          collector.pushReasoning(t)
          emit({ type: 'reasoning-delta', sessionId, text: t })
        }
      })

      if (result.toolCalls.length === 0) break

      llmMessages.push({
        role: 'assistant',
        content: result.content || '',
        tool_calls: result.toolCalls.map(toLlmToolCall)
      })
      // 兜底:个别兼容端点不通过流式下发 content
      if (result.content && !collector.text) {
        collector.pushText(result.content)
        emit({ type: 'delta', sessionId, text: result.content })
      }

      const batchAssetIds: string[] = []
      for (const call of result.toolCalls) {
        if (abort.signal.aborted) break
        const record: ToolCallRecord = {
          id: call.id,
          name: call.name,
          args: call.args,
          status: 'running',
          startedAt: Date.now()
        }
        collector.pushTool(record)
        toolRecords.push(record)
        emit({ type: 'tool-status', sessionId, call: record })

        const rejection = gateCheck(call.name, brief, imageOps, askApproval)
        let resultText: string
        if (rejection) {
          record.status = 'rejected'
          record.resultSummary = '被确认门拦截:需求未确认'
          if (call.name === 'generate_image' || call.name === 'edit_image') record.resultSummary = '被迭代门拦截:需用户确认'
          record.resultFull = rejection
          record.durationMs = Date.now() - (record.startedAt ?? Date.now())
          resultText = rejection
        } else {
          const ctx: ToolCtx = { sessionId, signal: abort.signal, emit }
          // eslint-disable-next-line no-await-in-loop
          const ret = await executeTool(ctx, call.name, call.args)
          record.status = ret.ok ? 'ok' : 'error'
          record.resultSummary = ret.text.slice(0, 200)
          record.resultFull = ret.text.slice(0, 2000)
          record.assetIds = ret.assetIds
          record.error = ret.ok ? undefined : ret.text
          record.durationMs = Date.now() - (record.startedAt ?? Date.now())
          resultText = ret.text
          runAssetIds.push(...ret.assetIds)
          batchAssetIds.push(...ret.assetIds)
          // 迭代门状态推进
          if (call.name === 'generate_image' || call.name === 'edit_image') {
            imageOps += 1
            askApproval = false // 授权已消费
          }
          if (call.name === 'ask_user' && ret.ok) {
            askApproval = true // 用户刚作答,允许紧随的一次生成操作
          }
          if (call.name === 'update_brief') {
            brief = db.brief(sessionId)
            syncSpecFile(sessionId)
          }
        }
        emit({ type: 'tool-status', sessionId, call: record })

        llmMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: resultText
        })
      }

      // 工具产出的图片回注上下文,让模型亲眼看到结果再决定下一步
      if (batchAssetIds.length && !abort.signal.aborted) {
        const assets = batchAssetIds.map((id) => db.asset(id)).filter((a): a is ImageAsset => a !== undefined)
        if (assets.length) {
          const parts = buildAssetParts(assets, chatProfile.supportsVision !== false)
          const notePart = parts[0]
          const note = notePart.type === 'text' ? notePart.text : ''
          llmMessages.push({
            role: 'user',
            content: [
              { type: 'text', text: `【工具产出图片】请查看以下图片实际效果,评估是否达标:\n${note}` },
              ...parts.filter((p) => p.type === 'image_url')
            ]
          })
        }
      }
    }

    if (abort.signal.aborted) stopReason = 'aborted'
    const finalMsg = finalize()
    if (finalMsg) {
      if (stopReason === 'aborted') finalMsg.text = `${finalMsg.text}\n\n[已停止]`
      db.addMessage(finalMsg)
      emit({ type: 'message-final', sessionId, message: finalMsg })
    }
  } catch (err) {
    cancelSessionQuestions(sessionId)
    if (err instanceof Error && err.name === 'AbortError') {
      stopReason = 'aborted'
      const finalMsg = finalize()
      if (finalMsg) {
        finalMsg.text = `${finalMsg.text}\n\n[已停止]`
        db.addMessage(finalMsg)
        emit({ type: 'message-final', sessionId, message: finalMsg })
      }
    } else {
      stopReason = 'error'
      emit({ type: 'error', sessionId, message: errText(err) })
      const finalMsg = finalize()
      if (finalMsg) {
        db.addMessage(finalMsg)
        emit({ type: 'message-final', sessionId, message: finalMsg })
      }
    }
  } finally {
    activeRuns.delete(sessionId)
    emit({ type: 'run-end', sessionId })
  }
}
