/**
 * 让测试里的 `import ... from 'react'` 与 `react-dom` 内部 `require('react')`
 * 指向**同一份实例**（配置见 vitest.config.ts 的 alias 注释）。
 *
 * 背景：pnpm 下 `apps/web/node_modules/react` 是指向仓库根 `.pnpm/` 的 junction，
 * 真实路径在 Vite root 之外，Vite 把它当 linked 源码内联求值；react-dom 是 CJS、
 * 由 Node require。两条加载路径各执行一遍 react.development.js → 两份
 * ReactSharedInternals：react-dom 把 dispatcher 写进自己那份，组件里的 useState
 * 来自 Vite 那份（dispatcher 为 null）→ Invalid hook call。
 *
 * 这里用 Node require 取唯一实例并显式再导出：ESM 的具名导出必须是静态的，
 * 所以只能逐个列（列出的都是本项目实际用到的 + React 18 常用 API）。
 * 新增 `import { xxx } from 'react'` 而此处缺失时，测试会以
 * "xxx is not a function" 立刻暴露，不会静默错位。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

 
const React: any = require('react');

export default React;

export const {
  Children,
  Component,
  Fragment,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = React;
