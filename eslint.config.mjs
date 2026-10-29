// @ts-check
/**
 * ESLint 9/10 flat config。
 *
 * 取舍说明：
 * - 只用 typescript-eslint 的 **recommended（非类型感知）**：类型感知规则需要
 *   `parserOptions.projectService`，在本仓 139 个源文件上代价过高，且 `tsc --noEmit`
 *   已经覆盖了绝大部分类型错误，lint 只负责类型系统管不到的坏味道与真 bug。
 * - 关掉 `no-undef`：TS 编译器负责未定义标识符，重复检查只会误报全局类型。
 * - `no-explicit-any` 关闭：渲染管线里 `any` 是刻意选择（unified 的 remark/rehype
 *   联合签名无法被 TS 解析，见 pipeline.ts 注释），强上该规则只产出噪音。
 * - react-hooks 只作用于 web 包：漏依赖 / 条件调用 hook 是真正会导致运行时错乱的缺陷。
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      // 构建产物：dist / dist.bak / dist-old 等都排除（曾因漏掉 dist.bak 一次刷出 5 万条报错）
      '**/dist/**',
      '**/dist.*/**',
      '**/target/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.tmp-e2e/**',
      '.test-deps/**',
      '.trae/**',
      '.workbuddy/**',
      'desktop-test/**',
      'release/**',
      // 生成文件：唯一真相源是 tauri.conf.json + sync-version.mjs
      '**/version.generated.ts',
      // 本轮只覆盖 TS/TSX 源码；构建脚本（.mjs）需要 node globals 声明，另行开启
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.jsx',
      '**/scripts/**',
      '**/*.config.{js,mjs,ts}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // TS 已保证标识符存在；开着重叠检查会在 .d.ts / 全局类型上误报
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      // 正则里用 \u0000-\u001f 做控制字符清洗是有意为之（导出文件名/LaTeX 占位符）
      'no-control-regex': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/desktop/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**', '**/e2e/**', '**/tests/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  }
);
