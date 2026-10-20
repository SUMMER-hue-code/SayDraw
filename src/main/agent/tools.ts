// 工具定义(function calling schema)与执行器

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { nativeImage } from 'electron'
import type { AgentEvent, ImageAsset, ImageBrief } from '@shared/types'
import { BRIEF_SLOTS } from '@shared/types'
import { getDb } from '../store/db'
import { getSettings } from '../store/settings'
import { readAssetBuffer, saveBufferAsset } from '../store/assets'
import { describeDropped, editImage, generateImages, guessMime, parseExplicitSize } from '../providers/images'
import type { GeneratedImages } from '../providers/images'
import type { LLMTool } from '../providers/chat'
import { errText } from '../providers/http'

export const TOOL_DEFS: LLMTool[] = [
  {
    type: 'function',
    function: {
      name: 'update_brief',
      description:
        '更新需求规格(填槽)。每当用户给出新信息就调用一次,只传需要更新的槽位。confirmed 参数仅在用户明确同意需求摘要后才可设为 true,绝不能自作主张设为 true。',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: '主体:画什么(人物/物体/场景)' },
          style: { type: 'string', description: '风格:摄影/插画/3D/水彩/国潮…' },
          composition: { type: 'string', description: '构图:视角、景别、布局' },
          colorTone: { type: 'string', description: '色调氛围' },
          aspectRatio: { type: 'string', description: '画面比例,取值:1:1 | 16:9 | 9:16 | 4:3 | 3:4' },
          resolution: { type: 'string', description: '输出分辨率 WxH,如 1024x1024 / 2048x2048 / 3840x2160(生成前必须明确;结合用途建议:头像/图标 1024、社交配图 2048、壁纸 3840)' },
          usage: { type: 'string', description: '用途:头像/海报/壁纸…' },
          negativePrompts: { type: 'string', description: '要避免的元素' },
          notes: { type: 'string', description: '其他补充说明' },
          confirmed: { type: 'boolean', description: '用户明确同意后设为 true' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description:
        '文生图,支持参考图融合。必须等需求规格 confirmed 为 true 之后才能调用。prompt 要融合需求规格全部有效信息,具体、有画面感。当用户提供了多张参考图(如"把三张图里的角色放到同一张图")时,必须通过 referenceAssetIds 传入这些图片,模型会将参考图中的元素融入新图。首图或大改时建议用 variants=3 一次出 3 张候选,再让用户挑选,命中率更高。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '完整的图像生成提示词;带参考图时应说明各参考图元素如何安排' },
          aspectRatio: { type: 'string', description: '画面比例,默认取需求规格中的值' },
          size: { type: 'string', description: '输出分辨率 WxH(如 2048x2048 / 3840x2160),优先于比例;生图前分辨率必须明确' },
          n: { type: 'number', description: '单次生成张数 1-4,默认 1' },
          variants: {
            type: 'number',
            description: '候选数量 2-4:一次生成多张不同候选供用户挑选(首图/大改时推荐 3);候选在用户选用前不算正式版本'
          },
          quality: {
            type: 'string',
            enum: ['auto', 'low', 'medium', 'high'],
            description: '画质档位,覆盖模型默认设置;细节要求高时用 high(更慢更贵),不确定用 auto'
          },
          referenceAssetIds: {
            type: 'array',
            items: { type: 'string' },
            description: '参考图资产 ID 列表(可选,最多 16 张,PNG/JPG/WebP,单张 ≤25MB):把这些图中的角色/风格/元素融合进新图'
          }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_image',
      description:
        '基于已有图片编辑(图生图):单图修改、蒙版局部重绘、或多张图融合(如把 A 和 B 的角色合成一张)。用户要求"改背景/换颜色/合成/融合"等连续修图时使用。用户涂抹了蒙版时必须传 maskAssetId(仅单源图有效)。',
      parameters: {
        type: 'object',
        properties: {
          assetIds: {
            type: 'array',
            items: { type: 'string' },
            description: '源图片 ID 列表(1-16 张);多张表示融合这些图'
          },
          instruction: { type: 'string', description: '编辑指令:完整描述修改/融合后的画面效果' },
          maskAssetId: { type: 'string', description: '蒙版图片 ID(用户涂抹的区域),仅单源图时可选' },
          aspectRatio: { type: 'string', description: '输出比例,默认与源图一致' },
          size: { type: 'string', description: '输出分辨率 WxH(如 2048x2048),可选;默认跟随需求规格或源图' },
          quality: {
            type: 'string',
            enum: ['auto', 'low', 'medium', 'high'],
            description: '画质档位,覆盖模型默认设置;细节要求高时用 high(更慢更贵),不确定用 auto'
          }
        },
        required: ['assetIds', 'instruction']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        '写入文件(覆盖已有内容;目录不存在会自动创建)。用于创建/更新项目文件,如把新确认的要求补充进 要求.md、输出提示词文档等。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径(项目文件放在当前项目文件夹内)' },
          content: { type: 'string', description: '完整文件内容(整体覆盖)' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '精确编辑文本文件:把 oldText 替换为 newText(oldText 必须与文件内容完全一致,含空格换行)。适合小改动,不必重写整个文件。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径' },
          oldText: { type: 'string', description: '要被替换的原文本(需与文件内容精确匹配)' },
          newText: { type: 'string', description: '替换后的新文本(传空字符串即删除)' }
        },
        required: ['path', 'oldText', 'newText']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'process_image',
      description:
        '本地处理图片(不调用生图服务):格式转换(png/jpeg)、压缩(quality 1-100,jpeg)、缩放(按百分比或最大边)。产物作为新图片进入会话。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string', description: '要处理的图片 ID(asset-xxx)' },
          format: { type: 'string', enum: ['png', 'jpeg'], description: '输出格式,默认 png' },
          quality: { type: 'number', description: 'jpeg 质量 1-100,默认 85;仅 jpeg 有效' },
          scalePercent: { type: 'number', description: '缩放百分比(如 50 表示缩小一半),可选' },
          maxWidth: { type: 'number', description: '最大宽度像素(等比缩放),可选' },
          maxHeight: { type: 'number', description: '最大高度像素(等比缩放),可选' }
        },
        required: ['assetId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_file',
      description: '移动文件到目标文件夹(重命名合并为移动)。用于整理素材、归类产出。同名文件自动加序号,不会覆盖。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '源文件绝对路径' },
          destDir: { type: 'string', description: '目标文件夹(不存在会创建)' }
        },
        required: ['path', 'destDir']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'copy_file',
      description: '复制文件到目标文件夹(保留原文件)。同名文件自动加序号,不会覆盖。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '源文件绝对路径' },
          destDir: { type: 'string', description: '目标文件夹(不存在会创建)' }
        },
        required: ['path', 'destDir']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        '向用户提问并在界面问答面板等待作答(选择题优先)。凡需要用户决策的场合——需求确认、微调方案选择、风格取舍——都必须用它,不要用纯文本提问。选项 2-4 个,必须恰好一个 recommended=true(推荐答案);开放性描述(如"描述你想要的氛围")才用纯文本提问。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '问题文本,一句话,具体可答' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: '选项文案(简短)' },
                description: { type: 'string', description: '选项说明(可选,一句话)' },
                recommended: { type: 'boolean', description: '是否为推荐答案;必须恰好一个选项为 true' }
              },
              required: ['label']
            },
            description: '选项列表(2-4 个,恰好一个推荐)'
          }
        },
        required: ['question', 'options']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description:
        '列出本机某个文件夹的内容(文件与子目录,含大小与修改时间)。用于浏览用户素材库、查找参考图片等。支持 ~ 表示用户目录。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件夹绝对路径,如 D:\\素材库 或 ~/Pictures' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取本机文本文件内容(如提示词文档、素材说明 txt/md/json 等),过长自动截断。图片文件请改用 import_image。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'import_image',
      description:
        '把本机的一张图片文件导入会话资产(之后你能看到图片内容,用户会在界面看到,且可用于 edit_image 编辑)。浏览素材库找到合适素材后用它导入。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '图片文件绝对路径(png/jpg/jpeg/webp/gif)' }
        },
        required: ['path']
      }
    }
  }
]

