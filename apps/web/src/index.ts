export { App } from './App';
export { useSettings, getRenderOptions } from './stores/settings';
export { useDocuments } from './stores/document';
export {
  setVaultBackend,
  setDefaultVaultBackend,
  currentVaultStore,
  vaultPickerAvailable,
  type VaultBackend,
} from './platform/vault/registry';
export {
  setFsBackend,
  getFsBackend,
  type FsBackend,
  type OpenedFile,
} from './platform/fs/registry';
export {
  setFileDropSource,
  getFileDropSource,
  type FileDropSource,
  type DropEvent,
} from './platform/fs/drop';
export {
  setUpdateBackend,
  getUpdateBackend,
  type UpdateBackend,
  type UpdateInfo,
} from './platform/update/registry';
