# SilverGuide 银龄引路人 — M3 发布候选版

> 对应《SilverGuide 技术需求规格说明书 V1.0》第 12 章 M1–M3。版本 `0.4.0-m3-rc.4`：强化敏感业务保护、跨标签页档案清除、PWA 更新、历史记录兼容、图片最小化与语音/路由异常处理。真实 Cloud Agents 和 Qoder Sites 公开部署仍待环境验收。

## 1. 本阶段功能

- 首页、训练中心、训练页、学习档案、设置页及基础导航。
- 适老化按钮、字体缩放、高对比度、简短首次使用说明、文字标签与键盘可操作控件。
- 医院预约挂号、手机打车两套各 6 步的虚构模拟训练。
- 确定性任务状态机：正确前进、错误不跳步、连续两次错误恢复详细提示、求助、返回、重新开始、退出、恢复。
- L1 / L2 / L3 三级基础提示；首次任务默认 L1，再次练习逐步减少提示，训练中可手动切换。
- IndexedDB + Dexie 本地学习档案：开始/完成记录、最近练习时间、完成用时、错误次数、求助次数、最终提示等级，以及二次确认清除。数据库 v2 使用事务代次防止旧标签页重新写入已清除记录；不兼容档案仍可安全显示并清除。
- 存储不可用时训练继续运行，并明确提示记录无法持久化；AI 服务不可用时 AI 页面明确降级，模拟训练不受影响。
- AI 看图指导：截图检查、像素重新编码及必要缩放、预览、隐私确认、问题及目标输入、受保护同源接口、取消等待、可重试错误提示、可靠区域 SVG 标注；明确的敏感业务仅展示系统安全提醒。
- 中文语音：训练提示及 AI 结果可以朗读、停止、调整语速；异步加载中文语音后自动刷新入口。无中文音色时明确提供文字降级，不使用非中文默认音色。
- PWA：支持浏览器安装时提供安装入口；首次联网完成静态缓存后支持离线训练，AI 始终需要联网。截图和 API 响应绝不进入 PWA 缓存。
- 清除学习记录前二次确认；支持取消并保留记录，避免误触。
- 独立 Node 同源运行载体、每进程每日 AI 次数限制、上游取消尝试。

所有医院、科室、时间、路线、车型和费用均为演示数据；训练页显著显示「模拟练习，不产生真实订单」，不生成真实医疗预约、出行订单或支付行为。

## 2. 技术栈

| 层级 | 采用 |
|---|---|
| 前端 | Vue 3 + TypeScript（严格模式） |
| 构建 | Vite 6 |
| 样式 | Tailwind CSS 3 |
| 路由 / 状态 | Vue Router 4 / Pinia 2 |
| 本地进度 | IndexedDB + Dexie 4 |
| 单元测试 / 组件测试 | Vitest 3 + @vue/test-utils + jsdom + fake-indexeddb |
| AI 服务端 | Node.js 独立服务 / 本地 Vite 中间件；可替换 AiVisionProvider |
| PWA | Web App Manifest + 构建产物白名单 Service Worker |

显示与声音偏好使用轻量 `localStorage`，学习进度和历史记录使用 Dexie。PWA 逻辑和构建产物已自动核验，实际设备安装仍待实测。Playwright 已作为开发依赖锁定在 `package.json`，8 个端到端用例 × 2 视口在脚本中可用（详见 §浏览器端到端测试）。

## 3. 快速开始

需要 Node.js ≥ 20.19（M1 在 Node 22.22.2 上验证）。

```bash
npm install        # 安装依赖
npm run dev        # 本地开发：http://127.0.0.1:5173
npm run typecheck  # TypeScript 严格模式检查
npm run test       # 单元测试与组件集成测试
npm run build      # 前端 dist/ + Node dist-server/
npm start          # 独立同源 Node 服务：http://127.0.0.1:8080
npm run preview    # Vite 构建预览：http://127.0.0.1:4173
npm run verify     # 类型、测试、双构建、凭证、PWA、评测样本核验
```

模拟训练无需 `.env` 文件即可安装、启动、测试与构建。AI 接口由 Node **服务端进程环境**读取凭证；未配置时返回明确的 `NOT_CONFIGURED`，不会生成伪造结果。

### 启用真实看图服务（需 Qoder 账号）

启动 `npm run dev`、`npm start` 或 `npm run preview` 前，在服务端进程环境配置 `QODER_ACCESS_TOKEN`、`QODER_VISION_AGENT_ID`、`QODER_VISION_ENVIRONMENT_ID`，可选 `QODER_API_BASE_URL`（HTTPS）。请使用专供截图理解的 Agent，并关闭与截图解释无关的工具和权限；不要使用 `VITE_` 前缀或提交真实凭证。