export interface ToolCtx {
  sessionId: string
  signal: AbortSignal
  emit: (ev: AgentEvent) => void
}

export interface ToolResult {
  ok: boolean
  text: string
  assetIds: string[]
}

// ---------- update_brief ----------

function briefSummary(brief: ImageBrief): string {
  const filled = BRIEF_SLOTS.filter((s) => {
    const v = brief[s.key]
    return typeof v === 'string' && v.trim()
  }).map((s) => `${s.label}=${String(brief[s.key]).trim()}`)
  return filled.length ? filled.join('; ') : '(空)'
}

export function execUpdateBrief(ctx: ToolCtx, args: Record<string, unknown>): ToolResult {
  const db = getDb()
  const { confirmed, ...slots } = args
  const markConfirmed = confirmed === true
  const brief = db.patchBrief(ctx.sessionId, slots as ImageBrief, markConfirmed)
  ctx.emit({ type: 'brief-updated', sessionId: ctx.sessionId, brief })
  if (markConfirmed && brief.confirmedAt) {
    return { ok: true, text: `需求已记录并标记为已确认。当前规格:${briefSummary(brief)}。现在可以调用 generate_image 执行生成。`, assetIds: [] }
  }
  return {
    ok: true,
    text: `需求已记录。当前规格:${briefSummary(brief)}。确认状态:未确认 —— 请向用户复述完整需求摘要并请求确认。`,
    assetIds: []
  }
}

