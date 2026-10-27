import { describe, it, expect } from 'vitest';
import { render } from '../src/parser/pipeline';

function findWikiAnchors(node: any, out: any[] = []): any[] {
  if (!node) return out;
  if (node.type === 'element' && node.tagName === 'a' && node.properties?.dataWikilink) {
    out.push(node);
  }
  if (Array.isArray(node.children)) node.children.forEach((c: any) => findWikiAnchors(c, out));
  return out;
}

describe('wikilink 渲染（管线端到端）', () => {
  it('[[目标|别名]] 渲染为 data-wikilink 锚点，别名作为文本', async () => {
    const { hast } = await render('见 [[Alpha|阿尔法]] 结尾', { highlight: false });
    const anchors = findWikiAnchors(hast);
    expect(anchors.length).toBe(1);
    expect(anchors[0].properties.dataTarget).toBe('Alpha');
    expect(anchors[0].children[0].value).toBe('阿尔法');
  });

  it('代码块内的 [[xxx]] 不被转换', async () => {
    const { hast } = await render('```\n[[NotALink]]\n```', { highlight: false });
    expect(findWikiAnchors(hast).length).toBe(0);
  });
});
