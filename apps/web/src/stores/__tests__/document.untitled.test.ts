/**
 * 新建文档默认名随界面语言本地化。
 * 回归点：不同语言模式下新建文档曾固定显示中文「未命名」。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useDocuments } from '../document';
import { useSettings } from '../settings';
import type { Locale } from '../../i18n';

const resetDocs = () => useDocuments.setState({ docs: {}, order: [], activeId: null });

describe('newDoc 默认命名跟随语言', () => {
  beforeEach(() => {
    resetDocs();
  });

  const cases: { locale: Locale; name: string; heading: string }[] = [
    { locale: 'zh-CN', name: '未命名.md', heading: '# 新文档' },
    { locale: 'en', name: 'Untitled.md', heading: '# New document' },
    { locale: 'ja', name: '無題.md', heading: '# 新規ドキュメント' },
  ];

  for (const c of cases) {
    it(`${c.locale} 下新建文档使用本地化名称`, () => {
      useSettings.setState({ locale: c.locale });
      const id = useDocuments.getState().newDoc();
      const doc = useDocuments.getState().docs[id];
      expect(doc.name).toBe(c.name);
      expect(doc.content.startsWith(c.heading)).toBe(true);
    });
  }

  it('重名时追加序号且仍使用当前语言前缀', () => {
    useSettings.setState({ locale: 'en' });
    useDocuments.getState().newDoc();
    const second = useDocuments.getState().newDoc();
    expect(useDocuments.getState().docs[second].name).toBe('Untitled 2.md');
  });
});