首次调用前通过 `npm run verify:ai` 验证账号和模型（会消耗 Credits）。浏览器只请求 `/api/vision/analyze`。默认客户端等待 90 秒，服务端主请求截止时间为 85 秒，上传阶段独立限制为 15 秒；实际读取字节数超过上限时暂停接收、尝试返回 413 并关闭连接。每次 Session 预算上限 5 Credits。未完成的上游执行失败或中断时额外做一次最多 3 秒的取消尝试；成功后的 idle Session 不重复取消，取消不代表删除会话或截图。

### 限流与反向代理配置

`SILVERGUIDE_PUBLIC_ORIGIN` 仅用于 Origin 校验，不代表信任代理。`SILVERGUIDE_TRUSTED_PROXY_CIDRS` 默认留空，按 socket 直连地址限流。仅填部署者控制的确切代理 IP/CIDR（逗号分隔）；接入层必须正确管理转发头。匹配直连可信代理时才解析 `X-Forwarded-For`，从右向左跳过连续可信代理，遇到第一个非代理地址停止；无效配置或头部会保守回退，禁止将所有地址设为可信代理。不要假定未知云平台的代理网段。

| 服务端环境变量 | 默认值 | 用途 |
|---|---:|---|
| `SILVERGUIDE_TRUSTED_PROXY_CIDRS` | 空 | 明确可信的代理地址或网段 |
| `SILVERGUIDE_VISION_PER_IP_PER_MINUTE` | 4 | 单 IP 每分钟接入次数 |
| `SILVERGUIDE_VISION_GLOBAL_PER_MINUTE` | 60 | 单进程全局每分钟接入上限 |
| `SILVERGUIDE_VISION_MAX_CONCURRENT_PER_IP` | 1 | 单 IP 正在处理的请求数 |
| `SILVERGUIDE_VISION_MAX_CONCURRENT` | 4 | 单进程总并发数 |
| `SILVERGUIDE_DAILY_AI_PER_IP_LIMIT` | 20 | 单 IP 每 24 小时上游调用次数 |
| `SILVERGUIDE_DAILY_AI_LIMIT` | 50 | 单进程每 24 小时上游调用总数 |
| `SILVERGUIDE_VISION_BODY_TIMEOUT_MS` | 15000 | 请求体读取期限（1000–30000 ms） |

每日上限只计入有效、准备调用上游的请求。各限制及地址键均为进程内临时计数，不跨重启或多实例共享；公网部署仍应配合平台级持久化配额、安全网关及资源限制。限额应结合账号预算设置，不应无限开放。

Vite preview 仅为本地预览。`npm start` 运行独立 Node 载体，无需 Vite。兼容 Node 的正式环境可用 `dist/` + `dist-server/`，通过 HTTPS 反向代理保留 Host 或配置 `SILVERGUIDE_PUBLIC_ORIGIN`。Qoder Sites 的实际 Server Functions 契约及账号能力仍须在 Qoder 中确认；**只发布静态 `dist` 不会提供 AI 接口**。不可将 `dist-server` 作为公开静态目录发布。

### PWA 与离线

在 `npm start` 的 localhost 或部署后的 HTTPS 地址首先联网打开首页，等待“离线练习页面已准备好”。浏览器支持时可安装到设备；断网后可继续已缓存的两套模拟训练与本机档案，AI 看图不会缓存或绕过网络。普通开发模式不注册 Service Worker。

### AI 评测样本

`tests/vision/fixtures/` 包含 20 张虚构界面 PNG 和标签/位置真值。默认只进行本地核验，不消耗 Credits：

```bash
npm run verify:vision-fixtures
# 真实联调后，显式开启小范围评测（默认请求本地开发服务）
npm run evaluate:vision -- --live --limit=3
```

完整 20 张评测的上游预算上限为 100 Credits。请先确认账号及本机每 IP/全局每日调用额度，并将冒烟评测也纳入预算；默认单 IP 每日 20 次。`SILVERGUIDE_EVAL_URL` 可设为已授权的 HTTPS 同源接口或本机地址。评测记录本地真实输出、位置 IoU、标签准确率、提醒与不确定性；不把合成测试图或模拟上游结果当成实际模型准确率。

### 浏览器端到端测试（M3）

`@playwright/test@1.65.1` 已在 `devDependencies` 精确锁定，`npm install` 会自动安装。`npm run test:e2e` 通过 `scripts/run-e2e.mjs` 先行校验依赖与版本，缺失时给出明确安装提示而非静默失败。**首次运行前需安装浏览器二进制**（约 150 MB，需网络）：

```bash
npx playwright install chromium
npm run build          # 生成 dist/ 与 dist-server/
npm run test:e2e
```

