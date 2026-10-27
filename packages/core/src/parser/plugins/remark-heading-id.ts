import { visit } from 'unist-util-visit';
import GithubSlugger from 'github-slugger';
import { getNodeText } from '../util';

/** 为标题生成稳定且唯一的 id（github-slugger 自动去重） */
export function remarkHeadingId() {
  const slugger = new GithubSlugger();
  return (tree: any) => {
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
