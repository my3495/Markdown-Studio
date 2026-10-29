/**
 * 导出全格式验收测试（Web / 浏览器动作层）。
 *
 * 与 exporter.test.ts 的分工：那边验证「单点行为」，这里验证**验收维度**：
 * - 产物能否被目标环境读取（HTML 用 DOMParser 真解析；LaTeX/Markdown 校验结构）
 * - 内容无损（Markdown 逐字节一致、HTML 文本可还原）
 * - 边界：空文档、大数据量、特殊字符、并发、异常文件名
 *
 * `it.fails` 标记的是已确认缺陷（期望正确行为，实际不满足），详见 docs/export-test-report.md。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toPngMock = vi.fn(
  async (_node: HTMLElement, _opts?: { pixelRatio?: number }) => 'data:image/png;base64,iVBORw0KGgo='
);
vi.mock('html-to-image', () => ({
  toPng: (node: HTMLElement, opts?: { pixelRatio?: number }) => toPngMock(node, opts),
}));

const { downloadHtml, downloadShareHtml, printPdf, exportShareCard, exportViaPandoc, docBase, sanitizeFileName } =
  await import('../exporter');

/** 关掉 Shiki，避免每次导出都等代码高亮 */
const FAST = { highlight: false };

interface Download {
  name: string;
  href: string;
  text: string;
  type: string;
  /** Blob 内容读取完成（空文档的 text 也是空串，不能用 text.length 判断就绪） */
  ready: Promise<void>;
}

let downloads: Download[] = [];
let pendingBlobs: Download[] = [];
let clipboardText: string[] = [];

beforeEach(() => {
  downloads = [];
  pendingBlobs = [];
  clipboardText = [];

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((blob: Blob) => {
      const record: Download = { name: '', href: 'blob:mock', text: '', type: blob.type, ready: Promise.resolve() };
      record.ready = blob.text().then((t) => {
        record.text = t;
      });
      pendingBlobs.push(record);
      return 'blob:mock';
    }),
    revokeObjectURL: vi.fn(),
  });

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    // PNG 卡片走 data URL（不经 createObjectURL），blob 记录可能为空
    const record: Download = pendingBlobs.shift() ?? {
      name: '',
      href: this.href,
      text: this.href,
      type: 'data-url',
      ready: Promise.resolve(),
    };
    record.name = this.download;
    record.href = this.href;
    downloads.push(record);
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
  pendingBlobs = [];
});

async function waitFor(count = 1) {
  await vi.waitFor(() => expect(downloads.length).toBe(count), { timeout: 30_000, interval: 20 });
  // 等 Blob 内容读完：空文档的 text 也是空串，不能拿 text.length 判断就绪
  await Promise.all(downloads.map((d) => d.ready));
}