// ---------- generate_image ----------

export async function execGenerateImage(ctx: ToolCtx, args: Record<string, unknown>): Promise<ToolResult> {
  const prompt = String(args.prompt ?? '').trim()
  if (!prompt) return { ok: false, text: '参数错误:prompt 不能为空', assetIds: [] }

  const profile = getSettings().activeImageProfile()
  if (!profile) {
    return { ok: false, text: '当前未配置生图服务。请告知用户:点击设置添加图片服务(OpenAI 兼容 /images 接口)后重试。', assetIds: [] }
  }

  const db = getDb()
  const brief = db.brief(ctx.sessionId)
  const ratio = (args.aspectRatio ? String(args.aspectRatio) : brief.aspectRatio) || undefined
  // 分辨率:显式 size 优先,其次需求规格 resolution,最后按比例映射
  const size = parseExplicitSize(String(args.size ?? '')) ?? parseExplicitSize(brief.resolution ?? '')
  if (args.size && !parseExplicitSize(String(args.size))) {
    return { ok: false, text: `参数错误:size 格式应为 WxH(如 2048x2048),收到 "${String(args.size)}"。`, assetIds: [] }
  }
  // 部分服务单次仅支持 1 张(如 gpt-image-2),按配置上限钳制
  const maxN = profile.maxN && profile.maxN > 0 ? profile.maxN : 4
  const n = Math.min(maxN, Math.max(1, Number(args.n ?? 1) || 1))
  // 候选数量:一次出多张供用户挑选;端点只支持单张时串行补足
  const rawVariants = Number(args.variants ?? 1)
  const variants = Number.isFinite(rawVariants) ? Math.min(4, Math.max(1, Math.trunc(rawVariants))) : 1
  // 画质档位:auto = 跟随模型配置
  const qualityArg = String(args.quality ?? '').trim()
  const quality = qualityArg && qualityArg !== 'auto' ? qualityArg : undefined
  const maxRefs = profile.maxReferenceImages ?? 16
  const maxPrompt = profile.maxPromptChars ?? 32_000

  if (prompt.length > maxPrompt) {
    return { ok: false, text: `提示词过长(${prompt.length} 字符,上限 ${maxPrompt}),请精简后重试。`, assetIds: [] }
  }

  // 参考图融合:带参考图时走 edits 端点(多图输入)
  const referenceIds = Array.isArray(args.referenceAssetIds)
    ? (args.referenceAssetIds as unknown[]).map(String).filter(Boolean).slice(0, maxRefs)
    : []
  const references = referenceIds.map((id) => db.asset(id)).filter((a): a is ImageAsset => a !== undefined && a.kind !== 'mask')
  const oversized = references.find((a) => readAssetBuffer(a).length > (profile.maxImageMB ?? 25) * 1024 * 1024)
  if (oversized) {
    return { ok: false, text: `参考图 ${oversized.id} 超过单图上限 ${profile.maxImageMB ?? 25}MB,请先缩小或换图。`, assetIds: [] }
  }

  const total = variants > 1 ? variants : n
  const isDraft = total > 1
  const batchId = isDraft ? `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` : undefined
  const timeoutMs = getSettings().load().imageTimeoutMs

  const runOnce = async (count: number): Promise<GeneratedImages> =>
    references.length > 0
      ? editImage({
          profile,
          prompt,
          images: references.map((a) => ({ buffer: readAssetBuffer(a), mime: a.mime })),
          ratio,
          size: size ?? undefined,
          quality,
          timeoutMs,
          signal: ctx.signal
        })
      : generateImages({
          profile,
          prompt,
          ratio,
          size: size ?? undefined,
          n: count,
          quality,
          timeoutMs,
          signal: ctx.signal
        })

  const results: GeneratedImages[] = []
  if (references.length === 0 && maxN >= total) {
    // 端点支持一次多张:一次调用出全部候选,少一轮等待
    results.push(await runOnce(total))
  } else {
    // 端点只支持单张或带参考图:串行补足;用户取消立即停止
    for (let i = 0; i < total; i++) {
      if (ctx.signal?.aborted) break
      // eslint-disable-next-line no-await-in-loop
      results.push(await runOnce(1))
    }
  }

  const buffers = results.flatMap((r) => r.buffers)
  if (!buffers.length) {
    return { ok: false, text: '生成被取消,或接口未返回任何图片。', assetIds: [] }
  }

  const assetIds: string[] = []
  for (const buffer of buffers) {
    const asset = saveBufferAsset({
      sessionId: ctx.sessionId,
      buffer,
      mime: guessMime(buffer),
      kind: 'generated',
      prompt,
      draft: isDraft || undefined,
      batchId
    })
    assetIds.push(asset.id)
    ctx.emit({ type: 'asset-added', sessionId: ctx.sessionId, asset })
  }

  const dropped = Array.from(new Set(results.flatMap((r) => r.dropped)))
  const requestedSize = results[0]?.requestedSize
  const actualSize = results[0]?.actualSize
  const parts: string[] = [
    isDraft ? `已生成 ${assetIds.length} 张候选图:${assetIds.join(', ')}(同批次)` : `已生成图片:${assetIds.join(', ')}`
  ]
  if (references.length > 0) parts.push(`已融合 ${references.length} 张参考图`)
  if (requestedSize || actualSize) {
    parts.push(
      requestedSize && actualSize && requestedSize !== actualSize
        ? `请求 ${requestedSize},实际返回 ${actualSize}`
        : `尺寸 ${actualSize ?? requestedSize}`
    )
  }
  const dropNote = describeDropped(dropped)
  if (dropNote) parts.push(`${dropNote}(画质可能受影响,请如实告知用户)`)
  if (isDraft) {
    parts.push('候选图尚未进入版本链:请用 ask_user 让用户挑选(2-4 个选项,推荐项按你的专业判断),选定后以该图为源继续')
  }
  parts.push('请向用户简短说明结果与下一步建议')
  return { ok: true, text: `${parts.join(';')}。`, assetIds }
}

