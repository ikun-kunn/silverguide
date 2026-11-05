/**
 * M0 技术验证脚本：验证「截图能否通过受保护接口交给 Cloud Agents 并取回结构化结果」。
 *
 * 仅使用 Node 内置 fetch / zlib，不引入任何后端框架，也不启动服务。
 * 凭证只从服务端进程环境变量读取，绝不写入前端、日志或报告文件。
 * 未配置凭证时输出 status=skipped 并正常退出，不阻断构建。
 *
 * 用法：npm run verify:ai
 * 可选：M0_TEST_IMAGE=<合法 PNG/JPEG 路径> 指定真实测试截图（不得含敏感信息）。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORT_PATH = join(ROOT, 'docs', 'm0-ai-verification.json');

const token = process.env.QODER_ACCESS_TOKEN?.trim() ?? '';
const agentId = process.env.QODER_VISION_AGENT_ID?.trim() ?? '';
const environmentId = process.env.QODER_VISION_ENVIRONMENT_ID?.trim() ?? '';
const baseUrl = (process.env.QODER_API_BASE_URL?.trim() ||
  'https://api.qoder.com.cn/api/v1/cloud').replace(/\/+$/, '');
const testImagePath = process.env.M0_TEST_IMAGE?.trim() ?? '';

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** 生成一张「不含任何真实界面」的合成图：用于验证模型是否正确表达不确定性 */
function makeSyntheticImage(width = 320, height = 180) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    raw[cursor++] = 0; // PNG filter: none
    for (let x = 0; x < width; x += 1) {
      const inside = x >= 40 && x < 280 && y >= 60 && y < 120;
      raw[cursor++] = inside ? 29 : 245;
      raw[cursor++] = inside ? 78 : 247;
      raw[cursor++] = inside ? 216 : 251;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PROMPT = `你是一个帮助老年人看懂手机界面的助手。请只根据截图里实际可见的内容作答。
规则：1) 不确定时明确说明不确定；2) 不得捏造截图中不存在的按钮；3) 一次只给一个主要操作；
4) 不索取密码、短信验证码或支付凭据；5) 不宣称已替用户完成任何真实操作；6) 输出简洁中文。
必须只输出一个 JSON 对象，不要 Markdown 代码块或额外文字，字段为：
{"success":boolean,"pageSummary":string,"instruction":string,"targetLabel":string|null,
"boundingBox":[x1,y1,x2,y2]|null,"confidence":number|null,"safetyWarning":string|null,"errorCode":null}
boundingBox 使用 0~1 归一化坐标；如果无法可靠定位目标，boundingBox 必须为 null，且 confidence 为 null 或较低值。`;

function saveReport(report) {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

const missing = [
  !token && 'QODER_ACCESS_TOKEN',
  !agentId && 'QODER_VISION_AGENT_ID',
  !environmentId && 'QODER_VISION_ENVIRONMENT_ID',
].filter(Boolean);

if (missing.length > 0) {
  const skipped = {
    schemaVersion: 1,
    executedAt: new Date().toISOString(),
    status: 'skipped',
    reason: `未在服务端环境中配置 ${missing.join('、')}，跳过 Cloud Agents 实调验证。`,
    verifiedFromDocumentation: {
      imageInput: 'user.message 支持 image content block（base64 / HTTPS URL / File ID）',
      imageLimits: '单图 base64 ≤10 MiB 编码文本，宽高各 ≤8000px，每条消息最多 100 个图片块',
      resultReadback: 'SSE 或 GET /sessions/{id}/events 读取 agent.message，等待 session.status_idle',
      credentialSafety: 'Bearer PAT/SAT 仅服务端持有；Sites Secrets 只写不可读回 / Vault 加密存储',
      quotaControl: 'Session budget.max_credit_cost 与 usage.total_credits 可限制并统计消耗',
    },
  };
  saveReport(skipped);
  console.log(JSON.stringify(skipped, null, 2));
  process.exit(0);
}

let image;
let mediaType = 'image/png';
let imageSource = 'synthetic';
if (testImagePath) {
  image = readFileSync(testImagePath);
  imageSource = 'file';
  const lower = testImagePath.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mediaType = 'image/jpeg';
  else if (lower.endsWith('.webp')) mediaType = 'image/webp';
  else if (lower.endsWith('.gif')) mediaType = 'image/gif';
} else {
  image = makeSyntheticImage();
}

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};
const startedAt = Date.now();
const report = {
  schemaVersion: 1,
  executedAt: new Date().toISOString(),
  status: 'failed',
  image: { source: imageSource, bytes: image.length, mediaType },
  budget: { type: 'limit', max_credit_cost: '5.00' },
  steps: [],
};

try {
  const createResponse = await fetch(`${baseUrl}/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      agent: { id: agentId, type: 'agent' },
      environment_id: environmentId,
      title: 'SilverGuide M0 vision verification',
      metadata: { purpose: 'm0-vision-verification' },
      budget: { type: 'limit', max_credit_cost: '5.00' },
    }),
  });
  report.steps.push({ step: 'create_session', httpStatus: createResponse.status });
  if (!createResponse.ok) {
    report.reason = '创建 Session 失败，请检查凭证、Agent ID、Environment ID 与账号额度';
    saveReport(report);
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  const session = await createResponse.json();
  report.sessionId = session.id;

  const sendResponse = await fetch(`${baseUrl}/sessions/${session.id}/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      events: [
        {
          type: 'user.message',
          content: [
            { type: 'text', text: PROMPT },
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: image.toString('base64') },
            },
          ],
        },
      ],
    }),
  });
  report.steps.push({ step: 'send_image_message', httpStatus: sendResponse.status });
  if (!sendResponse.ok) {
    report.reason = '发送图片消息失败（409 表示 Session 仍在处理上一轮）';
    saveReport(report);
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  let sawRunning = false;
  let idleReached = false;
  let usage = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const statusResponse = await fetch(`${baseUrl}/sessions/${session.id}`, { headers });
    if (statusResponse.ok) {
      const snapshot = await statusResponse.json();
      if (snapshot.status === 'running' || snapshot.status === 'rescheduling') sawRunning = true;
      usage = snapshot.usage ?? usage;
      if (snapshot.status === 'idle' && (sawRunning || Date.now() - startedAt > 10_000)) {
        idleReached = true;
        break;
      }
      if (snapshot.status === 'terminated') break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  report.sawRunning = sawRunning;
  report.idleReached = idleReached;
  report.credits = usage ?? null;

  const eventsResponse = await fetch(
    `${baseUrl}/sessions/${session.id}/events?limit=100&order=desc`,
    { headers },
  );
  let modelText = '';
  if (eventsResponse.ok) {
    const eventsPayload = await eventsResponse.json();
    const events = Array.isArray(eventsPayload.data) ? eventsPayload.data : [];
    const messages = events
      .filter((event) => event.type === 'agent.message' && Array.isArray(event.content))
      .flatMap((event) => event.content)
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text);
    modelText = messages.join('\n');
  }
  report.modelTextLength = modelText.length;

  const cleaned = modelText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    report.modelOutputParsed = true;
    report.modelContract = {
      success: parsed.success === true,
      hasPageSummary: typeof parsed.pageSummary === 'string',
      hasInstruction: typeof parsed.instruction === 'string',
      boundingBox: parsed.boundingBox ?? null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    };
    const box = parsed.boundingBox;
    report.boundingBoxValid =
      box === null ||
      (Array.isArray(box) &&
        box.length === 4 &&
        box.every((value) => typeof value === 'number' && value >= 0 && value <= 1) &&
        box[0] < box[2] &&
        box[1] < box[3]);
    report.status = idleReached && report.boundingBoxValid ? 'success' : 'failed';
    report.reason = idleReached
      ? '图片消息已送达，模型输出已按 §7.2 JSON Schema 解析并完成坐标校验'
      : '未在 120 秒内等到 session.status_idle，请检查模型服务与额度';
  } catch {
    report.modelOutputParsed = false;
    report.boundingBoxValid = false;
    report.reason = '模型输出不是合法 JSON，需由 aiResponseValidator 判定为不可用';
  }
} catch (error) {
  report.reason = `请求异常：${error instanceof Error ? error.message : String(error)}`;
} finally {
  report.elapsedMs = Date.now() - startedAt;
  saveReport(report);
  console.log(JSON.stringify(report, null, 2));
}
