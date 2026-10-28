import { describe, expect, it } from 'vitest';
import DOMPurify from 'dompurify';
import { MERMAID_CONFIG } from '../components/Mermaid';

/**
 * Mermaid 渲染配置回归测试。
 * 背景：默认 htmlLabels=true 会把标签渲染进 <foreignObject>，而 DOMPurify
 * 默认白名单不含该标签，二次净化后「形状在、文字全无」。
 */
describe('Mermaid 渲染配置', () => {
  it('M-01 根级关闭 htmlLabels，标签应走 SVG <text> 而非 foreignObject', () => {
    expect(MERMAID_CONFIG.htmlLabels).toBe(false);
  });

  it('M-02 不使用已弃用的图型级开关（flowchart.htmlLabels 会触发 deprecated 警告）', () => {
    expect(MERMAID_CONFIG).not.toHaveProperty('flowchart');
  });

  it('M-03 固化根因：DOMPurify 默认配置会剥离 foreignObject 及其文字', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect></rect>' +
      '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">节点文字</div></foreignObject></svg>';
    const out = DOMPurify.sanitize(svg);
    expect(out).not.toContain('foreignObject');
    expect(out).not.toContain('节点文字');
  });
});
