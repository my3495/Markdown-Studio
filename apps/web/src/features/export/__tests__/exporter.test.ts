import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 导出功能的 Web 层（`features/export/exporter.ts`）细粒度测试。
 *
 * 关注点不是「HTML 长什么样」（那是 core 的 export-html.test.ts），而是**浏览器侧动作**：
 * 下载文件名与 MIME、分享版的横幅与页脚、打印窗口的写入与 print 时机、
 * Pandoc 分支是「直接下载 .tex」还是「下载 .md + 复制命令」、分享卡片是否清理 DOM。
 */

// html-to-image 会真的去画 canvas（jsdom 不支持），只验证「被调用 + 传入内容」
const toPngMock = vi.fn(async (_node: HTMLElement) => 'data:image/png;base64,MOCK');
vi.mock('html-to-image', () => ({ toPng: (node: HTMLElement) => toPngMock(node) }));

const {
  buildHtmlDoc,
  downloadHtml,
  downloadShareHtml,
  printPdf,
  exportShareCard,
  exportViaPandoc,
} = await import('../exporter');

/** 渲染选项：关掉 Shiki，避免每次导出都等代码高亮 */
const FAST = { highlight: false };

interface Clicked {
  name: string;
  href: string;
}

let clicked: Clicked[] = [];
let blobs: Blob[] = [];
let clipboardText: string[] = [];

beforeEach(() => {
  clicked = [];
  blobs = [];
  clipboardText = [];

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:mock';
    }),
    revokeObjectURL: vi.fn(),
  });

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicked.push({ name: this.download, href: this.href });
  });

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn(async (t: string) => {
        clipboardText.push(t);
      }),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** 等下载（导出是 fire-and-forget，必须等异步渲染完成） */
async function waitForDownload(count = 1) {
  await vi.waitFor(() => expect(clicked.length).toBe(count), { timeout: 20_000, interval: 20 });
}

describe('buildHtmlDoc', () => {
  it('E-X01 产出自足单文件，公式带 KaTeX 结构', async () => {
    const html = await buildHtmlDoc('公式 $E=mc^2$', { title: 't', renderOpts: FAST });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<article class="md-preview">');
    expect(html).toContain('class="katex"');

    // vitest 对 `.css?raw` 的默认处理可能返回空串（CSS 资源在测试环境被置空），
    // 因此这里只校验「有基础样式块；若 KaTeX 样式确实注入则应为第二块」。
    // 真实构建下两块样式由浏览器端 e2e 审计脚本断言。
    const rawKatex = (await import('katex/dist/katex.min.css?raw')).default as string;
    const styleCount = (html.match(/<style>/g) ?? []).length;
    expect(styleCount).toBe(rawKatex ? 2 : 1);
    if (rawKatex) expect(html).toContain('.katex');
  });

  it('E-X02 dark 模式传入 dark 主题变量', async () => {
    const html = await buildHtmlDoc('x', { mode: 'dark', renderOpts: FAST });
    expect(html).toContain('--md-color-bg: #1a1815;');
  });

  it('E-X03 footer 默认开启，传参可覆盖', async () => {
    const on = await buildHtmlDoc('x', { renderOpts: FAST });
    expect(on).toContain('<footer class="md-footer">');

    const off = await buildHtmlDoc('x', { renderOpts: FAST, footer: { enabled: false } });
    expect(off).not.toContain('<footer');
  });
});

describe('downloadHtml', () => {
  it('E-X04 生成 Blob（text/html）并触发下载，文件名为 <title>.html', async () => {
    downloadHtml('==高亮== 正文', { title: 'note', renderOpts: FAST });
    await waitForDownload();

    expect(clicked[0]!.name).toBe('note.html');
    expect(clicked[0]!.href).toBe('blob:mock');
    expect(blobs[0]!.type).toBe('text/html;charset=utf-8');
    const text = await blobs[0]!.text();
    expect(text).toContain('<mark>高亮</mark>');
  });

  it('E-X05 未给标题时回退到 export.html', async () => {
    downloadHtml('x', { renderOpts: FAST });
    await waitForDownload();
    expect(clicked[0]!.name).toBe('export.html');
  });

  it('E-X05b 文档名带 .md 时不产生 note.md.html 这种双扩展名', async () => {
    downloadHtml('x', { title: '未命名.md', renderOpts: FAST });
    await waitForDownload();
    expect(clicked[0]!.name).toBe('未命名.html');
  });
});

