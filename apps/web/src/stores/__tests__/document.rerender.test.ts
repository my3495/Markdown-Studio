/**
 * 渲染相关设置变更后必须重渲染已打开文档。
 *
 * 回归点：标题编号 / 正文内目录等设置只写进了 store，预览区仍显示旧 hast，
 * 用户改完设置看不到任何变化（正文内目录开关尤其明显：关掉后 [TOC] 仍渲染成目录）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useDocuments } from '../document';
import { useSettings } from '../settings';

const resetDocs = () => useDocuments.setState({ docs: {}, order: [], activeId: null });

/** 等待文档渲染完成（render 是异步的） */
async function waitRender() {
  for (let i = 0; i < 50; i++) {
    const d = useDocuments.getState().docs[useDocuments.getState().activeId ?? ''];
    if (d?.hast) return d;
    await new Promise((r) => setTimeout(r, 20));
  }
  return useDocuments.getState().docs[useDocuments.getState().activeId ?? ''];
}

describe('rerenderAll：设置变更后重渲染', () => {
  beforeEach(() => {
    resetDocs();
    useSettings.setState({ autoNumber: false, tocPlaceholder: false, locale: 'zh-CN' });
  });

  it('开启正文内目录后，预览里 [TOC] 变成目录', async () => {
    const id = useDocuments.getState().newDoc();
    useDocuments.setState((s) => ({
      docs: { ...s.docs, [id]: { ...s.docs[id]!, content: '# 标题\n\n[TOC]\n\n## 小节\n' } },
    }));
    await useDocuments.getState().updateContent(id, '# 标题\n\n[TOC]\n\n## 小节\n');
    await waitRender();

    const before = useDocuments.getState().docs[id]!;
    expect(before.hast).toBeTruthy();
    // 关闭时：正文里是字面量 [TOC]
    expect(JSON.stringify(before.hast)).toContain('[TOC]');

    useSettings.setState({ tocPlaceholder: { maxDepth: 3, title: '目录' } });
    useDocuments.getState().rerenderAll();
    await new Promise((r) => setTimeout(r, 200));

    const after = useDocuments.getState().docs[id]!;
    const html = JSON.stringify(after.hast);
    // 开启后：出现目录容器，字面量消失
    expect(html).toContain('md-toc');
    expect(html).not.toContain('[TOC]');
  });

  it('关闭正文内目录后，目录容器消失、字面量回来', async () => {
    useSettings.setState({ tocPlaceholder: { maxDepth: 3, title: '目录' } });
    const id = useDocuments.getState().newDoc();
    await useDocuments.getState().updateContent(id, '# 标题\n\n[TOC]\n\n## 小节\n');
    await waitRender();
    expect(JSON.stringify(useDocuments.getState().docs[id]!.hast)).toContain('md-toc');

    useSettings.setState({ tocPlaceholder: false });
    useDocuments.getState().rerenderAll();
    await new Promise((r) => setTimeout(r, 200));

    const html = JSON.stringify(useDocuments.getState().docs[id]!.hast);
    expect(html).not.toContain('md-toc');
    expect(html).toContain('[TOC]');
  });

  it('标题编号设置变更后重新渲染', async () => {
    const id = useDocuments.getState().newDoc();
    await useDocuments.getState().updateContent(id, '# 标题\n');
    await waitRender();
    expect(JSON.stringify(useDocuments.getState().docs[id]!.hast)).not.toContain('"1. "');

    useSettings.setState({ autoNumber: 'arabic' });
    useDocuments.getState().rerenderAll();
    await new Promise((r) => setTimeout(r, 200));

    // 编号以独立文本节点注入（"1. " + 标题），故按节点值断言
    expect(JSON.stringify(useDocuments.getState().docs[id]!.hast)).toContain('"1. "');
  });

  it('重渲染不把文档标记为 dirty（不污染保存状态）', async () => {
    const id = useDocuments.getState().newDoc();
    await useDocuments.getState().updateContent(id, '# 标题\n');
    await waitRender();
    useDocuments.getState().markSaved(id, 'x.md');
    expect(useDocuments.getState().docs[id]!.dirty).toBe(false);

    useSettings.setState({ tocPlaceholder: { maxDepth: 3 } });
    useDocuments.getState().rerenderAll();
    await new Promise((r) => setTimeout(r, 200));

    expect(useDocuments.getState().docs[id]!.dirty).toBe(false);
  });
});
