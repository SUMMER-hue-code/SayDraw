# 说画 SayDraw — 对话式图片创作 Agent(Windows 桌面端 · 开源)

以工程文件夹为中心的桌面图像创作 Agent:多模态大模型理解需求与图像,多轮沟通收集需求、确认后调用生图模型创作;支持连续修图、蒙版局部重绘、多参考图融合与本地图片处理。任何 OpenAI / Anthropic 兼容模型服务均可接入。

![License](https://img.shields.io/badge/license-MIT-green) ![Platform](https://img.shields.io/badge/platform-Windows-blue) ![Version](https://img.shields.io/badge/version-0.5.1-violet)

## 功能

**Agent 能力**
- **需求收集与硬确认门**:对话补齐需求槽位(主体/风格/构图/色调/比例/用途),右侧面板实时展示;需求未经确认,编排层直接拦截生成请求——不依赖模型自觉
- **ask_user 问答面板**:决策类提问以选择题呈现(UI 面板作答,必带 ⭐ 推荐答案),自由输入兜底
- **迭代确认**:Agent 自判微调也必须先经用户确认才允许再次生成(编排层强制);用户指令的直接执行不重复确认
- **无限迭代**:工具调用次数不设上限,模型自判进度;每次生成/编辑的图片自动回传给模型自评
- **文件系统工具**:浏览目录 / 读写编辑文件 / 移动复制 / 导入本机图片;write_file、edit_file、process_image(本地格式转换/压缩/缩放,零额度消耗)
- **强制工作目录**(工程文件夹):自动创建 `生成图片/`(全部产出)、`素材/`(参考资产,Agent 可浏览识别并给创作建议)、`要求.md`、`需求规格.md`(随对话自动同步)
- **生图**:文生图、图生图编辑、蒙版局部重绘、**多参考图融合**(最多 16 张、单张 25MB、提示词 32000 字符,可在设置调整)
- **版本链**:每张编辑图记录来源,可回溯任意版本继续修改;双击图片打开可缩放查看器;右键复制/另存为
- **多会话并发**:会话间推理互不干扰,切走不中断,侧栏转圈标识运行中会话
- **块式对话 UI**:思考过程(生成中展开/结束自动折叠)、工具调用卡片(默认折叠,展开看参数与结果)、轮次计时与结束摘要

**模型接入(通用)**
- **连接分组 + 模型列表**的设置模型:一个分组 = 一个服务连接(地址 + Key 共享),下挂多个模型;左右布局管理,支持从 `/models` 拉取列表一键添加(自动带出上下文/输出/模态/推理档位参数)
- 语言模型:OpenAI 兼容 / Anthropic 双规范、上下文窗口(自动裁剪历史)、最大输出、多模态开关、思考模式与**推理强度档位(可增删的自定义列表)**
- 生图模型:端点路径、张数/参考图/单图/提示词上限、quality、输出格式、input_fidelity;可选参数被端点拒绝时自动降级重试
- **默认预置 DeepSeek 官方(deepseek-flash,只填 Key)+ GPT-Image-2(cf.api.fan)+ 智谱 CogView-4**
- API Key 系统安全存储加密,保存在本机;流式输出(SSE)、思考流(reasoning_content / thinking_delta)解析

## 安装

| 方式 | 说明 |
|---|---|
| **直接双击** | [Releases](../../releases) 下载 `AIImage-x.x.x-portable.exe` 单文件绿色版 |
| 安装版 | `AIImage-x.x.x-setup.exe` NSIS 安装包 |
| 源码运行 | `npm install && npm run dev` |

> 首次使用:创建会话 → 选择工作目录(强制)→ 设置中填入 API Key(语言模型 DeepSeek 预置只需一个 Key)→ 对话描述需求 → 确认生成 → 继续对话修图 / 涂抹蒙版局部重绘。

## 技术栈

Electron 44(主进程 = Agent 编排)· React 19 + TypeScript + Zustand + Tailwind CSS 4 · Konva(蒙版笔刷)· electron-vite + Vite 7 · 零原生依赖(JSON 持久化)

## 架构

```
渲染进程(React)                        主进程(Agent 编排)
┌──────────────────────┐    IPC     ┌───────────────────────────────────┐
│ ChatPanel 块式对话     │ ◄────────► │ AgentLoop(无限迭代·模型自判)        │
│ QuestionPanel 问答面板 │  事件推送   │  ├ 硬确认门(需求未确认拦截)          │
│ Composer 简约输入栏    │            │  ├ 迭代确认门(微调需 ask_user 同意)  │
│ BriefPanel 需求槽位    │            │  └ ask_user 挂起问答               │
│ ImageCanvas 蒙版笔刷   │            ├ 工具×12:generate/edit_image        │
│ ImageViewer 缩放查看器 │            │  │  process_image·move/copy_file   │
│ VersionStrip 版本链    │            │  │  read/write/edit_file·ask_user… │
│ Settings 分组式模型管理 │            ├ Providers(OpenAI/Anthropic 双规范) │
└──────────────────────┘            │  ├ /models 元数据拉取·自动填参        │
                                    │  └ 可选参数被拒自动降级               │
                                    ├ 工作目录(生成图片/素材/要求/需求规格)  │
                                    └ Store(JSON+safeStorage+版本链)      │
```

## 开发

```bash
npm install        # Electron 二进制走 .npmrc 中的 npmmirror 镜像
npm run dev        # 开发模式(热更新;主进程改动需手动重启)
npm run typecheck  # 类型检查
npm run dist       # 打包 portable + NSIS 安装包(dist-release/)
```

测试:`scripts/mock-server.mjs` 提供本地 mock 模型服务(OpenAI/Anthropic 双规范),`scripts/e2e-driver.mjs` 通过 CDP 驱动端到端验证(注意:不要在正在使用的实例上运行)。

## 目录结构

```
src/
├── shared/          # 跨层类型契约(连接分组/模型/会话/消息/资产/Brief/事件)
├── main/            # 主进程:agent(循环/提示词/工具/确认门/ask_user)、providers、store、ipc
├── preload/         # contextBridge 类型化 API
└── renderer/src/    # React:components、stores(zustand)、lib
```

## License

[MIT](./LICENSE)