// ---------- edit_image ----------

export async function execEditImage(ctx: ToolCtx, args: Record<string, unknown>): Promise<ToolResult> {
  const db = getDb()
  const instruction = String(args.instruction ?? '').trim()
  const maskAssetId = args.maskAssetId ? String(args.maskAssetId) : undefined
  if (!instruction) return { ok: false, text: '参数错误:assetIds 与 instruction 必填', assetIds: [] }

  const profile = getSettings().activeImageProfile()
  if (!profile) {
    return { ok: false, text: '当前未配置生图服务。请告知用户:在设置中添加图片服务(需支持 /images/edits)后重试。', assetIds: [] }
  }
  const maxRefs = profile.maxReferenceImages ?? 16
  if (instruction.length > (profile.maxPromptChars ?? 32_000)) {
    return { ok: false, text: `编辑指令过长(上限 ${profile.maxPromptChars ?? 32000} 字符),请精简后重试。`, assetIds: [] }
  }

  const ids = (Array.isArray(args.assetIds) ? (args.assetIds as unknown[]).map(String) : args.assetId ? [String(args.assetId)] : [])
    .filter(Boolean)
    .slice(0, maxRefs)

  const sources = ids.map((id) => db.asset(id)).filter((a): a is ImageAsset => a !== undefined && a.kind !== 'mask')
  if (sources.length === 0) {
    return { ok: false, text: `未找到可编辑的图片,请使用上下文中标注的资产 ID。`, assetIds: [] }
  }
  const oversized = sources.find((a) => readAssetBuffer(a).length > (profile.maxImageMB ?? 25) * 1024 * 1024)
  if (oversized) {
    return { ok: false, text: `源图 ${oversized.id} 超过单图上限 ${profile.maxImageMB ?? 25}MB,请先缩小或换图。`, assetIds: [] }
  }

  let mask: Buffer | undefined
  if (maskAssetId) {
    if (sources.length > 1) {
      return { ok: false, text: '蒙版仅支持单张源图;多图融合请去掉 maskAssetId,在 instruction 中描述各图元素的位置安排。', assetIds: [] }
    }
    const maskAsset = db.asset(maskAssetId)
    if (!maskAsset) return { ok: false, text: `蒙版图片 ${maskAssetId} 不存在。`, assetIds: [] }
    mask = readAssetBuffer(maskAsset)
  }

  const qualityArg = String(args.quality ?? '').trim()
  const result = await editImage({
    profile,
    prompt: instruction,
    images: sources.map((a) => ({ buffer: readAssetBuffer(a), mime: a.mime })),
    mask,
    ratio: args.aspectRatio ? String(args.aspectRatio) : undefined,
    size: parseExplicitSize(String(args.size ?? '')) ?? undefined,
    quality: qualityArg && qualityArg !== 'auto' ? qualityArg : undefined,
    timeoutMs: getSettings().load().imageTimeoutMs,
    signal: ctx.signal
  })

  const primary = sources[0]
  const assetIds: string[] = []
  for (const buffer of result.buffers) {
    const asset: ImageAsset = saveBufferAsset({
      sessionId: ctx.sessionId,
      buffer,
      mime: guessMime(buffer),
      kind: 'edited',
      parentId: primary.id,
      prompt: instruction
    })
    assetIds.push(asset.id)
    ctx.emit({ type: 'asset-added', sessionId: ctx.sessionId, asset })
  }
  const srcNote = sources.length > 1 ? `融合 ${sources.length} 张源图(${sources.map((s) => s.id).join(' + ')})` : `基于 ${primary.id}`
  const sizeNote = result.actualSize ? `;实际 ${result.actualSize}` : ''
  const dropNote = describeDropped(result.dropped)
  const degradeNote = dropNote ? `;${dropNote}` : ''
  return {
    ok: true,
    text: `已完成编辑,${srcNote} 生成 ${assetIds.length} 张新图:${assetIds.join(', ')}${sizeNote}${degradeNote}。请向用户展示结果。`,
    assetIds
  }
}

