import type { EditorView } from '@codemirror/view';
import type { TocItem } from '@md-studio/core';
import { useUi, type SideTab } from '../../stores/ui';
import { useSettings } from '../../stores/settings';
import { Outline } from '../outline/Outline';
import { PropertyInspector } from '../frontmatter/PropertyInspector';
import { VaultFiles } from '../vault/VaultFiles';
import { Icon, type IconName } from '../../components/Icon';
import { t } from '../../i18n';

interface Props {
  toc: TocItem[];
  editorView: EditorView | null;
  previewEl: HTMLElement | null;
}

const TABS: { id: SideTab; icon: IconName; labelKey: string }[] = [
  { id: 'files', icon: 'open', labelKey: 'sideFiles' },
  { id: 'outline', icon: 'outline', labelKey: 'sideOutline' },
  { id: 'props', icon: 'props', labelKey: 'sideProps' },
];

/** 左侧 Activity：文件 / 大纲 / 属性 互斥（图谱已升格为主区面板） */
export function SideRail({ toc, editorView, previewEl }: Props) {
  const sideTab = useUi((s) => s.sideTab);
  const setSideTab = useUi((s) => s.setSideTab);
  const locale = useSettings((s) => s.locale);
  // 兼容旧持久化状态：'graph' 已不在侧栏，回落到文件
  const activeTab: SideTab = sideTab === 'graph' ? 'files' : sideTab;

  return (
    <div className="app-side">
      <div className="side-tabs" role="tablist" aria-label={t(locale, 'vault')}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`side-tab ${activeTab === tab.id ? 'active' : ''}`}
            title={t(locale, tab.labelKey)}
            onClick={() => setSideTab(tab.id)}
          >
            <Icon name={tab.icon} size={16} />
            <span className="side-tab-label">{t(locale, tab.labelKey)}</span>
          </button>
        ))}
      </div>

      <div className="side-tab-body" role="tabpanel">
        {activeTab === 'files' && <VaultFiles />}
        {activeTab === 'outline' && (
          <Outline toc={toc} editorView={editorView} previewEl={previewEl} locale={locale} />
        )}
        {activeTab === 'props' && <PropertyInspector />}
      </div>
    </div>
  );
}
