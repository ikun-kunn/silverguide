import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createAppRuntime } from './appRuntime';
import { readVisionConfig } from './config';

const config = readVisionConfig();
const port = Number(process.env.PORT ?? '8080');
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('无效的 PORT');
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const runtime = createAppRuntime(root, config);
const server = createServer((req, res) => { void runtime(req, res); });
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.listen(port, host, () => console.log(`SilverGuide Node runtime: http://${host}:${port} · AI ${config.provider ? 'configured' : 'not configured'}`));