// ---------- 文件系统工具 ----------

function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/png'
}
const MAX_READ_CHARS = 8000
const MAX_DIR_ENTRIES = 300

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export function execListDirectory(_ctx: ToolCtx, args: Record<string, unknown>): ToolResult {
  const raw = String(args.path ?? '').trim()
  if (!raw) return { ok: false, text: '参数错误:path 不能为空', assetIds: [] }
  const dir = path.resolve(expandHome(raw))
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    return { ok: false, text: `无法读取目录 ${dir}:${err instanceof Error ? err.message : String(err)}`, assetIds: [] }
  }
  const lines: string[] = [`目录 ${dir} 共 ${entries.length} 项:`]
  // 目录在前,名称排序
  const sorted = [...entries].sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
  const shown = sorted.slice(0, MAX_DIR_ENTRIES)
  for (const e of shown) {
    if (e.isDirectory()) {
      lines.push(`[目录] ${e.name}/`)
    } else {
      try {
        const st = fs.statSync(path.join(dir, e.name))
        lines.push(`[文件] ${e.name} (${fmtSize(st.size)}, ${new Date(st.mtimeMs).toLocaleDateString('zh-CN')})`)
      } catch {
        lines.push(`[文件] ${e.name}`)
      }
    }
  }
  if (sorted.length > shown.length) lines.push(`… 其余 ${sorted.length - shown.length} 项未显示,可进入子目录查看`)
  return { ok: true, text: lines.join('\n').slice(0, 12000), assetIds: [] }
}