describe('HTML(.html)：目标环境（浏览器）可打开且内容无损', () => {
  it('B-H01 产物可被 DOMParser 解析为完整文档，正文文本逐字符一致', async () => {
    const md = [
      '# 标题 & <标签>',
      '',
      '正文包含 **粗体**、`code & <tag>`、emoji 👨‍👩‍👧‍👦、RTL مرحبا、组合字符 é。',
      '',
      '| 列 A | 列 B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```js',
      'const a = 1 < 2 && "x";',
      '```',
    ].join('\n');

    downloadHtml(md, { title: '特殊字符.md', renderOpts: FAST });
    await waitFor();

    expect(downloads[0]!.name).toBe('特殊字符.html');
    expect(downloads[0]!.type).toBe('text/html;charset=utf-8');

    const doc = new DOMParser().parseFromString(downloads[0]!.text, 'text/html');
    expect(doc.doctype?.name).toBe('html');
    expect(doc.querySelectorAll('script').length).toBe(0);

    const article = doc.querySelector('article.md-preview');
    expect(article).not.toBeNull();
    const text = article!.textContent ?? '';
    expect(text).toContain('标题 & <标签>');
    expect(text).toContain('emoji 👨‍👩‍👧‍👦');
    expect(text).toContain('مرحبا');
    // 表格/代码块结构存在（不是被拍平成纯文本）
    expect(article!.querySelectorAll('table').length).toBe(1);
    expect(article!.querySelectorAll('pre code').length).toBe(1);
    expect(doc.querySelector('footer.md-footer')).not.toBeNull();
  });

  it('B-H02 空文档导出仍是可解析的完整页面（article 为空、页脚在）', async () => {
    downloadHtml('', { title: '空文档.md', renderOpts: FAST });
    await waitFor();

    const doc = new DOMParser().parseFromString(downloads[0]!.text, 'text/html');
    expect(doc.querySelector('article.md-preview')).not.toBeNull();
    expect((doc.querySelector('article.md-preview')!.textContent ?? '').trim()).toBe('');
    expect(doc.querySelector('footer.md-footer')).not.toBeNull();
    // <title> 用去扩展名的基名（`空文档.md` → `空文档`）
    expect(doc.title).toBe('空文档');
  });

  it('B-H03 大数据量（2000 段）下载完整：首尾段落都在，体积与耗时可控', async () => {
    const N = 2000;
    const md = Array.from({ length: N }, (_, i) => `段落 ${i + 1}：BULK-${i + 1}`).join('\n\n');
    const started = Date.now();

    downloadHtml(md, { title: 'bulk.md', renderOpts: FAST });
    await waitFor();
    const elapsed = Date.now() - started;

    const text = downloads[0]!.text;
    expect(text).toContain('BULK-1');
    expect(text).toContain(`BULK-${N}`);
    expect(text.trimEnd().endsWith('</html>')).toBe(true);
    expect(text.length).toBeGreaterThan(80_000);
    expect(elapsed).toBeLessThan(60_000);
  }, 120_000);

  it('B-H04 并发导出 10 份不同文档：文件名与内容一一对应，不串扰', async () => {
    const COUNT = 10;
    for (let i = 0; i < COUNT; i += 1) {
      downloadHtml(`# 并发 ${i}\n\n标记 PARA-${i}`, { title: `doc-${i}.md`, renderOpts: FAST });
    }
    await waitFor(COUNT);

    for (let i = 0; i < COUNT; i += 1) {
      const hit = downloads.filter((d) => d.name === `doc-${i}.html`);
      expect(hit.length).toBe(1);
      expect(hit[0]!.text).toContain(`PARA-${i}`);
      expect(hit[0]!.text).not.toContain(`PARA-${(i + 1) % COUNT}`);
    }
  }, 120_000);

  it('B-H05 只读分享版同一份内容可解析，横幅在 body 内、正文完整', async () => {
    downloadShareHtml('# 分享正文\n\nSHARE-BODY', { title: 'n.md', renderOpts: FAST });
    await waitFor();

    const doc = new DOMParser().parseFromString(downloads[0]!.text, 'text/html');
    expect(doc.body.textContent).toContain('只读分享');
    expect(doc.body.textContent).toContain('SHARE-BODY');
    expect(downloads[0]!.name).toBe('n-share.html');
  });
});

