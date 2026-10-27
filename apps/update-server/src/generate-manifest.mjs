/**
 * 更新产物发布工具：签名 + 生成 latest.json。
 *
 * 用法：
 *   node src/generate-manifest.mjs --release-dir ../release [--base-url http://127.0.0.1:8788/downloads]
 *
 * 依赖环境变量（tauri signer）：
 *   TAURI_SIGNING_PRIVATE_KEY      私钥内容或私钥文件路径
 *   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  私钥密码
 *
 * 若未配置签名私钥，则只扫描产物并打印将要发布的清单（不写 .sig）。
 */

import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, scanArtifacts } from './manifest.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// __dirname = <repo>/apps/update-server/src → 上三级才是仓库根
const REPO_ROOT = resolve(__dirname, '../../..');

function parseArgs(argv) {
  const out = {
    releaseDir: join(REPO_ROOT, 'release'),
    baseUrl: 'http://127.0.0.1:8788/downloads',
    version: undefined,
    notes: undefined,
    pubDate: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--release-dir') out.releaseDir = resolve(argv[++i] ?? out.releaseDir);
    else if (a === '--base-url') out.baseUrl = argv[++i] ?? '';
    else if (a === '--version') out.version = argv[++i];
    else if (a === '--notes') out.notes = argv[++i];
    else if (a === '--pub-date') out.pubDate = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const RELEASE_DIR = resolve(args.releaseDir);

console.log(`[update-server] 发布目录：${RELEASE_DIR}`);

const artifacts = scanArtifacts(RELEASE_DIR);
if (artifacts.size === 0) {
  console.error('[update-server] 未找到产物（需 .exe/.msi 且文件名含版本号），退出');
  process.exit(1);
}
for (const [target, { file, version }] of artifacts) {
  console.log(`  ${target} → ${file} (v${version})`);
}

const hasKey = !!process.env.TAURI_SIGNING_PRIVATE_KEY;

// 优先复用 tauri build 已生成的 .sig（createUpdaterArtifacts 产出）；
// 缺失时才调用 tauri signer 补签。
const missingSig = [...artifacts.values()].filter(
  ({ file }) => !existsSync(join(RELEASE_DIR, `${file}.sig`))
);

if (missingSig.length > 0 && !hasKey) {
  console.warn(
    '[update-server] 缺少 .sig 且未设置 TAURI_SIGNING_PRIVATE_KEY，无法签名；' +
      `缺失：${missingSig.map((m) => m.file).join(', ')}`
  );
  process.exit(1);
}

if (missingSig.length > 0) {
  const { execFileSync } = await import('node:child_process');
  for (const { file } of missingSig) {
    const targetPath = join(RELEASE_DIR, file);
    const sig = join(RELEASE_DIR, `${file}.sig`);
    console.log(`[update-server] 签名：${file}`);
    execFileSync(
      'npx',
      ['tauri', 'signer', 'sign', '-f', targetPath, '-o', sig],
      { stdio: 'inherit', cwd: join(REPO_ROOT, 'apps/desktop'), shell: true }
    );
  }
} else {
  console.log('[update-server] 复用已有 .sig 签名文件');
}

const { version, manifest } = buildManifest({
  releaseDir: RELEASE_DIR,
  baseUrl: args.baseUrl,
  notes: args.notes,
  pubDate: args.pubDate,
  version: args.version,
});

const outFile = join(RELEASE_DIR, 'latest.json');
writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`[update-server] 已写入 ${outFile}（v${version}）`);