测试覆盖移动端 360px 和桌面端的挂号、打车、AI 展示与故障、PWA 离线、大字号响应式、跨标签页档案清除、敏感结果安全降级，共 8 个场景 × 2 视口。AI 成功、故障和敏感结果使用测试拦截，不代表真实模型效果。测试通过独立 Node 载体启动生产构建（`webServer` 配置见 `playwright.config.mjs`）。若已安装 Edge 或 Chrome，可通过 `SILVERGUIDE_E2E_CHANNEL=msedge` 或 `chrome` 选择相应浏览器，例如 PowerShell 中先执行 `$env:SILVERGUIDE_E2E_CHANNEL='msedge'` 再运行测试。

**关于 verify 链**：`npm run verify` 只覆盖类型、单元/组件测试、双构建、凭证、PWA 产物与视觉语料核验；E2E 需要浏览器二进制与较长运行时间，**不纳入默认 verify**，作为发布前手工门禁单独执行。RC.4 已枚举 16 项；本版执行结果见 `docs/M3-RC4审查修复报告.md`。

## 4. 路由

| 路由 | 页面 | 功能 |
|---|---|---|
| `/` | 首页 | 产品入口、首次说明、字号与语音偏好 |
| `/practice` | 训练中心 | 两类训练及继续练习状态 |
| `/practice/hospital-registration` | 医院挂号训练 | 六步模拟与结果 |
| `/practice/taxi-ride` | 打车训练 | 六步模拟与结果 |
| `/progress` | 学习档案 | 记录、统计与清除 |
| `/settings` | 设置 | 字体、高对比度、提示等级、语音、数据清除 |
| `/ai-helper` | AI 看图指导 | 上传截图、分析、标注、朗读 |
| `/about` | 关于 | 产品与隐私安全说明 |

未知路径回退首页。

## 5. 目录结构

```
src/
├── components/   适老化按钮、字号/提示控制、仿真按钮、全局导航、两套仿真界面
├── views/        首页、训练、档案、设置、AI 看图及关于页
├── router/       应用路由
├── stores/       用户设置与练习状态（Pinia）
├── tasks/        两套演示任务配置
├── engine/       确定性任务状态机（纯函数）
├── services/     AI 契约、校验器、图片、语音与客户端
├── repositories/ IndexedDB + Dexie 学习进度仓储
├── types/        §6 数据模型 + §7.2 AI 接口契约
└── utils/        ID、坐标与格式化工具
server/           Node AI 服务端接口与 Qoder Provider（不进入 dist）
build/            PWA 构建插件与静态资源白名单
tests/unit/       M0–M3 单元测试、组件及接口集成测试
tests/e2e/        M3 Playwright（8 场景 × 2 视口，依赖已锁定）
tests/vision/     20 张合成截图、真值及评分器测试
scripts/          验证、图标/截图生成与 AI 评测脚本
docs/             部署说明、AI 契约、阶段验收及参赛材料
```

页面不包含任务判定逻辑；仿真页面的目标按钮使用真实 DOM `id`，目标由任务配置与状态机共同决定，不由模型生成坐标。

## 6. 安全边界

- 浏览器不持有、不读取、不发送任何 Qoder PAT / SAT 或模型 API 私钥；`npm run verify:secrets` 检查前端源码/公开产物、服务端源码/产物、构建配置与脚本。前端禁止认证头及服务端凭证名，后端允许动态认证但拒绝常见秘密特征、硬编码凭证属性及非空静态回退值。静态检查不代替运行时凭证来源和权限审核，扫描输出不包含原始凭证。
- 训练流程不调用网络或 AI 服务；服务不可用时不会用固定答案冒充 AI 分析。
- 学习档案只存在本地 IndexedDB，不包含姓名、手机号、身份证号等个人身份信息。
- AI 响应经服务端和客户端分别校验；低置信、越界不绘制位置框，明确的敏感请求或回复改为固定系统安全提醒，不保留模型操作指导。规则只能作为保守保护，不能保证识别所有风险；仍需真实模型和人工复核。
- 浏览器上传前统一从图片像素重新编码，使用标准文件名。用户仍须主动遮挡可见敏感信息；截图不写入学习档案，远端数据保留策略需上线前确认。

## 7. 阶段成果与限制

当前 M3 验收见 `docs/M3-验收报告.md`，发布与比赛交付材料见 `docs/M4-发布与参赛材料.md`，M0–M2 历史报告保留在 `docs/`。真实模型调用、公网发布及 Playwright 多端实测尚未完成，不将合成测试或模拟上游描述为真实 AI 效果。

RC.2 的审查修复和回归结果见 `docs/M3-代码审查修复报告.md`。快照无版本字段时按 v0 迁移至 schema v1；已知版本允许额外字段，未知破坏性版本保留原记录并明确提示。学习档案的提示等级统计按任务版本隔离。写入、档案读取及清除在每个 store 实例内顺序执行。

RC.3 的七项审查修复见 `docs/M3-RC3审查修复报告.md`；RC.4 的十项修复及验证边界见 `docs/M3-RC4审查修复报告.md`。