describe('文件名与 MIME：可落盘、可被系统识别', () => {
  it('B-F01 中文/空格/emoji 标题保留，非 ASCII 不会被 URL 编码成 %xx', async () => {
    downloadHtml('x', { title: '我的 笔记 🚀.md', renderOpts: FAST });
    await waitFor();
    expect(downloads[0]!.name).toBe('我的 笔记 🚀.html');
    expect(downloads[0]!.name).not.toContain('%');
  });

  it('B-F02 无标题回退 export.html；.md/.markdown/.txt 均被剥离', async () => {
    downloadHtml('x', { renderOpts: FAST });
    downloadHtml('x', { title: 'a.markdown', renderOpts: FAST });
    downloadHtml('x', { title: 'b.txt', renderOpts: FAST });
    await waitFor(3);

    expect(downloads.map((d) => d.name)).toEqual(['export.html', 'a.html', 'b.html']);
  });

  it('B-F03 标题中的 Windows 非法字符被替换，文件名可落盘', async () => {
    downloadHtml('x', { title: 'a/b:c*?.md', renderOpts: FAST });
    await waitFor();
    expect(downloads[0]!.name).toBe('a_b_c__.html');
    expect(downloads[0]!.name).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('B-F04 含点号的标题不再被当成扩展名剥离（v1.2 说明 保持完整）', async () => {
    await exportViaPandoc('x', 'docx', 'v1.2 说明');
    await waitFor();
    expect(downloads[0]!.name).toBe('v1.2 说明.md');
    expect(clipboardText[0]).toContain('"v1.2 说明.md"');
  });

  it('B-F05 超长文件名按字节截断到 200B，结尾点/空格被去掉', async () => {
    const long = '长'.repeat(120); // 360 字节
    downloadHtml('x', { title: `${long}.md`, renderOpts: FAST });
    downloadHtml('x', { title: '结尾有点...', renderOpts: FAST });
    await waitFor(2);

    const truncated = downloads[0]!.name.replace(/\.html$/, '');
    expect(new TextEncoder().encode(truncated).length).toBeLessThanOrEqual(200);
    expect(downloads[0]!.name.endsWith('.html')).toBe(true);
    expect(downloads[1]!.name).toBe('结尾有点.html');
  });

  it('B-F06 docBase 只剥已知扩展名，其余点号原样保留', () => {
    expect(docBase('note.md')).toBe('note');
    expect(docBase('a.markdown')).toBe('a');
    expect(docBase('b.txt')).toBe('b');
    expect(docBase('v1.2')).toBe('v1.2');
    expect(docBase('报告 v2.0 说明')).toBe('报告 v2.0 说明');
    expect(docBase('')).toBe('export');
    expect(docBase('   ')).toBe('export');
    expect(docBase(undefined, 'share')).toBe('share');
  });

  it('B-F07 sanitizeFileName 去掉结尾点/空格并保留普通名称', () => {
    expect(sanitizeFileName('note')).toBe('note');
    expect(sanitizeFileName('my note ')).toBe('my note');
    expect(sanitizeFileName('trailing...')).toBe('trailing');
    expect(sanitizeFileName('a\\b|c')).toBe('a_b_c');
    expect(sanitizeFileName('')).toBe('export');
  });
});

describe('Markdown(.md)：逐字节无损（交给 Pandoc 的输入）', () => {
  it('B-M01 正文逐字节一致：CRLF、末尾无换行、超长行、emoji 都原样', async () => {
    const md = '# T\r\n\r\nline with CRLF\r\n\r\n' + '长'.repeat(5000) + '\r\n没有尾换行 🚀';
    const r = await exportViaPandoc(md, 'docx', 'note.md');
    await waitFor();

    expect(r.mode).toBe('command');
    expect(downloads[0]!.name).toBe('note.md');
    expect(downloads[0]!.type).toBe('text/markdown;charset=utf-8');
    expect(downloads[0]!.text).toBe(md);
  });

  it('B-M02 docx/epub/pdf 三种格式：下载同一份 .md，命令输出扩展名正确', async () => {
    const md = '# 内容\n\nCONV';
    const results = await Promise.all(
      (['docx', 'epub', 'pdf'] as const).map((fmt) => exportViaPandoc(md, fmt, `t-${fmt}`))
    );
    await waitFor(3);

    results.forEach((r, i) => {
      const fmt = (['docx', 'epub', 'pdf'] as const)[i]!;
      expect(r.mode).toBe('command');
      expect(r.command).toContain(`t-${fmt}.${fmt}`);
      expect(downloads[i]!.name).toBe(`t-${fmt}.md`);
      expect(downloads[i]!.text).toBe(md);
    });
    expect(clipboardText.length).toBe(3);
  });

  it('B-M03 空文档也能产出 .md 与命令（不会生成 null/undefined 文件名）', async () => {
    const r = await exportViaPandoc('', 'docx', '');
    await waitFor();
    expect(downloads[0]!.name).toBe('export.md');
    expect(downloads[0]!.text).toBe('');
    expect(r.command).toContain('export.docx');
  });
});

describe('LaTeX(.tex)：结构可交付', () => {
  it('B-T01 下载 .tex、MIME 正确、文档壳与环境配对', async () => {
    await exportViaPandoc('# 标题\n\n正文 **粗**\n\n- a\n- b', 'latex', 'note.md');
    await waitFor();

    expect(downloads[0]!.name).toBe('note.tex');
    expect(downloads[0]!.type).toBe('application/x-tex;charset=utf-8');
    const tex = downloads[0]!.text;
    expect(tex).toContain('\\documentclass');
    expect(tex).toContain('\\begin{document}');
    expect(tex.trimEnd().endsWith('\\end{document}')).toBe(true);
    expect(tex.split('\\begin{itemize}').length).toBe(tex.split('\\end{itemize}').length);
  });

  it('B-T02 空文档：仍是可编译的最小文档，不夹带空内容', async () => {
    await exportViaPandoc('', 'latex', 'empty.md');
    await waitFor();
    const tex = downloads[0]!.text;
    expect(tex).toContain('\\begin{document}');
    expect(tex).toContain('\\end{document}');
    expect(tex).not.toContain('undefined');
  });
});

describe('PNG 分享卡片 / PDF 打印：产物形状正确', () => {
  it('B-P01 卡片 PNG：pixelRatio=2、dataURL 交给下载、节点不留在 DOM', async () => {
    await exportShareCard('正文 👨‍👩‍👧‍👦 & <b>x</b>', '标题 <img>');
    await waitFor();

    expect(toPngMock).toHaveBeenCalledTimes(1);
    expect(toPngMock.mock.calls[0]![1]?.pixelRatio).toBe(2);
    expect(downloads[0]!.name).toBe('share-card.png');
    expect(downloads[0]!.href.startsWith('data:image/png')).toBe(true);
    expect(document.body.textContent).not.toContain('由 Markdown Studio 生成');
  });

  it('B-P02 连续两次导出卡片不互相污染（DOM 与调用次数）', async () => {
    await exportShareCard('第一次 CARD-1', 'T1');
    await exportShareCard('第二次 CARD-2', 'T2');
    await waitFor(2);

    expect(toPngMock).toHaveBeenCalledTimes(2);
    const nodes = toPngMock.mock.calls.map((c) => (c as unknown as [HTMLElement])[0].textContent ?? '');
    expect(nodes[0]).toContain('CARD-1');
    expect(nodes[0]).not.toContain('CARD-2');
    expect(nodes[1]).toContain('CARD-2');
    expect(document.body.querySelectorAll('div[style*="-9999px"]').length).toBe(0);
  });

  it('B-P03 PDF：打印窗口写入完整文档（含题名与页脚），load 后仅打印一次', async () => {
    const print = vi.fn();
    let onLoad: (() => void) | null = null;
    const fakeWin = {
      document: { write: vi.fn(), close: vi.fn() },
      addEventListener: vi.fn((ev: string, cb: () => void) => {
        if (ev === 'load') onLoad = cb;
      }),
      print,
    };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);

    printPdf('# PDF 稿件\n\n正文', { title: '稿件 A.md', mode: 'dark', renderOpts: FAST });
    await vi.waitFor(() => expect(fakeWin.document.write).toHaveBeenCalled(), { timeout: 30_000 });

    const html = fakeWin.document.write.mock.calls[0]![0] as string;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.title).toBe('稿件 A');
    expect(doc.querySelector('article.md-preview')?.textContent).toContain('PDF 稿件');
    expect(doc.querySelector('footer.md-footer')).not.toBeNull();
    // 深色模式变量进入打印文档（PDF 背景/前景一致）
    expect(html).toContain('--md-color-bg: #1a1815;');

    onLoad!();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('B-P04 PDF：弹窗被拦截时不抛错、不产生下载，并返回可提示的原因', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const r = await printPdf('x', { renderOpts: FAST });
    expect(downloads.length).toBe(0);
    expect(r).toEqual({ ok: false, reason: 'popup-blocked' });
  });

  it('B-P05 卡片生成失败返回 false 且清理 DOM（调用方据此 toast）', async () => {
    toPngMock.mockRejectedValueOnce(new Error('tainted canvas'));

    const ok = await exportShareCard('正文', '标题');
    expect(ok).toBe(false);
    expect(document.body.querySelectorAll('div[style*="-9999px"]').length).toBe(0);
    // 失败时不应该触发下载
    expect(downloads.length).toBe(0);
  });
});
