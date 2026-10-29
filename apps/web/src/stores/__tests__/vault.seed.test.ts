import { describe, expect, it } from 'vitest';
import { useVault } from '../vault';

/**
 * 演示知识库种子。
 *
 * 「使用指南.md」直接来自仓库根目录的同名文档（`?raw` 内联），
 * 这里守住两件事：① 内联真的生效（不是空串或旧的三行示例）；
 * ② 其余演示笔记仍在，双链关系不会因为改文案而断掉。
 */
describe('演示知识库种子', () => {
  const notes = useVault.getState().notes;
  const guide = notes.find((n) => n.name === '使用指南.md');

  it('S-01 使用指南.md 内联了完整文档（而非旧的示例短文案）', () => {
    expect(guide).toBeTruthy();
    expect(guide!.content.length).toBeGreaterThan(5000);
    expect(guide!.content).toContain('# Markdown Studio 使用指南');
  });

  it('S-02 文档包含目录占位符与末尾章节，说明取的是最新版本', () => {
    expect(guide!.content).toContain('[TOC]');
    expect(guide!.content).toContain('## 11. 导出与分享');
    expect(guide!.content).toContain('## 17. 已知限制与注意事项');
  });

  it('S-03 其余演示笔记保留，且都链回使用指南（图谱仍有边）', () => {
    for (const name of ['双链与反链.md', '知识图谱.md', '全文搜索.md']) {
      const n = notes.find((x) => x.name === name);
      expect(n, `${name} 缺失`).toBeTruthy();
      expect(n!.content).toContain('[[使用指南]]');
    }
  });
});