describe('downloadShareHtml（只读分享版）', () => {
  it('E-X06 文件名去掉 .md 扩展名并加 -share', async () => {
    downloadShareHtml('x', { title: 'note.md', renderOpts: FAST });
    await waitForDownload();
    expect(clicked[0]!.name).toBe('note-share.html');
  });

  it('E-X07 横幅插在真实 <body> 之后、正文容器之前（不落进 CSS 注释）', async () => {
    downloadShareHtml('正文', { title: 'n', renderOpts: FAST });
    await waitForDownload();
    const html = await blobs[0]!.text();

    // 导出 CSS 注释里也出现 `<body>` / `<article class="md-preview">` 字样，
    // 必须从 </head> 之后开始找真实标签，否则断言会被注释误导。
    const headEnd = html.indexOf('</head>');
    const bodyAt = html.indexOf('<body', headEnd);
    const articleAt = html.indexOf('<article class="md-preview">', bodyAt);
    const bannerAt = html.indexOf('只读分享 · Read-only share');

    expect(headEnd).toBeGreaterThan(-1);
    expect(bodyAt).toBeGreaterThan(headEnd);
    expect(bannerAt).toBeGreaterThan(bodyAt);
    expect(bannerAt).toBeLessThan(articleAt);
    // 样式块没被横幅截断
    expect(html.indexOf('</style>')).toBeLessThan(headEnd);
  });

  it('E-X08 页脚默认改成「只读分享」，也尊重调用方传入的文案', async () => {
    downloadShareHtml('x', { title: 'a', renderOpts: FAST });
    await waitForDownload();
    expect(await blobs[0]!.text()).toContain('Markdown Studio · 只读分享');

    downloadShareHtml('x', {
      title: 'b',
      renderOpts: FAST,
      footer: { enabled: true, text: '团队内部' },
    });
    await waitForDownload(2);
    expect(await blobs[1]!.text()).toContain('团队内部');
  });
});

describe('printPdf', () => {
  it('E-X09 打开空白窗口写入完整文档，并在 load 后调用 print', async () => {
    const print = vi.fn();
    let onLoad: (() => void) | null = null;
    const fakeWin = {
      document: { write: vi.fn(), close: vi.fn() },
      addEventListener: vi.fn((ev: string, cb: () => void) => {
        if (ev === 'load') onLoad = cb;
      }),
      print,
    };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);

    printPdf('正文 $x^2$', { title: 'p', renderOpts: FAST });
    await vi.waitFor(() => expect(fakeWin.document.write).toHaveBeenCalled(), { timeout: 20_000 });

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    const html = fakeWin.document.write.mock.calls[0]![0] as string;
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('class="katex"');
    expect(fakeWin.document.close).toHaveBeenCalled();

    // 注册的是 load 回调：此时还没打印
    expect(print).not.toHaveBeenCalled();
    expect(onLoad).toBeTypeOf('function');
    onLoad!();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('E-X10 弹窗被浏览器拦截（open 返回 null）时不抛错', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    printPdf('x', { renderOpts: FAST });
    await new Promise((r) => setTimeout(r, 300));
    expect(clicked.length).toBe(0);
  });
});

describe('exportShareCard', () => {
  it('E-X11 生成 PNG 并下载 share-card.png，卡片节点不留在 DOM 里', async () => {
    await exportShareCard('选中的文字', '标题');
    await waitForDownload();

    expect(toPngMock).toHaveBeenCalledTimes(1);
    expect(clicked[0]!.name).toBe('share-card.png');
    expect(document.querySelector('div[style*="-9999px"]')).toBeNull();
  });

  it('E-X12 标题与正文都做 HTML 转义（不会被注入标签）', async () => {
    await exportShareCard('<img src=x onerror=alert(1)>', '<b>标题</b>');
    const node = toPngMock.mock.calls[0]![0] as HTMLElement;
    expect(node.innerHTML).not.toContain('<img');
    expect(node.innerHTML).not.toContain('<b>标题</b>');
    expect(node.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('exportViaPandoc', () => {
  it('E-X13 latex：直接下载 .tex，不复制命令', async () => {
    const r = await exportViaPandoc('# T\n\n**粗**', 'latex', 'note.md');
    await waitForDownload();

    expect(r.mode).toBe('download');
    expect(clicked[0]!.name).toBe('note.tex');
    expect(blobs[0]!.type).toBe('application/x-tex;charset=utf-8');
    expect(await blobs[0]!.text()).toContain('\\section{T}');
    expect(clipboardText.length).toBe(0);
  });

  it('E-X14 docx：下载源 .md + 复制 pandoc 命令', async () => {
    const r = await exportViaPandoc('# T', 'docx', 'note.md');
    await waitForDownload();

    expect(r.mode).toBe('command');
    expect(clicked[0]!.name).toBe('note.md');
    expect(blobs[0]!.type).toBe('text/markdown;charset=utf-8');
    expect(await blobs[0]!.text()).toBe('# T');
    expect(clipboardText[0]).toMatch(/^pandoc /);
    expect(clipboardText[0]).toContain('-t docx');
    expect(r.command).toBe(clipboardText[0]);
  });

  it('E-X15 剪贴板不可用时仍返回命令（供提示条展示）', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error('denied');
        }),
      },
    });
    const r = await exportViaPandoc('x', 'pdf', 'doc');
    await waitForDownload();
    expect(r.mode).toBe('command');
    expect(r.command).toContain('doc.pdf');
  });

  it('E-X16 标题没有扩展名时输出名不加点', async () => {
    await exportViaPandoc('x', 'epub', 'README');
    await waitForDownload();
    expect(clicked[0]!.name).toBe('README.md');
  });
});