export function execReadFile(_ctx: ToolCtx, args: Record<string, unknown>): ToolResult {
  const raw = String(args.path ?? '').trim()
  if (!raw) return { ok: false, text: '参数错误:path 不能为空', assetIds: [] }
  const file = path.resolve(expandHome(raw))
  let buffer: Buffer
  try {
    buffer = fs.readFileSync(file)
  } catch (err) {
    return { ok: false, text: `无法读取文件 ${file}:${err instanceof Error ? err.message : String(err)}`, assetIds: [] }
  }
  if (IMAGE_EXTS.has(path.extname(file).toLowerCase())) {
    return { ok: false, text: '这是图片文件,请改用 import_image 导入后直接查看。', assetIds: [] }
  }
  if (buffer.length > 2 * 1024 * 1024) {
    return { ok: false, text: `文件过大(${fmtSize(buffer.length)}),请指定更小的文本文件。`, assetIds: [] }
  }
  const text = buffer.toString('utf8')
  if (text.includes('\u0000')) {
    return { ok: false, text: '这是二进制文件,无法按文本读取。', assetIds: [] }
  }
  const truncated = text.length > MAX_READ_CHARS
  return { ok: true, text: `${file}\n\n${text.slice(0, MAX_READ_CHARS)}${truncated ? `\n…(已截断,原文 ${text.length} 字符)` : ''}`, assetIds: [] }
}

export function execImportImage(ctx: ToolCtx, args: Record<string, unknown>): ToolResult {
  const raw = String(args.path ?? '').trim()
  if (!raw) return { ok: false, text: '参数错误:path 不能为空', assetIds: [] }
  const file = path.resolve(expandHome(raw))
  const ext = path.extname(file).toLowerCase()
  if (!IMAGE_EXTS.has(ext)) {
    return { ok: false, text: `不支持的图片格式:${ext || '(无扩展名)'}。支持 png/jpg/jpeg/webp/gif/bmp。`, assetIds: [] }
  }
  // 单图上限跟随当前生图服务配置(默认 25MB,与参考图一致)
  const imageProfile = getSettings().activeImageProfile()
  const maxBytes = (imageProfile?.maxImageMB ?? 25) * 1024 * 1024
  let buffer: Buffer
  try {
    const st = fs.statSync(file)
    if (st.size > maxBytes) return { ok: false, text: `图片过大(${fmtSize(st.size)},上限 ${imageProfile?.maxImageMB ?? 25}MB)。`, assetIds: [] }
    buffer = fs.readFileSync(file)
  } catch (err) {
    return { ok: false, text: `无法读取图片 ${file}:${err instanceof Error ? err.message : String(err)}`, assetIds: [] }
  }
  const asset = saveBufferAsset({
    sessionId: ctx.sessionId,
    buffer,
    mime: MIME_BY_EXT[ext] ?? 'image/png',
    kind: 'user-upload',
    prompt: `导入自 ${file}`
  })
  ctx.emit({ type: 'asset-added', sessionId: ctx.sessionId, asset })
  return { ok: true, text: `已导入图片 ${asset.id}(${path.basename(file)},${fmtSize(buffer.length)})。图片内容已附在后续上下文中,可直接查看。`, assetIds: [asset.id] }
}

const MAX_WRITE_CHARS = 200_000

export function execWriteFile(_ctx: ToolCtx, args: Record<string, unknown>): ToolResult {
  const raw = String(args.path ?? '').trim()
  const content = String(args.content ?? '')
  if (!raw) return { ok: false, text: '参数错误:path 不能为空', assetIds: [] }
  if (content.length > MAX_WRITE_CHARS) {
    return { ok: false, text: `内容过长(${content.length} 字符,上限 ${MAX_WRITE_CHARS}),请分次写入。`, assetIds: [] }
  }
  const file = path.resolve(expandHome(raw))
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const existed = fs.existsSync(file)
    fs.writeFileSync(file, content, 'utf8')
    return { ok: true, text: `${existed ? '已覆盖' : '已创建'} ${file}(${content.length} 字符)。`, assetIds: [] }
  } catch (err) {
    return { ok: false, text: `写入失败 ${file}:${err instanceof Error ? err.message : String(err)}`, assetIds: [] }
  }
}

export function execEditFile(_ctx: ToolCtx, args: Record<string, unknown>): ToolResult {
  const raw = String(args.path ?? '').trim()
  const oldText = String(args.oldText ?? '')
  const newText = String(args.newText ?? '')
  if (!raw || !oldText) return { ok: false, text: '参数错误:path 与 oldText 必填(oldText 不能为空)', assetIds: [] }
  const file = path.resolve(expandHome(raw))
  let content: string
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch (err) {
    return { ok: false, text: `无法读取文件 ${file}:${err instanceof Error ? err.message : String(err)}`, assetIds: [] }
  }
  const count = content.split(oldText).length - 1
  if (count === 0) {
    return { ok: false, text: `未在 ${file} 中找到要替换的文本。请先用 read_file 核对原文(注意空格与换行)。`, assetIds: [] }
  }
  try {
    fs.writeFileSync(file, content.split(oldText).join(newText), 'utf8')
    const note = count > 1 ? `(共替换 ${count} 处)` : ''
    return { ok: true, text: `已编辑 ${file}:替换完成${note}。`, assetIds: [] }
  } catch (err) {
    return { ok: false, text: `写入失败 ${file}:${err instanceof Error ? err.message : String(err)}`, assetIds: [] }
  }
}

