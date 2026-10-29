/**
 * 生成 tauri updater 所需的 latest.json 清单。
 *
 * 清单格式（对齐 tauri-plugin-updater 的 RemoteRelease 反序列化）：
 *   {
 *     "version": "1.1.0",
 *     "notes": "更新说明",
 *     "pub_date": "2026-10-27T10:00:00Z",
 *     "platforms": {
 *       "windows-x86_64-nsis": { "url": "https://...", "signature": "..." },
 *       "windows-x86_64-msi":  { "url": "https://...", "signature": "..." }
 *     }
 *   }
 *
 * 也支持「动态（Server）格式」：直接给 url + signature，不列 platforms。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

/** tauri 的 target 标识：{os}-{arch}-{installer} */
export const TARGETS = {
  nsis: 'windows-x86_64-nsis',
  msi: 'windows-x86_64-msi',
};

/** release/ 目录里需要被识别的产物文件名后缀 */
const ARTIFACT_PATTERNS = [
  { target: TARGETS.nsis, re: /\.exe$/i, prefer: /setup/i },
  { target: TARGETS.msi, re: /\.msi$/i, prefer: null },
];

/**
 * 从文件名解析版本号，如 "Markdown Studio_1.1.0_x64-setup.exe" → "1.1.0"
 */
export function parseVersionFromName(name) {
  const m = basename(name).match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

/**
 * 扫描目录，挑选每个 target 对应的最佳产物。
 * @returns {Map<string, {file: string, version: string}>}
 */
export function scanArtifacts(dir) {
  const found = new Map();
  if (!existsSync(dir)) return found;

  const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());

  for (const { target, re, prefer } of ARTIFACT_PATTERNS) {
    const candidates = files.filter((f) => re.test(f));
    if (candidates.length === 0) continue;
    /**
     * `release/` 是累积目录，多版本安装包会同时存在（1.0.0 + 1.0.1）。
     * 这里必须按版本号从高到低挑：早期实现用 `find` 取第一个候选，
     * readdir 顺序恰好让旧版排前面，导致最新版发布后清单仍指向旧包
     * （用户点「检查更新」看不到新版本，且下载到的是旧安装包）。
     */
    const ranked = [...candidates].sort((a, b) => {
      const va = parseVersionFromName(a);
      const vb = parseVersionFromName(b);
      if (va && vb) {
        const d = compareVersions(vb, va);
        if (d !== 0) return d;
      } else if (va !== vb) {
        return va ? -1 : 1; // 能解析出版本的优先
      }
      // 版本相同（或都解析不出）时，含 setup 的安装器优先
      const pa = prefer?.test(a) ? 1 : 0;
      const pb = prefer?.test(b) ? 1 : 0;
      return pb - pa;
    });
    const chosen = ranked[0];
    const version = parseVersionFromName(chosen);
    if (version) found.set(target, { file: chosen, version });
  }
  return found;
}

/**
 * 读取同目录下的 .sig 文件（tauri signer sign 产物）。
 * @returns {string|null}
 */
export function readSignature(releaseDir, artifactFile) {
  const sigPath = join(releaseDir, `${artifactFile}.sig`);
  if (!existsSync(sigPath)) return null;
  return readFileSync(sigPath, 'utf8').trim();
}

/**
 * 构建 latest.json 内容。
 *
 * @param {object} opts
 * @param {string} opts.releaseDir  产物目录
 * @param {string} opts.baseUrl      对外可访问的基础 URL（用于拼下载地址）
 * @param {string} [opts.notes]     更新说明
 * @param {string} [opts.pubDate]   发布日期（ISO / RFC3339）
 * @param {string} [opts.version]   强制版本号（默认取产物文件名中的版本）
 * @returns {{version: string, manifest: object, files: object[]}}
 */
export function buildManifest({ releaseDir, baseUrl, notes, pubDate, version }) {
  const dir = resolve(releaseDir);
  const artifacts = scanArtifacts(dir);
  if (artifacts.size === 0) {
    throw new Error(`未在 ${dir} 找到可发布的更新产物（需要 .exe/.msi 且文件名含版本号）`);
  }

  const platforms = {};
  const files = [];

  for (const [target, { file, version: fileVersion }] of artifacts) {
    const signature = readSignature(dir, file);
    if (!signature) {
      // 没有签名文件则跳过该 target：tauri 校验签名，缺签名必然安装失败
      console.warn(`[update-server] 跳过 ${target}：缺少 ${file}.sig 签名文件`);
      continue;
    }
    const url = `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(file)}`;
    platforms[target] = { url, signature };
    files.push({ target, file, version: fileVersion, url, size: statSync(join(dir, file)).size });
  }

  if (Object.keys(platforms).length === 0) {
    throw new Error('所有产物都缺少 .sig 签名文件，无法生成可安装的更新清单');
  }

  // 版本号：显式指定 > 产物文件名中最高版本
  const versions = files.map((f) => f.version);
  const resolvedVersion =
    version ?? versions.sort((a, b) => compareVersions(b, a))[0];

  const manifest = {
    version: resolvedVersion,
    notes: notes ?? '',
    pub_date: pubDate ?? new Date().toISOString(),
    platforms,
  };

  return { version: resolvedVersion, manifest, files };
}

/** 语义化版本比较：a > b 返回正数 */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
