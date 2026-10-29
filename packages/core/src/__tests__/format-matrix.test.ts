/**
 * 格式矩阵渲染级集成测试（Node 端，权威验证渲染管线逻辑）。
 *
 * 与桌面端 e2e（desktop-test/format-suite.mjs，经 CDP 注入真实 DOM 断言）互为补充：
 * 本测试直接调用 @md-studio/core 的 render() 管线，对输出的 hast / 序列化 HTML
 * 做断言，覆盖 GFM、数学、脚注、内联 HTML、双链、分页符、净化等全部格式路径。
 * 组件层（Mermaid SVG / Tldraw 交互 / 标题 contentEditable）仍由桌面 e2e 覆盖。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '../parser/pipeline';
import { DEFAULT_TYPOGRAPHY } from '../types';

// 夹具放在包内并随仓库提交：desktop-test/ 已被 .gitignore 排除，
// 依赖它会让 CI 拿不到文件（ENOENT），且硬编码本机绝对路径无法跨机器运行。
const MD_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'format-matrix.md'
);

let hast: any = null;
let r: Awaited<ReturnType<typeof render>>;
let checks: Check[] = [];

beforeAll(async () => {
  const md = fs.readFileSync(MD_PATH, 'utf8');
  r = await render(md, {
    gfm: true,
    frontmatter: true,
    math: true,
    highlight: true,
    dataLine: true,
    externalLinksNewTab: true,
    wikilinks: true,
    typography: DEFAULT_TYPOGRAPHY,
    autoNumber: false,
    highlightTheme: 'light',
    footnoteLabel: '脚注',
    footnoteBackLabel: '返回引用',
  });
  hast = r.hast;
  checks = runChecks();
});

/** 收集所有元素（手动递归，规避 unist-util-visit 在此树上的计数异常） */
function allElements(): any[] {
  const out: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'element' && node.tagName) out.push(node);
    const kids = node.children;
    if (Array.isArray(kids)) for (const c of kids) walk(c);
  };
  walk(hast);
  return out;
}
function byTag(tag: string): any[] {
  return allElements().filter((e) => e.tagName === tag);
}
/** 兼容 hast 两种 class 表示：properties.className（数组）与 properties.class（字符串） */
function classList(node: any): string[] {
  const p = node.properties ?? {};
  const out: string[] = [];
  if (Array.isArray(p.className)) out.push(...p.className);
  if (typeof p.class === 'string') out.push(...p.class.split(/\s+/).filter(Boolean));
  return out;
}
function byTagClass(tag: string, cls: string): any[] {
  return allElements().filter(
    (e) => e.tagName === tag && classList(e).includes(cls)
  );
}
function textOf(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.value;
  if (node.children) return node.children.map(textOf).join('');
  return '';
}

interface Check {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
}

