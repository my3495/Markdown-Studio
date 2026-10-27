import { visit } from 'unist-util-visit';
import GithubSlugger from 'github-slugger';
import { getNodeText } from '../util';

/**
 * 为标题生成稳定且唯一的 id（github-slugger 自动去重）。
 *
 * 重要：slugger 必须在**每次渲染内**新建，不能在插件工厂（`remarkHeadingId()`）里
 * 建一次就复用。渲染管线会按选项缓存 unified processor（见 pipeline.ts），
 * 同一份 processor 会被后续渲染复用；闭包里共享 slugger 会让去重计数器跨文档累加，
 * 于是同一份文档第二次渲染时 id 变成 `标题-1`、第三次 `标题-2`。
 * 后果：正文内锚点链接失效、目录跳转点不中、导出的 HTML 里 id 不稳定。
 *
 * 与 remarkToc / remarkCjkTypography 一致，状态通过 tree.data 传递：
 * 这里每次 run 都从 tree 上取（或就地新建）slugger，保证「一次渲染 = 一套 id」。
 */
export function remarkHeadingId() {
  return (tree: any) => {
    // 每次渲染一棵新树 → 新 slugger（计数从 0 开始）
    const slugger: GithubSlugger = new GithubSlugger();
    visit(tree, 'heading', (node: any) => {
      const text = getNodeText(node);
      const id = slugger.slug(text || `section`);
      node.data = node.data || {};
      node.data.id = id;
      node.data.hProperties = node.data.hProperties || {};
      node.data.hProperties.id = id;
    });
  };
}
