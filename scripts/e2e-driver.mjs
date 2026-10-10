// E2E 驱动:通过 CDP 连接运行中的 AIImage 渲染进程,走真实 IPC 驱动 Agent 全链路
// 用法:node scripts/e2e-driver.mjs <阶段: openai|anthropic>

const phase = process.argv[2] ?? 'openai'
const DEBUG_URL = 'http://127.0.0.1:9222'
const MOCK = 'http://127.0.0.1:3117'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getPageTarget() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${DEBUG_URL}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page')
      if (page) return page
    } catch {
      // app 尚未启动
    }
    await sleep(500)
  }
  throw new Error('无法连接调试端口 9222')
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => resolve(ws)
    ws.onerror = (e) => reject(new Error(`WebSocket 连接失败: ${e.message ?? e.type}`))
  })
}

function makeRpc(ws) {
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  return (method, params) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
}

async function evaluate(rpc, expression) {
  const r = await rpc('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails))
  return r.result?.result?.value
}

// 在页面里轮询直到 Agent 运行结束(出现最终 assistant 文本或 error 事件)
async function waitForRunEnd(evaluateFn, sessionId, timeoutMs = 30000) {
  const expr = `(async () => {
    const sid = ${JSON.stringify(sessionId)}
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500))
      const h = await window.api.chat.history(sid)
      const last = h.messages[h.messages.length - 1]
      const errs = (window.__evts || []).filter(e => e.startsWith('error'))
      if (errs.length) return { kind: 'error', errs }
      if (last && last.role === 'assistant' && last.text && !last.text.endsWith('…')) return { kind: 'final' }
    }
    return { kind: 'timeout', events: window.__evts || [] }
  })()`
  return evaluateFn(expr)
}

async function summarize(evaluateFn, sessionId) {
  return evaluateFn(`(async () => {
    const sid = ${JSON.stringify(sessionId)}
    const h = await window.api.chat.history(sid)
    return {
      brief: h.brief,
      assets: Object.values(h.assets).map(a => ({ id: a.id, kind: a.kind, file: a.fileName, size: (a.width || 0) + 'x' + (a.height || 0) })),
      messages: h.messages.map(m => ({
        role: m.role,
        text: (m.text || '').slice(0, 90),
        tools: (m.toolCalls || []).map(c => c.name + ':' + c.status),
        assets: m.assetIds
      })),
      events: (window.__evts || [])
    }
  })()`)
}

async function main() {
  const target = await getPageTarget()
  const ws = await connect(target.webSocketDebuggerUrl)
  const rpc = makeRpc(ws)
  const ev = (expr) => evaluate(rpc, expr)
  const out = { phase }

  // 备份用户设置,测试结束后还原(不再污染用户配置)
  const backup = await ev('window.api.settings.get()')

  // 1. 配置 mock 模型服务
  const configExpr =
    phase === 'anthropic'
      ? `{ chatProfiles: [{ id: 'mock', name: 'MockClaude', baseUrl: '${MOCK}', apiKey: 'sk-test', model: 'mock-claude', apiFormat: 'anthropic', contextWindow: 65536, maxOutputTokens: 2048, supportsVision: true }],
           imageProfiles: [{ id: 'mockimg', name: 'MockImg', baseUrl: '${MOCK}/v1', apiKey: 'sk-test', model: 'mock-image' }],
           activeChatProfileId: 'mock', activeImageProfileId: 'mockimg',
           chatTimeoutMs: 30000, imageTimeoutMs: 60000, maxHistoryImages: 6 }`
      : `{ chatProfiles: [{ id: 'mock', name: 'MockChat', baseUrl: '${MOCK}/v1', apiKey: 'sk-test', model: 'mock-chat', apiFormat: 'openai', contextWindow: 65536, maxOutputTokens: 2048, supportsVision: true }],
           imageProfiles: [{ id: 'mockimg', name: 'MockImg', baseUrl: '${MOCK}/v1', apiKey: 'sk-test', model: 'mock-image' }],
           activeChatProfileId: 'mock', activeImageProfileId: 'mockimg',
           chatTimeoutMs: 30000, imageTimeoutMs: 60000, maxHistoryImages: 6 }`

  await ev(`(async () => { const s = await window.api.settings.get(); await window.api.settings.save({ ...s, ${configExpr.slice(1, -1)} }); return true })()`)

  // 2. 新建会话并订阅事件
  const sessionId = await ev(`(async () => {
    window.__evts = []
    window.__unsub = window.api.onAgentEvent(e => window.__evts.push(e.type + (e.message ? '::' + e.message : '')))
    const s = await window.api.sessions.create()
    return s.id
  })()`)

  if (phase === 'anthropic') {
    // Anthropic 规范:一轮 tool_use(update_brief)→ 最终文本
    await ev(`window.api.chat.send(${JSON.stringify(sessionId)}, '画一幅水墨远山', [], false)`)
    out.run1 = await waitForRunEnd(ev, sessionId)
  } else {
    // OpenAI 规范三幕:
    // 第一幕:mock 违规直接生成 → 确认门应拦截 → 改为填槽 → 复述需求请求确认
    await ev(`window.api.chat.send(${JSON.stringify(sessionId)}, '帮我画一只猫', [], false)`)
    out.run1 = await waitForRunEnd(ev, sessionId)

    // 第二幕:用户确认(confirmBrief)→ 正常生成 → 图片落盘
    await ev(`window.api.chat.send(${JSON.stringify(sessionId)}, '我确认以上需求摘要,请开始生成图片。', [], true)`)
    out.run2 = await waitForRunEnd(ev, sessionId)
  }

  out.summary = await summarize(ev, sessionId)
  // 还原用户设置
  await ev(`(async () => { await window.api.settings.save(JSON.parse(${JSON.stringify(JSON.stringify(backup))})); return true })()`)
  console.log(JSON.stringify(out, null, 2))
  ws.close()
}

main().catch((err) => {
  console.error('E2E FAILED:', err.message)
  process.exit(1)
})