// ---------- 图片本地处理与文件整理 ----------

function uniqueDest(destDir: string, name: string): string {
  let target = path.join(destDir, name)
  if (!fs.existsSync(target)) return target
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  for (let i = 2; i < 1000; i++) {
    target = path.join(destDir, `${base} (${i})${ext}`)
    if (!fs.existsSync(target)) return target
  }
  throw new Error('目标目录同名文件过多')
}

export function execMoveFile(_ctx: ToolCtx, args: Record<string, unknown>): ToolResult {
  const src = path.resolve(expandHome(String(args.path ?? '').trim()))
  const destDir = path.resolve(expandHome(String(args.destDir ?? '').trim()))
  if (!src || !destDir) return { ok: false, text: '参数错误:path 与 destDir 必填', assetIds: [] }
  try {
    if (!fs.existsSync(src)) return { ok: false, text: `源文件不存在:${src}`, assetIds: [] }
    fs.mkdirSync(destDir, { recursive: true })
    const target = uniqueDest(destDir, path.basename(src))
    try {
      fs.renameSync(src, target)
    } catch {
      // 跨盘移动:复制后删除
      fs.copyFileSync(src, target)
      fs.unlinkSync(src)
    }
    return { ok: true, text: `已移动:${src} → ${target}`, assetIds: [] }
  } catch (err) {
    return { ok: false, text: `移动失败:${err instanceof Error ? err.message : String(err)}`, assetIds: [] }
  }
}

export function execCopyFile(_ctx: ToolCtx, args: Record<string, unknown>): ToolResult {
  const src = path.resolve(expandHome(String(args.path ?? '').trim()))
  const destDir = path.resolve(expandHome(String(args.destDir ?? '').trim()))
  if (!src || !destDir) return { ok: false, text: '参数错误:path 与 destDir 必填', assetIds: [] }
  try {
    if (!fs.existsSync(src)) return { ok: false, text: `源文件不存在:${src}`, assetIds: [] }
    fs.mkdirSync(destDir, { recursive: true })
    const target = uniqueDest(destDir, path.basename(src))
    fs.copyFileSync(src, target)
    return { ok: true, text: `已复制:${src} → ${target}`, assetIds: [] }
  } catch (err) {
    return { ok: false, text: `复制失败:${err instanceof Error ? err.message : String(err)}`, assetIds: [] }
  }
}

