export type DiffOp = { type: 'eq' | 'add' | 'del'; text: string };

/**
 * LCS 动态规划表的单元格上限（约 16MB number）。
 * 表是 (n+1)×(m+1) 的稠密二维数组：5000 行对 5000 行就是 2500 万个格子（约 200MB），
 * 在浏览器里足以触发 OOM 或长时间冻结主线程。超过阈值时退化为线性比对（修复 E2）。
 */
const MAX_DP_CELLS = 2_000_000;

/**
 * 大文档降级策略：剥离公共前后缀，中间整段视为「删除 + 新增」。
 * 精度不如 LCS（中间区域未改动的行也会被标成增删），但复杂度 O(n+m)、
 * 内存 O(1)，保证超大文件仍能毫秒级出结果而不是崩掉。
 */
function prefixSuffixDiff(a: string[], b: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  let start = 0;
  const minLen = Math.min(a.length, b.length);
  while (start < minLen && a[start] === b[start]) {
    ops.push({ type: 'eq', text: a[start] });
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  for (let i = start; i < endA; i++) ops.push({ type: 'del', text: a[i] });
  for (let j = start; j < endB; j++) ops.push({ type: 'add', text: b[j] });
  for (let i = endA; i < a.length; i++) ops.push({ type: 'eq', text: a[i] });
  return ops;
}

/** 简易逐行 diff（LCS），用于版本对比视图 */
export function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > MAX_DP_CELLS) return prefixSuffixDiff(a, b);
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'eq', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i] });
      i++;
    } else {
      ops.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'del', text: a[i++] });
  while (j < m) ops.push({ type: 'add', text: b[j++] });
  return ops;
}
