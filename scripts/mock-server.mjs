// 本地 mock 模型服务:验证 Agent 核心链路(无需真实 API Key)
// 实现:OpenAI 规范 /v1/chat/completions(SSE)+ /v1/images/generations + /v1/models
//      Anthropic 规范 /v1/messages(SSE,含 tool_use)

import http from 'node:http'

const PORT = 3117

// 1x1 透明 PNG
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function json(res, obj, status = 200) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data ? JSON.parse(data) : {}))
  })
}

// ---------- OpenAI 规范决策 ----------

function decideOpenAi(body) {
  const msgs = body.messages ?? []
  const sys = typeof msgs[0]?.content === 'string' ? msgs[0].content : ''
  const confirmed = sys.includes('已确认(用户已同意按此规格生成)')
  const toolMsgs = msgs.filter((m) => m.role === 'tool')
  const lastTool = toolMsgs.length ? String(toolMsgs[toolMsgs.length - 1].content) : ''

  if (!toolMsgs.length) {
    // 第一轮:未确认时故意违规直接生成(测需求确认门);已确认则正常生成
    return { kind: 'tool', name: 'generate_image', args: { prompt: 'a watercolor cat', aspectRatio: '1:1', n: 1 } }
  }
  if (lastTool.startsWith('REJECTED') && lastTool.includes('本轮已生成过图片')) {
    // 迭代门拦截 → 按指引询问用户(选择题,带推荐项)
    return {
      kind: 'tool',
      name: 'ask_user',
      args: {
        question: '当前结果是否需要微调?',
        options: [
          { label: '再调暗一点', description: '整体色调压暗', recommended: true },
          { label: '保持这版' }
        ]
      }
    }
  }
  if (lastTool.startsWith('REJECTED')) {
    return { kind: 'tool', name: 'update_brief', args: { subject: '一只猫', style: '水彩插画', aspectRatio: '1:1' } }
  }
  if (lastTool.startsWith('需求已记录')) {
    return { kind: 'text', text: `我复述一下需求:主体=一只猫;风格=水彩插画;比例=1:1${confirmed ? '(已确认)' : ''}。${confirmed ? '' : '确认无误后我就开始生成,可以吗?'}` }
  }
  // 从最近的工具结果里回溯真实 asset id(ask_user 的结果里没有,需要扫描全部)
  const lastAssetId = () => {
    for (let i = toolMsgs.length - 1; i >= 0; i--) {
      const m = String(toolMsgs[i].content).match(/asset-[\w-]+/)
      if (m) return m[0]
    }
    return 'asset-x'
  }
  if (lastTool.startsWith('已生成')) {
    // 生成成功后故意直接再编辑(测迭代门拦截)
    return { kind: 'tool', name: 'edit_image', args: { assetIds: [lastAssetId()], instruction: 'darker' } }
  }
  if (lastTool.startsWith('用户选择')) {
    // 用户已通过问答面板同意 → 再次编辑(应放行)
    return { kind: 'tool', name: 'edit_image', args: { assetIds: [lastAssetId()], instruction: 'darker v2' } }
  }
  if (lastTool.startsWith('已完成编辑')) {
    return { kind: 'text', text: '已完成微调(经用户确认),这版色调更沉,请查看。' }
  }
  return { kind: 'text', text: 'mock fallback' }
}

function sse(res, chunks, doneMarker) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  let i = 0
  const tick = () => {
    if (i < chunks.length) {
      res.write(`data: ${JSON.stringify(chunks[i++])}\n\n`)
      setTimeout(tick, 15)
    } else {
      res.write('data: [DONE]\n\n')
      res.end()
    }
  }
  tick()
}

function openaiChatStream(req, res, body) {
  const decision = decideOpenAi(body)
  const chunks = []
  if (decision.kind === 'text') {
    // 先流式输出一段思考内容,验证思考块管线
    for (const piece of '用户想要一张猫的图,我先复述需求再请求确认。'.match(/.{1,6}/gs) ?? []) {
      chunks.push({ choices: [{ delta: { reasoning_content: piece }, finish_reason: null }] })
    }
    for (const piece of decision.text.match(/.{1,8}/gs) ?? []) {
      chunks.push({ choices: [{ delta: { content: piece }, finish_reason: null }] })
    }
    chunks.push({ choices: [{ delta: {}, finish_reason: 'stop' }] })
  } else {
    chunks.push({
      choices: [
        {
          delta: { tool_calls: [{ index: 0, id: `call_${Date.now()}`, function: { name: decision.name, arguments: JSON.stringify(decision.args) } }] },
          finish_reason: null
        }
      ]
    })
    chunks.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
  }
  sse(res, chunks)
}

// ---------- Anthropic 规范决策 ----------

function decideAnthropic(body) {
  const blocks = (body.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : []))
  const hasToolResult = blocks.some((b) => b.type === 'tool_result')
  if (!hasToolResult) {
    return { kind: 'tool', name: 'update_brief', args: { subject: '远山', style: '水墨画', aspectRatio: '16:9' } }
  }
  return { kind: 'text', text: 'Anthropic 链路验证成功:需求已记录(远山·水墨·16:9)。' }
}

function anthropicStream(req, res, body) {
  const decision = decideAnthropic(body)
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
  send({ type: 'message_start', message: { role: 'assistant' } })
  if (decision.kind === 'text') {
    send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    for (const piece of decision.text.match(/.{1,8}/gs) ?? []) {
      send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } })
    }
    send({ type: 'content_block_stop', index: 0 })
    send({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })
  } else {
    send({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${Date.now()}`, name: decision.name, input: {} } })
    send({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(decision.args) } })
    send({ type: 'content_block_stop', index: 0 })
    send({ type: 'message_delta', delta: { stop_reason: 'tool_use' } })
  }
  send({ type: 'message_stop' })
  res.end()
}

// ---------- HTTP 服务 ----------

const server = http.createServer(async (req, res) => {
  const url = req.url ?? ''
  try {
    if (req.method === 'POST' && url.endsWith('/chat/completions')) {
      openaiChatStream(req, res, await readBody(req))
    } else if (req.method === 'POST' && url.endsWith('/messages')) {
      anthropicStream(req, res, await readBody(req))
    } else if (req.method === 'POST' && url.endsWith('/images/generations')) {
      json(res, { data: [{ b64_json: TINY_PNG }] })
    } else if (req.method === 'POST' && url.endsWith('/images/edits')) {
      json(res, { data: [{ b64_json: TINY_PNG }] })
    } else if (req.method === 'GET' && url.endsWith('/models')) {
      json(res, { data: [{ id: 'mock-chat' }, { id: 'mock-image' }] })
    } else {
      json(res, { error: { message: `not found: ${req.method} ${url}` } }, 404)
    }
  } catch (err) {
    json(res, { error: { message: String(err) } }, 500)
  }
})

server.listen(PORT, '127.0.0.1', () => console.log(`mock-llm listening on http://127.0.0.1:${PORT}`))
