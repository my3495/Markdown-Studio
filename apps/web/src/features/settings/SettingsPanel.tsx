import { useSettings } from '../../stores/settings';
import { useState } from 'react';
import { t } from '../../i18n';
import { Icon } from '../../components/Icon';
import { McpDesktopSection } from './McpDesktopSection';
import { AboutUpdateSection } from './AboutUpdateSection';
import {
  SETTINGS_NAV_GROUPS,
  SETTINGS_SECTION_MAP,
  type SettingsSectionId,
} from './settingsNav';
import {
  AgentSection,
  EditorSection,
  LanguageSection,
  RecipesSection,
  ShareSection,
  ThemeSection,
  TypographySection,
} from './SettingsSections';

/**
 * 设置面板：左侧目录 + 右侧内容。
 *
 * 左侧目录按「通用 / AI 与自动化 / 输出」三组罗列，右侧一次只渲染一个分区，
 * 避免 8 个分区同时挂载，也避免长页面滚动时找不到目标设置。
 */
export function SettingsPanel() {
  const s = useSettings();
  const locale = s.locale;
  const [activeId, setActiveId] = useState<SettingsSectionId>('typography');
  const meta = SETTINGS_SECTION_MAP[activeId];

  return (
    <div className="panel-pane settings-pane">
      {/* ── 左侧目录 ── */}
      <nav className="settings-nav" aria-label={t(locale, 'settings')}>
        {SETTINGS_NAV_GROUPS.map((group) => (
          <div key={group.labelKey} className="settings-nav-group">
            <div className="settings-nav-group-label">{t(locale, group.labelKey)}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings-nav-item ${activeId === item.id ? 'active' : ''}`}
                aria-current={activeId === item.id ? 'page' : undefined}
                onClick={() => setActiveId(item.id)}
              >
                <Icon name={item.icon} size={15} />
                <span>{t(locale, item.labelKey)}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* ── 右侧内容 ── */}
      <div className="settings-content">
        <header className="settings-content-head">
          <h3 className="settings-content-title">
            <Icon name={meta.icon} size={16} />
            {t(locale, meta.titleKey)}
          </h3>
          <p className="settings-content-desc">{t(locale, meta.descKey)}</p>
        </header>

        <div className="settings-content-body">
          {activeId === 'typography' && <TypographySection />}
          {activeId === 'theme' && <ThemeSection />}
          {activeId === 'editor' && <EditorSection />}
          {activeId === 'language' && <LanguageSection />}
          {activeId === 'agent' && <AgentSection />}
          {activeId === 'mcp' && <McpDesktopSection showTitle={false} />}
          {activeId === 'recipes' && <RecipesSection />}
          {activeId === 'share' && <ShareSection />}
          {activeId === 'about' && <AboutUpdateSection />}
        </div>
      </div>
    </div>
  );
}
