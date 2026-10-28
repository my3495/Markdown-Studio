import { LanguageDescription } from '@codemirror/language';

/**
 * 围栏代码块的嵌套语言（修复 B1）：lezer-markdown 只有在拿到 codeLanguages 时
 * 才会为 ```lang 块挂载子语言，否则块内一律按纯文本渲染、无任何着色。
 *
 * 用 load() 懒加载：语言包不会进入首屏包体，只有文档里真的出现对应 fence 时才拉取。
 * 未收录的语言（bash / yaml / go 等）安全降级为纯文本，与预览区未知语言的行为一致。
 */
export const codeLanguages = [
  LanguageDescription.of({
    name: 'javascript',
    alias: ['js', 'jsx', 'mjs', 'cjs'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  }),
  LanguageDescription.of({
    name: 'typescript',
    alias: ['ts', 'tsx'],
    // 注意：这里刻意写成 async 块而不是 `load: () =>\n  import(...)`。
    // 换行后行首的 `import(` 会被 rollup 解析成静态 import 声明，报
    // "Expected ident" 导致构建失败（单行写法虽可绕过，但可读性差）。
    load: async () => {
      const m = await import('@codemirror/lang-javascript');
      return m.javascript({ typescript: true });
    },
  }),
  LanguageDescription.of({
    name: 'python',
    alias: ['py'],
    load: () => import('@codemirror/lang-python').then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: 'json',
    load: () => import('@codemirror/lang-json').then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: 'html',
    alias: ['htm'],
    load: () => import('@codemirror/lang-html').then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: 'css',
    load: () => import('@codemirror/lang-css').then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: 'rust',
    alias: ['rs'],
    load: () => import('@codemirror/lang-rust').then((m) => m.rust()),
  }),
  LanguageDescription.of({
    name: 'sql',
    load: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  }),
  LanguageDescription.of({
    name: 'cpp',
    alias: ['c', 'cc', 'cxx', 'h', 'hpp'],
    load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  }),
  LanguageDescription.of({
    name: 'java',
    load: () => import('@codemirror/lang-java').then((m) => m.java()),
  }),
  LanguageDescription.of({
    name: 'xml',
    load: () => import('@codemirror/lang-xml').then((m) => m.xml()),
  }),
];
