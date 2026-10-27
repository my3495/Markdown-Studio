/**
 * Markdown Studio 更新服务。
 *
 * 提供 tauri updater 所需的端点：
 *   GET /latest.json            更新清单（含各 target 的下载地址与签名）
 *   GET /downloads/<file>       产物下载
 *   GET /health                 健康检查
 *
 * 用法：
 *   node src/server.mjs [--port 8788] [--host 127.0.0.1] [--release-dir ../release]
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from './manifest.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// __dirname = <repo>/apps/update-server/src → 上三级才是仓库根
const REPO_ROOT = resolve(__dirname, '../../..');

/** 解析命令行参数 */
function parseArgs(argv) {
  const out = {
    port: 8788,
    host: '127.0.0.1',
    releaseDir: join(REPO_ROOT, 'release'),
    baseUrl: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = parseInt(argv[++i], 10) || out.port;
    else if (a === '--host') out.host = argv[++i] ?? out.host;
    else if (a === '--release-dir') out.releaseDir = resolve(argv[++i] ?? out.releaseDir);
    else if (a === '--base-url') out.baseUrl = argv[++i] ?? '';
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

/** 根据监听地址推断对外可访问的 base URL */
function inferBaseUrl() {
  if (args.baseUrl) return args.baseUrl;
  const host = args.host === '0.0.0.0' ? '127.0.0.1' : args.host;
  return `http://${host}:${args.port}`;
}

const BASE_URL = inferBaseUrl();
const RELEASE_DIR = resolve(args.releaseDir);

/** 缓存：清单按目录 mtime 失效，避免每次请求都扫盘 */
let cache = { mtimeMs: 0, value: null };

function getManifest() {
  const dirStat = statSync(RELEASE_DIR, { throwIfNoEntry: false });
  if (!dirStat) throw new Error(`发布目录不存在：${RELEASE_DIR}`);
  const mtimeMs = dirStat.mtimeMs;
  if (cache.value && cache.mtimeMs === mtimeMs) return cache.value;

  const { version, manifest, files } = buildManifest({
    releaseDir: RELEASE_DIR,
    baseUrl: `${BASE_URL}/downloads`,
  });
  cache = { mtimeMs, value: { version, manifest, files } };
  console.log(
    `[update-server] 清单已生成 v${version}：` +
      files.map((f) => `${f.target}(${f.file})`).join(', ')
  );
  return cache.value;
}

const MIME = {
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.msi': 'application/x-msi',
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  // CORS 预检（便于浏览器端调试）
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': '*',
    });
    res.end();
    return;
  }

  try {
    if (path === '/latest.json' || path === '/') {
      const { manifest } = getManifest();
      sendJson(res, 200, manifest);
      return;
    }

    if (path === '/health') {
      sendJson(res, 200, { ok: true, releaseDir: RELEASE_DIR, baseUrl: BASE_URL });
      return;
    }

    if (path.startsWith('/downloads/')) {
      const name = basename(decodeURIComponent(path.slice('/downloads/'.length)));
      const file = join(RELEASE_DIR, name);
      // 防止路径穿越：只允许 releaseDir 下的文件
      if (!file.startsWith(RELEASE_DIR) || !existsSync(file)) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      const stat = statSync(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': stat.size,
        'access-control-allow-origin': '*',
      });
      createReadStream(file).pipe(res);
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[update-server] ${path} 处理失败：${msg}`);
    sendJson(res, 500, { error: msg });
  }
});

server.listen(args.port, args.host, () => {
  console.log(`[update-server] 监听 http://${args.host}:${args.port}`);
  console.log(`[update-server] 发布目录 ${RELEASE_DIR}`);
  console.log(`[update-server] 清单地址 ${BASE_URL}/latest.json`);
});