export function execProcessImage(ctx: ToolCtx, args: Record<string, unknown>): ToolResult {
  const assetId = String(args.assetId ?? '')
  const format = String(args.format ?? 'png').toLowerCase() as 'png' | 'jpeg'
  const quality = Math.min(100, Math.max(1, Number(args.quality ?? 85) || 85))
  if (!assetId) return { ok: false, text: '参数错误:assetId 必填', assetIds: [] }
  if (format !== 'png' && format !== 'jpeg') {
    return { ok: false, text: '本地处理仅支持 png / jpeg 输出(webp 等请换用生图服务)。', assetIds: [] }
  }
  const db = getDb()
  const asset = db.asset(assetId)
  if (!asset || asset.kind === 'mask') return { ok: false, text: `图片 ${assetId} 不存在或不可处理。`, assetIds: [] }

  let img = nativeImage.createFromBuffer(readAssetBuffer(asset))
  if (img.isEmpty()) {
    return { ok: false, text: '该图片格式无法本地解码(支持 png/jpg),请改用生图服务处理。', assetIds: [] }
  }
  const before = img.getSize()
  const scalePercent = Number(args.scalePercent)
  const maxWidth = Number(args.maxWidth)
  const maxHeight = Number(args.maxHeight)
  let targetW = before.width
  let targetH = before.height
  if (scalePercent > 0 && scalePercent !== 100) {
    targetW = Math.max(1, Math.round((before.width * scalePercent) / 100))
    targetH = Math.max(1, Math.round((before.height * scalePercent) / 100))
  }
  if (maxWidth > 0 && targetW > maxWidth) {
    targetH = Math.max(1, Math.round((targetH * maxWidth) / targetW))
    targetW = maxWidth
  }
  if (maxHeight > 0 && targetH > maxHeight) {
    targetW = Math.max(1, Math.round((targetW * maxHeight) / targetH))
    targetH = maxHeight
  }
  if (targetW !== before.width || targetH !== before.height) {
    img = img.resize({ width: targetW, height: targetH, quality: 'good' })
  }
  const buffer = format === 'jpeg' ? img.toJPEG(quality) : img.toPNG()
  const ops: string[] = []
  if (targetW !== before.width || targetH !== before.height) ops.push(`缩放 ${before.width}×${before.height}→${targetW}×${targetH}`)
  ops.push(`转 ${format}${format === 'jpeg' ? ` q${quality}` : ''}`)
  const newAsset = saveBufferAsset({
    sessionId: ctx.sessionId,
    buffer,
    mime: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    kind: 'edited',
    parentId: asset.id,
    prompt: `本地处理:${ops.join(', ')}`
  })
  ctx.emit({ type: 'asset-added', sessionId: ctx.sessionId, asset: newAsset })
  return {
    ok: true,
    text: `已处理 ${asset.id}:${ops.join(',')};新图 ${newAsset.id}(${fmtSize(buffer.length)})。`,
    assetIds: [newAsset.id]
  }
}

// ---------- 用户提问 ----------

import { randomUUID } from 'node:crypto'
import type { AgentQuestion, AgentQuestionOption } from '@shared/types'
import { askUser } from './askUser'

export async function execAskUser(ctx: ToolCtx, args: Record<string, unknown>): Promise<ToolResult> {
  const text = String(args.question ?? '').trim()
  if (!text) return { ok: false, text: '参数错误:question 不能为空', assetIds: [] }
  const rawOptions = Array.isArray(args.options) ? (args.options as Record<string, unknown>[]) : []
  const options: AgentQuestionOption[] = rawOptions
    .map((o) => ({
      label: String(o.label ?? '').trim(),
      description: o.description ? String(o.description) : undefined,
      recommended: o.recommended === true
    }))
    .filter((o) => o.label)
  if (options.length < 2) {
    return { ok: false, text: '参数错误:选择题至少需要 2 个选项;开放性问题请改用纯文本向用户提问。', assetIds: [] }
  }
  if (options.filter((o) => o.recommended).length !== 1) {
    return { ok: false, text: '参数错误:必须恰好一个选项 recommended=true(推荐答案)。', assetIds: [] }
  }

  const question: AgentQuestion = {
    id: `q-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
    text,
    options,
    allowFreeText: true
  }
  ctx.emit({ type: 'ask-user', sessionId: ctx.sessionId, question })
  const answer = await askUser(ctx.sessionId, question)
  if (answer.startsWith('用户未回答')) {
    return { ok: true, text: `${answer}。请停止调整,直接总结当前结果收尾。`, assetIds: [] }
  }
  return { ok: true, text: `用户选择:"${answer}"。请以该选择为准继续。`, assetIds: [] }
}

// ---------- 分发 ----------

export async function executeTool(ctx: ToolCtx, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case 'update_brief':
        return execUpdateBrief(ctx, args)
      case 'generate_image':
        return await execGenerateImage(ctx, args)
      case 'edit_image':
        return await execEditImage(ctx, args)
      case 'list_directory':
        return execListDirectory(ctx, args)
      case 'read_file':
        return execReadFile(ctx, args)
      case 'import_image':
        return execImportImage(ctx, args)
      case 'write_file':
        return execWriteFile(ctx, args)
      case 'edit_file':
        return execEditFile(ctx, args)
      case 'process_image':
        return execProcessImage(ctx, args)
      case 'move_file':
        return execMoveFile(ctx, args)
      case 'copy_file':
        return execCopyFile(ctx, args)
      case 'ask_user':
        return await execAskUser(ctx, args)
      default:
        return { ok: false, text: `未知工具:${name}`, assetIds: [] }
    }
  } catch (err) {
    return { ok: false, text: `工具执行失败:${errText(err)}`, assetIds: [] }
  }
}
