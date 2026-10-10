// 极简 Markdown 渲染(转义 + 围栏代码/行内代码/粗体/标题/列表),无需第三方依赖
// 输出仅包含白名单标签,经 dangerouslySetInnerHTML 使用

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

export function renderMarkdown(src: string): string {
  const lines = src.split('\n')
  const out: string[] = []
  let inCode = false
  let listOpen = false

  const closeList = (): void => {
    if (listOpen) {
      out.push('</ul>')
      listOpen = false
    }
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        out.push('</code></pre>')
        inCode = false
      } else {
        closeList()
        out.push('<pre><code>')
        inCode = true
      }
      continue
    }
    if (inCode) {
      out.push(`${escapeHtml(raw)}\n`)
      continue
    }
    const trimmed = line.trim()
    if (!trimmed) {
      closeList()
      continue
    }
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!listOpen) {
        out.push('<ul>')
        listOpen = true
      }
      out.push(`<li>${inline(escapeHtml(trimmed.slice(2)))}</li>`)
      continue
    }
    closeList()
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      out.push(`<h3>${inline(escapeHtml(heading[2]))}</h3>`)
      continue
    }
    out.push(`<p>${inline(escapeHtml(trimmed))}</p>`)
  }
  closeList()
  if (inCode) out.push('</code></pre>')
  return out.join('')
}
