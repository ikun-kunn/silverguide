# AI 截图理解：接口契约与 Cloud Agents 集成方案（M0 验证）

> 本文对应 TRD §5.3、§7.2–7.4、§8.2 与 §16 第 5–8 条要求。
> 结论：**AI 集成路线在官方文档层面已经验证可行，且存在明确的服务端凭证方案；真实调用与额度确认仍待 Qoder 账号与凭证，本环境无法完成实调。**
> 依据：[Sessions](https://docs.qoder.cn/cloud-agents/sessions)、[Session 数据结构](https://docs.qoder.cn/cloud-agents/session-schemas)、[发送事件](https://docs.qoder.cn/cloud-agents/api/sessions/events/send)、[站点](https://docs.qoder.cn/qoder/sites)、[CLI Sites](https://docs.qoder.cn/cli/sites)。

## 1. 业务接口契约（TRD §7.2，已在代码中以类型固定）

`POST /api/vision/analyze` — 应用内部拟定的同源路径，**不是** Qoder 现成 API。

### 请求 `multipart/form-data`

| 字段 | 类型 | 说明 |
|---|---|---|
| `image` | File | PNG / JPEG / WebP / GIF；客户端先做格式与 5MB 大小检查 |
| `question` | string | 用户问题；为空时替换为「先解释页面主要功能」 |
| `taskContext` | string? | 可选任务上下文 |

### 响应 JSON

| 字段 | 类型 | 说明 |
|---|---|---|
| `success` | boolean | 是否成功 |
| `pageSummary` | string | 页面简短解释 |
| `instruction` | string | 下一步建议操作 |
| `targetLabel` | string \| null | 目标按钮名称 |
| `boundingBox` | number[] \| null | `[x1,y1,x2,y2]`，0~1 归一化 |
| `confidence` | number \| null | 0~1 置信度 |
| `safetyWarning` | string \| null | 安全提醒 |
| `errorCode` | VisionErrorCode \| null | 见 `src/types/vision.ts` |

领域模型 `ScreenshotAnalysis`（§6.5）严格保持文档字段不变；诊断用的 `errorCode` 与 `degraded` 放在外层 `VisionAnalysisOutcome`，不污染数据模型。

## 2. 官方能力核验结果（文档层，2026-11-05）

| 待验证项 | 核验结论 | 依据 |
|---|---|---|
| Cloud Agents 能否接收图片 | **可以**。`user.message` 的 `content[]` 支持 `text` 与 `image` 混合，也可只发图片 | Sessions / session-schemas |
| 图片传入方式 | `source.type` = `base64` / `url`（外部 HTTPS）/ `file`（File ID） | session-schemas「消息内容块」 |
| 支持格式与限制 | `image/png`、`image/jpeg`、`image/webp`、`image/gif`；单图 base64 编码文本 ≤ 10 MiB，宽高各 ≤ 8000px；每条消息最多 100 个图片块；需使用支持图片输入的模型 | session-schemas |
| 结果如何取回 | 发送事件后监听 SSE `/events/stream` 或轮询 `GET /sessions/{id}/events`，读取 `agent.message` 文本块；必须等 `session.status_idle` 才能发下一条（否则 409） | Sessions / send-events |
| 认证方式 | `Authorization: Bearer $QODER_ACCESS_TOKEN`（PAT 或 SAT），`https://api.qoder.com.cn/api/v1/cloud` | Sessions / API Authentication |
| 额度与统计 | Session `usage.model_credits` / `sandbox_runtime_credits` / `total_credits`；`budget.max_credit_cost` 可设单次上限 | session-schemas |
| 凭证能否安全留在服务端 | **可以**。CLI `/sites` 面板的环境变量 Secrets「只写不可读回」；Cloud Agents Vault 静态加密存储、响应不返回密钥 | CLI Sites / Vaults |
| 站点能否匿名访问 | 个人版可选「任何人都可访问」+「允许公开访问」；企业版不支持对外公开 | 站点文档 |

## 3. 调用链设计（M2 实现，M0 只验证路线）

```
浏览器  ── multipart/form-data ──▶  POST /api/vision/analyze（同源服务端适配层）
                                        │  1. 文件类型/大小检查
                                        │  2. 参数校验、频率限制、超时控制
                                        │  3. 读取服务端 Secrets（PAT/SAT）
                                        ▼
                              Qoder Cloud Agents Session
                                        │  create session（budget 上限）
                                        │  user.message: text + image(base64)
                                        │  等待 session.status_idle
                                        ▼
                              取回 agent.message 文本
                                        │  4. JSON Schema 校验
                                        │  5. 坐标合法性 / 置信度检查
                                        ▼
                              VisionAnalyzeResponse → 浏览器
                                        │  aiResponseValidator 二次校验
                                        ▼
                              ScreenshotAnalysis + SVG Overlay
```

`AiVisionProvider`（`src/services/ai/contract.ts`）是这一层的可替换接口，只允许由服务端运行时实现。浏览器侧 `visionClient.ts` 不含任何认证逻辑。

## 4. 服务端凭证约定

| 变量名 | 用途 | 存放位置 |
|---|---|---|
| `QODER_ACCESS_TOKEN` | PAT / SAT，Bearer 令牌 | Qoder Sites Secrets / Vault，**只写不可读回** |
| `QODER_API_BASE_URL` | 默认 `https://api.qoder.com.cn/api/v1/cloud` | 服务端环境变量 |
| `QODER_VISION_AGENT_ID` | 支持图片输入的 Agent ID | 服务端环境变量 |
| `QODER_VISION_ENVIRONMENT_ID` | Environment ID | 服务端环境变量 |

约束：不使用 `VITE_` 前缀；不写入 `index.html`、`src/`、`dist/`；不打印到日志或验证报告；不把用户截图或输入拼接进脚本执行上下文。

## 5. 已实现的输出校验规则（`src/services/aiResponseValidator.ts`）

1. 响应必须是 JSON 对象；`success` 必须为布尔值。
2. `success=false` → `status: failed`，沿用服务端 `errorCode`，不展示任何模型描述。
3. `pageSummary`、`instruction` 必须是非空字符串（≤1000 字）；`targetLabel`、`safetyWarning` 为字符串或 null；`confidence` 为 0~1 数字或 null。
4. `boundingBox` 必须为长度 4 的数字数组，全部落在 `[0,1]`，且 `x1<x2`、`y1<y2`。
5. 结构性错误 → `failed`（`INVALID_MODEL_OUTPUT`）；坐标非法 → `uncertain` + 记录 warning + 隐藏标注。
6. `confidence === null` 或 `< 0.6` → `uncertain` 且 `boundingBox = null`，只保留文字指导。
7. 任何路径都不会输出越界坐标；SVG Overlay 使用 `viewBox="0 0 1 1"` 实现随图缩放。

## 6. 失败降级（TRD §7.4 / FR-401）

| 触发 | errorCode | 用户可见结果 |
|---|---|---|
| 静态站点无 `/api/vision/analyze`（404） | `NOT_CONFIGURED` | 明确标记「AI 看图服务尚未接入」 |
| 超时（M2 默认客户端 90s、服务端 85s） | `AI_TIMEOUT` | 明确提示 + 可重试 |
| 429 / 402 / 5xx | `RATE_LIMITED` / `AI_QUOTA_EXCEEDED` / `AI_UNAVAILABLE` | 明确提示 + 可重试 |
| 网络断开 | `NETWORK_ERROR` | 明确提示 + 可重试 |
| 输出解析失败 | `INVALID_MODEL_OUTPUT` | 不展示任何指引 |

所有降级结果的 `degraded=true`、`pageSummary=''`、`targetLabel=null`、`confidence=null`，是**系统提示**而非模型输出，不会伪装成实时 AI 分析。模拟训练不依赖 AI，AI 故障不影响其他模块。

## 7. M0 验证脚本

```bash
# 未配置凭证：输出 status=skipped，不阻断构建
npm run verify:ai

# 在服务端环境中配置后执行真实调用（会消耗 Credits，上限 5.00）
export QODER_ACCESS_TOKEN=...
export QODER_VISION_AGENT_ID=agent_...
export QODER_VISION_ENVIRONMENT_ID=env_...
export M0_TEST_IMAGE=/path/to/no-sensitive-info.png
npm run verify:ai
```

脚本仅使用 Node 内置 `fetch`/`zlib`，不引入后端框架；默认生成一张**不含真实界面**的合成 PNG，用于验证模型是否正确表达不确定性（不捏造按钮坐标）。报告写入 `docs/m0-ai-verification.json`，不含令牌、不含图片数据。

> 注意：§10.3 要求不少于 20 张合法、无敏感信息的测试截图并统计识别正确率，属于 M3 交付，M0 未执行，不得把本文档核验结论宣传为「AI 效果已达标」。
