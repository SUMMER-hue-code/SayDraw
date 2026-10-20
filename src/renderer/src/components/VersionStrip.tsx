import { useEffect } from 'react'
import { assetUrl } from '@shared/ipc'
import type { ImageAsset } from '@shared/types'
import { useChatStore } from '../stores/chat'
import { useCanvasStore } from '../stores/canvas'
import { useViewerStore } from '../stores/viewer'

const KIND_ICON: Record<ImageAsset['kind'], string> = {
  'user-upload': '⬆',
  generated: '✦',
  edited: '✎',
  mask: '🖌'
}

export default function VersionStrip() {
  const assets = useChatStore((s) => s.assets)
  const baseAssetId = useCanvasStore((s) => s.baseAssetId)
  const setBase = useCanvasStore((s) => s.setBase)

  const list = Object.values(assets)
    .filter((a) => a.kind !== 'mask')
    .sort((a, b) => a.createdAt - b.createdAt)

  // 未选择时自动定位到最新一张
  useEffect(() => {
    if (!baseAssetId && list.length > 0) setBase(list[list.length - 1].id)
  }, [baseAssetId, list, setBase])

  return (
    <section className="rounded-xl border border-zinc-800 bg-[#15171c]">
      <header className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-zinc-300">🗂 版本链</h2>
        <span className="text-[10px] text-zinc-500">{list.length} 张</span>
      </header>
      {list.length === 0 ? (
        <p className="px-3 py-4 text-center text-[11px] text-zinc-600">暂无图片;每次生成 / 编辑都会记录版本</p>
      ) : (
        <div className="grid grid-cols-4 gap-2 p-2.5">
          {list.map((asset) => (
            <button
              key={asset.id}
              className={`group relative overflow-hidden rounded-lg border ${
                asset.draft
                  ? asset.id === baseAssetId
                    ? 'border-dashed border-amber-400 ring-1 ring-amber-400/60'
                    : 'border-dashed border-amber-500/50 hover:border-amber-400'
                  : asset.id === baseAssetId
                    ? 'border-emerald-500 ring-1 ring-emerald-500/60'
                    : 'border-zinc-700/60 hover:border-zinc-500'
              }`}
              onClick={() => setBase(asset.id)}
              onDoubleClick={() => useViewerStore.getState().open(asset.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                void window.api.assets.contextMenu(asset.id)
              }}
              title={`${asset.kind === 'edited' ? '编辑' : asset.kind === 'generated' ? '生成' : '上传'}${
                asset.parentId ? '(基于上一版)' : ''
              }${asset.draft ? ' · 待选候选' : ''}\n${new Date(asset.createdAt).toLocaleTimeString()}`}
            >
              <img src={assetUrl(asset.sessionId, asset.fileName)} alt={asset.id} className="aspect-square w-full object-cover" />
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] leading-4 text-zinc-200">
                {KIND_ICON[asset.kind]}
              </span>
              {asset.draft && (
                <span className="absolute right-1 top-1 rounded bg-amber-400/95 px-1 text-[9px] leading-4 font-medium text-black">
                  待选
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
