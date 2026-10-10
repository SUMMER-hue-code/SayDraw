// 展示辅助:时长格式化、工具卡片的标签与参数摘要

import type { ToolCallRecord } from '@shared/types'

/** <60s → "X.X 秒";否则 "X 分 Y 秒" */
export function fmtDuration(ms: number): string {
  if (ms < 0) ms = 0
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)} 秒`
  const m = Math.floor(s / 60)
  return `${m} 分 ${Math.round(s - m * 60)} 秒`
}

type ToolKind = 'read' | 'write' | 'brief' | 'image'

interface ToolMeta {
  label: string
  kind: ToolKind
  summarize: (args: Record<string, unknown>) => string
}

function firstLine(s: unknown, n = 18): string {
  const str = String(s ?? '').trim().split('\n')[0] ?? ''
  return str.length > n ? `${str.slice(0, n)}…` : str
}

const TOOL_META: Record<string, ToolMeta> = {
  update_brief: {
    label: '记录需求',
    kind: 'brief',
    summarize: (a) => {
      if (a.confirmed === true) return '确认需求'
      const keys = Object.keys(a).filter((k) => k !== 'confirmed')
      const LABELS: Record<string, string> = {
        subject: '主体', style: '风格', composition: '构图', colorTone: '色调',
        aspectRatio: '比例', usage: '用途', negativePrompts: '避免', notes: '补充'
      }
      return keys.map((k) => LABELS[k] ?? k).join('、') || '(空)'
    }
  },
  generate_image: {
    label: '生成图片',
    kind: 'image',
    summarize: (a) => {
      const refs = Array.isArray(a.referenceAssetIds) ? a.referenceAssetIds.length : 0
      return `${a.aspectRatio ?? '默认比例'}${a.n ? ` · ${a.n} 张` : ''}${refs ? ` · 融合 ${refs} 张参考图` : ''}`
    }
  },
  edit_image: {
    label: '编辑图片',
    kind: 'image',
    summarize: (a) => {
      const ids = Array.isArray(a.assetIds) ? (a.assetIds as unknown[]) : a.assetId ? [a.assetId] : []
      const multi = ids.length > 1 ? `融合 ${ids.length} 图` : `${String(ids[0] ?? '').slice(0, 14)}…`
      return `${multi}${a.maskAssetId ? ' · 含蒙版' : ''}`
    }
  },
  list_directory: { label: '浏览目录', kind: 'read', summarize: (a) => firstLine(a.path, 40) },
  read_file: { label: '读取文件', kind: 'read', summarize: (a) => firstLine(a.path, 40) },
  import_image: { label: '导入图片', kind: 'read', summarize: (a) => firstLine(a.path, 40) },
  write_file: { label: '写入文件', kind: 'write', summarize: (a) => firstLine(a.path, 40) },
  edit_file: { label: '编辑文件', kind: 'write', summarize: (a) => firstLine(a.path, 40) },
  move_file: { label: '移动文件', kind: 'write', summarize: (a) => `${firstLine(a.path, 24)} → ${firstLine(a.destDir, 20)}` },
  copy_file: { label: '复制文件', kind: 'write', summarize: (a) => `${firstLine(a.path, 24)} → ${firstLine(a.destDir, 20)}` },
  process_image: {
    label: '处理图片',
    kind: 'image',
    summarize: (a) => `${a.format ?? 'png'}${a.quality ? ` q${a.quality}` : ''}${a.scalePercent ? ` · ${a.scalePercent}%` : ''}${a.maxWidth || a.maxHeight ? ` · ≤${a.maxWidth || a.maxHeight}px` : ''}`
  },
  ask_user: {
    label: '询问用户',
    kind: 'brief',
    summarize: (a) => firstLine(a.question, 30)
  }
}

export function toolMeta(name: string): ToolMeta {
  return TOOL_META[name] ?? { label: name, kind: 'read', summarize: () => '' }
}

export function statusIcon(call: ToolCallRecord): string {
  switch (call.status) {
    case 'running':
      return '⏳'
    case 'ok':
      return '✓'
    case 'error':
      return '✗'
    case 'rejected':
      return '⛔'
    default:
      return '·'
  }
}

export const STOP_LABEL: Record<string, { text: string; cls: string }> = {
  completed: { text: '已完成', cls: 'text-emerald-400' },
  aborted: { text: '已停止', cls: 'text-amber-400' },
  error: { text: '出错', cls: 'text-red-400' }
}