function runChecks(): Check[] {
  const checks: Check[] = [];
  const add = (id: string, name: string, ok: boolean, detail: string) =>
    checks.push({ id, name, ok, detail });

  // F01 标题 h1–h6（排除 sr-only 脚注标题）
  {
    const counts = [1, 2, 3, 4, 5, 6].map(
      (i) =>
        byTag('h' + i).filter((e) => !(e.properties?.className ?? []).includes('sr-only'))
          .length
    );
    add('F01', '标题 h1–h6', counts.every((n) => n === 1), counts.join('/'));
  }
  // F02 硬换行
  {
    const p = byTag('p').find((e) => textOf(e).includes('段落第二行'));
    const hasBr = !!p && p.children.some((c: any) => c.type === 'element' && c.tagName === 'br');
    add('F02', '硬换行（行尾两空格）', hasBr, p ? 'br=' + hasBr : 'no-p');
  }
  // F03 粗体/斜体/粗斜体
  {
    const strong = byTag('strong');
    const em = byTag('em');
    const nested = allElements().some(
      (e) =>
        (e.tagName === 'strong' && e.children?.some((c: any) => c.tagName === 'em')) ||
        (e.tagName === 'em' && e.children?.some((c: any) => c.tagName === 'strong'))
    );
    add(
      'F03',
      '粗体/斜体/粗斜体',
      strong.some((s) => textOf(s) === '粗体') &&
        em.some((e) => textOf(e) === '斜体') &&
        nested,
      `strong=${strong.length} em=${em.length} nested=${nested}`
    );
  }
  // F04 删除线
  {
    const del = byTag('del').find((e) => textOf(e) === '删除线');
    add('F04', '删除线', !!del, del ? textOf(del) : 'none');
  }
  // F05 行内代码
  {
    const code = byTag('code').filter((e) => e.tagName === 'code' && textOf(e) === '行内代码');
    add('F05', '行内代码', code.length >= 1, 'n=' + code.length);
  }
  // F06 外链新窗口 + rel
  {
    const a = allElements().find(
      (e) => e.tagName === 'a' && e.properties?.href === 'https://example.com'
    );
    const ok = !!a && a.properties.target === '_blank' && (a.properties.rel || '').includes('noopener');
    add('F06', '外链（新窗口+rel）', ok, JSON.stringify({ t: a?.properties?.target, r: a?.properties?.rel }));
  }
  // F07 自动链接
  {
    const a = allElements().find(
      (e) => e.tagName === 'a' && typeof e.properties?.href === 'string' && e.properties.href.includes('auto.example.com')
    );
    add('F07', '自动链接', !!a, a?.properties?.href ?? 'none');
  }
  // F08 双链 [[目标|别名]] / [[仅目标]]（data 属性）
  {
    const wiki = allElements().filter((e) => e.tagName === 'a' && (e.properties?.dataTarget || e.properties?.['data-target']));
    const target = (e: any) => e.properties?.dataTarget ?? e.properties?.['data-target'];
    const ok =
      wiki.length === 2 &&
      target(wiki[0]) === '目标笔记' &&
      textOf(wiki[0]) === '双链别名' &&
      target(wiki[1]) === '仅目标';
    add('F08', '双链 [[目标|别名]]', ok, JSON.stringify(wiki.map((e) => [target(e), textOf(e)])));
  }
  // F09 无序列表三层嵌套
  {
    const ulCount = byTag('ul').length;
    add('F09', '无序列表+三层嵌套', ulCount >= 3, 'ul=' + ulCount);
  }
  // F10 有序列表 start=3
  {
    const ol = byTag('ol').find((e) => textOf(e).includes('有序从三开始'));
    const liCount = ol ? ol.children.filter((c: any) => c.tagName === 'li').length : 0;
    add('F10', '有序列表(start=3)', !!ol && ol.properties?.start === 3 && liCount === 2, ol ? `${ol.properties?.start}/${liCount}` : 'none');
  }
  // F11 任务列表勾选态
  {
    const boxes = byTag('input').filter((e) => e.properties?.type === 'checkbox');
    const checked = boxes.filter((e) => e.properties?.checked).length;
    add('F11', '任务列表（勾选态）', boxes.length === 2 && checked === 1, `n=${boxes.length} checked=${checked}`);
  }
  // F12 引用嵌套 + 列表
  {
    const bq = byTag('blockquote');
    const nested = bq.filter((e) => e.children.some((c: any) => c.tagName === 'blockquote')).length;
    const liInBq = bq.some((e) => e.children.some((c: any) => c.tagName === 'ul' || c.tagName === 'ol'));
    add('F12', '引用（嵌套+列表）', nested >= 1 && liInBq, `nest=${nested} li=${liInBq}`);
  }
  // F13 表格三列对齐
  {
    const ths = byTag('th');
    const left = ths.find((e) => textOf(e).includes('左对齐'));
    const center = ths.find((e) => textOf(e).includes('居中'));
    const right = ths.find((e) => textOf(e).includes('右对齐'));
    const ok = !!left && left.properties?.align === 'left' && !!center && center.properties?.align === 'center' && !!right && right.properties?.align === 'right';
    add('F13', '表格三列对齐', ok, JSON.stringify({ l: left?.properties?.align, c: center?.properties?.align, r: right?.properties?.align }));
  }
  // F14 表格内行内代码
  {
    const cellCode = byTag('td').some((e) => e.children?.some((c: any) => c.tagName === 'code' && textOf(c) === 'B'));
    add('F14', '表格内行内代码', cellCode, 'ok=' + cellCode);
  }
  // F15 代码块高亮 shiki
  {
    const pre = byTagClass('pre', 'shiki');
    const colored = pre.length ? visitSpanStyle(pre[0]) : 0;
    add('F15', '代码块高亮(shiki)', !!pre.length && colored > 0, pre.length ? 'spans=' + colored : 'no-shiki');
  }
  // F16 无语言代码块
  {
    const plain = byTag('pre').some((e) => textOf(e).includes('无语言代码块'));
    add('F16', '无语言代码块', plain, 'ok=' + plain);
  }
  // F17 行内数学 KaTeX
  {
    const katex = byTagClass('span', 'katex').filter((e) => !isDisplay(e));
    add('F17', '行内数学(KaTeX)', katex.length >= 1, 'n=' + katex.length);
  }
  // F18 块级数学 KaTeX display
  {
    const disp = byTagClass('span', 'katex-display');
    add('F18', '块级数学(KaTeX)', disp.length >= 1, 'n=' + disp.length);
  }
  // F19 图片尺寸 =300x200
  {
    const im = byTag('img').find((e) => e.properties?.alt === '占位图');
    add('F19', '图片尺寸语法', !!im && String(im.properties?.width) === '300' && String(im.properties?.height) === '200', JSON.stringify({ w: im?.properties?.width, h: im?.properties?.height }));
  }
  // F20 普通图片
  {
    const im = byTag('img').find((e) => e.properties?.alt === '普通图');
    add('F20', '普通图片', !!im, im?.properties?.src ?? 'none');
  }
  // F21 分隔线
  {
    add('F21', '分隔线', byTag('hr').length >= 1, 'n=' + byTag('hr').length);
  }
  // F22 脚注引用+内容
  {
    const sec = byTagClass('section', 'footnotes')[0];
    const sup = byTag('sup').length > 0;
    add('F22', '脚注（引用+内容）', !!sec && sup && textOf(sec).includes('第一条脚注内容'), JSON.stringify({ sec: !!sec, sup, body: !!sec && textOf(sec).includes('第一条脚注内容') }));
  }
  // F23 内联 HTML（含 style）
  {
    const d = byTagClass('div', 'html-block')[0];
    const ok = !!d && textOf(d).includes('内联 HTML 段落') && !!d.properties?.style;
    add('F23', '内联 HTML（含 style）', ok, d ? 'style=' + JSON.stringify(d.properties.style) : 'none');
  }
  // F24 脚本被净化
  {
    const scripts = byTag('script');
    add('F24', '脚本被净化', scripts.length === 0, 'scripts=' + scripts.length);
  }
  // F25 分页符
  {
    const d = byTagClass('div', 'pagebreak');
    add('F25', '分页符 pagebreak', !!d.length, d.length ? d[0].properties?.className?.join(',') : 'none');
  }
  // F26 frontmatter 不进入正文
  {
    const txt = textOf(hast);
    add('F26', 'Frontmatter 不进正文', !txt.includes('title: 格式矩阵') && !txt.includes('author: tester'), txt.slice(0, 40));
  }
  // F27 mermaid fence（组件层渲染 SVG，管线层保证 fence 语言类）
  {
    const pre = byTag('pre').find((e) => textOf(e).includes('graph TD'));
    const code = pre?.children?.find((c: any) => c.tagName === 'code');
    const ok = !!pre && !!code && (code.properties?.className ?? []).some((c: string) => c.includes('language-mermaid'));
    add('F27', 'Mermaid fence', ok, ok ? 'lang=mermaid' : 'no-fence');
  }
  // F28 tldraw fence（按语言类定位，围栏正文为应用自有协议 {"v":1,...}）
  {
    const codeOf = (e: any) => e?.children?.find((c: any) => c.tagName === 'code');
    const hasLang = (e: any, lang: string) =>
      (codeOf(e)?.properties?.className ?? []).some((c: string) => c.includes(lang));
    const pre = byTag('pre').find((e) => hasLang(e, 'language-tldraw'));
    const code = codeOf(pre);
    const ok = !!pre && !!code;
    add('F28', 'Tldraw fence', ok, ok ? 'lang=tldraw' : 'no-fence');
  }
  // F29 标题锚点 id
  {
    const h1 = byTag('h1').find((e) => !(e.properties?.className ?? []).includes('sr-only'));
    add('F29', '标题锚点 id', !!h1?.properties?.id, h1?.properties?.id ?? 'none');
  }
  // F30 CJK 自动间距
  {
    const txt = textOf(hast);
    add('F30', 'CJK 自动间距', txt.includes('中文 English 混排 123 数字'), (txt.match(/中文[^<\n]{0,30}/) || [''])[0]);
  }
  // F31 标题自动编号默认关闭
  {
    const h1 = byTag('h1').find((e) => !(e.properties?.className ?? []).includes('sr-only'));
    add('F31', '标题编号默认关闭', textOf(h1).trim() === '一级标题', textOf(h1));
  }
  // F32 行内 HTML <kbd>
  {
    const kbd = byTag('kbd');
    add('F32', '行内 <kbd>', kbd.length === 2 && kbd[0]?.children?.[0]?.value === 'Ctrl' && kbd[1]?.children?.[0]?.value === 'S', JSON.stringify(kbd.map((k) => textOf(k))));
  }
  // F33 危险属性/脚本被剥离
  {
    const bad = byTagClass('div', 'html-danger');
    const ok = !!bad.length && !bad[0].properties?.onclick;
    add('F33', '危险属性剥离', ok, JSON.stringify({ exists: !!bad.length, onclick: bad[0]?.properties?.onclick ?? null }));
  }
  // F34 脚注标题本地化（zh-CN → 脚注）
  {
    const h2 = byTagClass('h2', 'sr-only')[0];
    add('F34', '脚注标题本地化', !!h2 && textOf(h2) === '脚注', h2 ? textOf(h2) : 'none');
  }
  // F35 等号高亮（`==文字==` → <mark>）
  {
    const marks = byTag('mark');
    const ok = marks.length === 1 && textOf(marks[0]).trim() === '这类文字';
    add('F35', '==高亮== 语法', ok, JSON.stringify(marks.map((m) => textOf(m))));
  }
  return checks;
}

function visitSpanStyle(node: any): number {
  let n = 0;
  const walk = (x: any) => {
    if (!x || typeof x !== 'object') return;
    if (x.type === 'element' && x.tagName === 'span' && x.properties?.style) n++;
    if (Array.isArray(x.children)) for (const c of x.children) walk(c);
  };
  walk(node);
  return n;
}
function isDisplay(node: any): boolean {
  return (node.properties?.className ?? []).includes('katex-display');
}

describe('format matrix (render pipeline)', () => {
  it('all format checks (F01-F35)', () => {
    expect(checks.length).toBeGreaterThan(0);
    const failed = checks.filter((c) => !c.ok);
    for (const c of checks) {
      // 打印每项结果，便于定位
       
      console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.id} ${c.name} :: ${c.detail}`);
    }
    expect(failed.length, 'FAILED: ' + failed.map((f) => `${f.id}(${f.name})`).join(', ')).toBe(0);
  });
});
