import { VaultFiles } from './VaultFiles';
import { VaultGraph } from './VaultGraph';

/** @deprecated 侧栏已拆为 Tab；保留组合导出以免外部引用断裂 */
export function VaultPanel() {
  return (
    <>
      <VaultFiles />
      <VaultGraph />
    </>
  );
}
