/**
 * 类型驱动笔记：按 frontmatter `type` 提供字段建议与关系键。
 */

import { parseFrontmatter } from '../frontmatter';
import type { VaultNote } from './vault';

export type TypeFieldKind = 'text' | 'list' | 'relation';

export interface TypeFieldDef {
  key: string;
  /** i18n key；界面优先本地化，缺失时回退 label */
  labelKey?: string;
  label: string;
  kind: TypeFieldKind;
}

export interface NoteTypeSchema {
  id: string;
  /** i18n key；界面优先本地化，缺失时回退 label */
  labelKey?: string;
  label: string;
  fields: TypeFieldDef[];
}

/** 内置类型（可被 vault 本地 schema 覆盖） */
export const BUILTIN_NOTE_TYPES: NoteTypeSchema[] = [
  {
    id: 'note',
    labelKey: 'noteTypeNote',
    label: '笔记',
    fields: [
      { key: 'status', labelKey: 'noteFieldStatus', label: '状态', kind: 'text' },
      { key: 'tags', labelKey: 'noteFieldTags', label: '标签', kind: 'list' },
    ],
  },
  {
    id: 'person',
    labelKey: 'noteTypePerson',
    label: '人物',
    fields: [
      { key: 'org', labelKey: 'noteFieldOrg', label: '组织', kind: 'text' },
      { key: 'role', labelKey: 'noteFieldRole', label: '角色', kind: 'text' },
      { key: 'related', labelKey: 'noteFieldRelated', label: '相关', kind: 'relation' },
    ],
  },
  {
    id: 'project',
    labelKey: 'noteTypeProject',
    label: '项目',
    fields: [
      { key: 'status', labelKey: 'noteFieldStatus', label: '状态', kind: 'text' },
      { key: 'owner', labelKey: 'noteFieldOwner', label: '负责人', kind: 'relation' },
      { key: 'depends', labelKey: 'noteFieldDepends', label: '依赖', kind: 'relation' },
    ],
  },
  {
    id: 'meeting',
    labelKey: 'noteTypeMeeting',
    label: '会议',
    fields: [
      { key: 'date', labelKey: 'noteFieldDate', label: '日期', kind: 'text' },
      { key: 'attendees', labelKey: 'noteFieldAttendees', label: '参会', kind: 'relation' },
      { key: 'project', labelKey: 'noteFieldProject', label: '项目', kind: 'relation' },
    ],
  },
];

export function getNoteType(
  content: string,
  catalog: NoteTypeSchema[] = BUILTIN_NOTE_TYPES
): NoteTypeSchema | null {
  const doc = parseFrontmatter(content);
  const typeField = doc.fields.find((f) => f.kind === 'pair' && f.key === 'type');
  if (!typeField?.value) return null;
  const id = typeField.value.trim().toLowerCase();
  return catalog.find((t) => t.id === id) ?? null;
}

/** 类型建议字段中尚未出现在 frontmatter 的键 */
export function missingTypeFields(
  content: string,
  catalog: NoteTypeSchema[] = BUILTIN_NOTE_TYPES
): TypeFieldDef[] {
  const schema = getNoteType(content, catalog);
  if (!schema) return [];
  const doc = parseFrontmatter(content);
  const present = new Set(
    doc.fields.filter((f) => f.kind === 'pair').map((f) => f.key.toLowerCase())
  );
  return schema.fields.filter((f) => !present.has(f.key.toLowerCase()));
}

/** 从 relation 字段解析目标名（逗号/分号/中括号列表） */
export function parseRelationTargets(raw: string): string[] {
  const cleaned = raw.replace(/^\[|\]$/g, '');
  return cleaned
    .split(/[,;，、]/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

export interface TypedLink {
  field: string;
  target: string;
}

/** 当前笔记上声明的类型化出链 */
export function typedOutgoing(
  note: VaultNote,
  catalog: NoteTypeSchema[] = BUILTIN_NOTE_TYPES
): TypedLink[] {
  const schema = getNoteType(note.content, catalog);
  const doc = parseFrontmatter(note.content);
  const relKeys = new Set(
    (schema?.fields.filter((f) => f.kind === 'relation').map((f) => f.key) ?? []).map((k) =>
      k.toLowerCase()
    )
  );
  // 无 schema 时仍识别常见关系键
  if (relKeys.size === 0) {
    ['related', 'owner', 'depends', 'attendees', 'project', 'parent'].forEach((k) =>
      relKeys.add(k)
    );
  }
  const links: TypedLink[] = [];
  for (const f of doc.fields) {
    if (f.kind !== 'pair' || !relKeys.has(f.key.toLowerCase())) continue;
    for (const t of parseRelationTargets(f.value)) {
      links.push({ field: f.key, target: t });
    }
  }
  return links;
}
