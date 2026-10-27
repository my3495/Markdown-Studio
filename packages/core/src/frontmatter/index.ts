/**
 * Frontmatter 解析/回写：尽量保留注释行、空行与引号风格。
 */

export interface FrontmatterField {
  key: string;
  /** 用于 UI 编辑的去引号值 */
  value: string;
  /** 原始整行（含缩进），注释/空行 key 为空 */
  raw: string;
  kind: 'pair' | 'comment' | 'blank' | 'other';
  quote: '"' | "'" | null;
}

export interface FrontmatterDoc {
  /** 是否存在 --- 围栏 */
  present: boolean;
  fields: FrontmatterField[];
  /** 围栏后正文（不含前导换行被吞掉的情况已规范化） */
  body: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function stripQuotes(v: string): { value: string; quote: '"' | "'" | null } {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return { value: t.slice(1, -1), quote: t[0] as '"' | "'" };
  }
  return { value: t, quote: null };
}

function formatValue(value: string, quote: '"' | "'" | null): string {
  if (quote === '"') return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (quote === "'") return `'${value.replace(/'/g, "''")}'`;
  // 含冒号/井号等时自动加双引号
  if (/[:#\n]|^\s|\s$/.test(value) || value === '') return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return value;
}

/** 解析文档头部 YAML frontmatter，保留非 pair 行 */
export function parseFrontmatter(content: string): FrontmatterDoc {
  const m = FENCE.exec(content);
  if (!m) return { present: false, fields: [], body: content };
  const rawBlock = m[1] ?? '';
  const body = content.slice(m[0].length);
  const fields: FrontmatterField[] = [];
  for (const line of rawBlock.split(/\r?\n/)) {
    if (!line.trim()) {
      fields.push({ key: '', value: '', raw: line, kind: 'blank', quote: null });
      continue;
    }
    if (/^\s*#/.test(line)) {
      fields.push({ key: '', value: '', raw: line, kind: 'comment', quote: null });
      continue;
    }
    const kv = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      const { value, quote } = stripQuotes(kv[3] ?? '');
      fields.push({ key: kv[2]!, value, raw: line, kind: 'pair', quote });
      continue;
    }
    fields.push({ key: '', value: '', raw: line, kind: 'other', quote: null });
  }
  return { present: true, fields, body };
}

/** 按字段列表回写；pair 用当前 value/quote，其余保留 raw */
export function serializeFrontmatter(doc: FrontmatterDoc): string {
  if (!doc.present && doc.fields.length === 0) return doc.body;
  const lines = doc.fields.map((f) => {
    if (f.kind !== 'pair') return f.raw;
    return `${f.key}: ${formatValue(f.value, f.quote)}`;
  });
  return `---\n${lines.join('\n')}\n---\n${doc.body.replace(/^\r?\n/, '')}`;
}

/** 更新某个 key 的值（不存在则追加）；保留原引号风格 */
export function setFrontmatterField(doc: FrontmatterDoc, key: string, value: string): FrontmatterDoc {
  const fields = doc.fields.map((f) =>
    f.kind === 'pair' && f.key === key ? { ...f, value } : f
  );
  const exists = fields.some((f) => f.kind === 'pair' && f.key === key);
  if (!exists) {
    fields.push({ key, value, raw: `${key}: ${value}`, kind: 'pair', quote: null });
  }
  return { ...doc, present: true, fields };
}

/** 删除某个 key */
export function removeFrontmatterField(doc: FrontmatterDoc, key: string): FrontmatterDoc {
  return {
    ...doc,
    present: true,
    fields: doc.fields.filter((f) => !(f.kind === 'pair' && f.key === key)),
  };
}

/** 便于 UI：仅 pair 字段 */
export function listPairs(doc: FrontmatterDoc): FrontmatterField[] {
  return doc.fields.filter((f) => f.kind === 'pair');
}
