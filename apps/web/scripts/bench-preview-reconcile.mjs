/**
 * 预览 reconcile 性能基准（可复现）
 *
 * 用法：
 *   1) 先启动 dev server： pnpm --filter @md-studio/web dev
 *   2) node scripts/bench-preview-reconcile.mjs --label=before
 *
 * 测量口径（对应 docs/large-doc-freeze-diagnosis.md 第四节）：
 *   - 大文档首帧后，在文末连续输入 10 个字符（间隔 120ms）
 *   - longtask 数量与总时长：反映输入期间主线程被占用的情况
 *   - 末次按键 → 预览追平耗时：反映「输入到看见」的延迟
 *   - 追平后再改一个字，测「单块变更」的渲染耗时
 *
 * 该基准只做测量、不改代码；改动前后各跑一次同参数即可对比。
 */
import { chromium } from '@playwright/test';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:1420/';
const LABEL = (process.argv.find((a) => a.startsWith('--label=')) ?? '--label=run').split('=')[1];

/** 约 320 个顶层块、数千 DOM 节点：接近真实长文的块级构成 */
function buildDoc() {
  const parts = ['# 压力测试文档\n'];
  for (let i = 1; i <= 40; i++) {
    parts.push(`## 小节 ${i}\n`);
    for (let j = 0; j < 4; j++) {
      parts.push(
        `第 ${i}-${j} 段正文，含 **加粗**、\`行内代码\` 与 [链接](https://example.com)。` +
          `这里再补一些中文，让段落长度接近真实文档的平均值，用于放大 reconcile 成本。\n`
      );
    }
    parts.push(
      `| 列 A | 列 B | 列 C |\n| --- | --- | --- |\n| ${i} | 值 | 说明 |\n| ${i} | 值 | 说明 |\n`
    );
    parts.push('```ts\nconst a: number = 1;\nconst b = a + 1;\n```\n');
    parts.push('- 项目一\n  - 嵌套二\n- 项目三\n');
  }
  return parts.join('\n');
}

const DOC = buildDoc();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(BASE);
await page.waitForSelector('.cm-editor', { timeout: 60_000 });

// 预跑一份带代码块的文档：把 shiki 主题 + TS 语言的冷启动挪出测量区间。
// 必须等到 shiki 产物出现才算 Worker 真正就绪 —— dev 下 Worker 首次加载 core 的
// 依赖图要 1–2s，若不等就开测，会把「首次加载」误算成渲染延迟（实测差异可达 100ms+）。
await page.evaluate(async () => {
  const view = document.querySelector('.cm-editor').__md_view;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '# 预热\n\n```ts\nconst x = 1;\n```\n' } });
});
await page.waitForSelector('.md-preview pre.shiki', { timeout: 60_000 });
await page.waitForTimeout(1200);

await page.evaluate((md) => {
  const view = document.querySelector('.cm-editor').__md_view;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: md } });
}, DOC);
await page.waitForSelector('.md-preview h1', { timeout: 60_000 });
await page.waitForTimeout(2500);

const shape = await page.evaluate(() => ({
  nodes: document.querySelectorAll('.md-preview *').length,
  blocks: document.querySelector('.md-preview')?.children.length ?? 0,
}));
// 渲染是否真的跑在 Worker 里（未创建 / 已回退主线程时这里为空）
shape.workers = page.workers().map((w) => w.url().split('/').pop());

// longtask 观测
await page.evaluate(() => {
  window.__lt = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__lt.push(Math.round(e.duration));
  }).observe({ entryTypes: ['longtask'] });
});

// 连续输入 10 个字符（每次输入都在文末新增，应只影响最后一个块）
const CHARS = 10;
const MARK = 'Z'.repeat(CHARS);
for (let i = 0; i < CHARS; i++) {
  await page.evaluate(() => {
    const view = document.querySelector('.cm-editor').__md_view;
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'Z' } });
  });
  await page.waitForTimeout(120);
}

const settle = await page.evaluate(async (mark) => {
  const t0 = performance.now();
  const root = document.querySelector('.md-preview');
  for (let i = 0; i < 400; i++) {
    if ((root?.textContent ?? '').includes(mark)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return Math.round(performance.now() - t0);
}, MARK);

const typing = await page.evaluate(() => {
  const lt = window.__lt ?? [];
  return { count: lt.length, total: lt.reduce((a, b) => a + b, 0), max: Math.max(0, ...lt) };
});

// 单块变更（追平后再改一个字）的耗时
const single = await page.evaluate(async () => {
  const view = document.querySelector('.cm-editor').__md_view;
  const t0 = performance.now();
  view.dispatch({ changes: { from: view.state.doc.length, insert: 'Q' } });
  const root = document.querySelector('.md-preview');
  for (let i = 0; i < 400; i++) {
    if ((root?.textContent ?? '').includes('Q')) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  return Math.round(performance.now() - t0);
});

await browser.close();

console.log(
  JSON.stringify(
    { label: LABEL, ...shape, typingLongTasks: typing, settleAfterLastKeyMs: settle, singleCharMs: single },
    null,
    2
  )
);
