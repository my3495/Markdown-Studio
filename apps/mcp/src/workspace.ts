import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Vault } from '@md-studio/core/vault';
import { decodeBytes } from '@md-studio/core';

/** 收集全部 --workspace 值（可重复；也支持逗号分隔） */
export function collectWorkspaces(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workspace' && argv[i + 1]) {
      const raw = argv[++i]!;
      for (const part of raw.split(',')) {
        const p = part.trim();
        if (p) out.push(resolve(p));
      }
    }
  }
  return out;
}

/** 将单目录笔记载入 Vault；多库时 id 加库名前缀避免冲突 */
function loadDirIntoVault(vault: Vault, dir: string, prefix: string): number {
  let n = 0;
  const walk = (d: string, rel: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(d, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, rel ? `${rel}/${name}` : name);
      else if (/\.mdx?$/i.test(name)) {
        try {
          const buf = readFileSync(p);
          const text = decodeBytes(buf).text;
          const relPath = rel ? `${rel}/${name}` : name;
          const id = prefix ? `${prefix}/${relPath}` : relPath;
          vault.upsert({ id, name: basename(name), content: text });
          n++;
        } catch {
          /* 忽略不可读文件 */
        }
      }
    }
  };
  walk(resolve(dir), '');
  return n;
}

/** 联邦加载：单库无前缀；多库用目录 basename 作前缀 */
export function loadWorkspaces(dirs: string[]): Vault {
  const vault = new Vault();
  const unique = [...new Set(dirs.map((d) => resolve(d)))];
  const multi = unique.length > 1;
  for (const dir of unique) {
    const prefix = multi ? basename(dir) : '';
    loadDirIntoVault(vault, dir, prefix);
  }
  return vault;
}
