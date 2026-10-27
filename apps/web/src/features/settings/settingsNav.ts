import type { IconName } from '../../components/Icon';

/** 设置分组 id（左侧目录项与内容区一一对应） */
export type SettingsSectionId =
  | 'typography'
  | 'theme'
  | 'editor'
  | 'language'
  | 'agent'
  | 'mcp'
  | 'recipes'
  | 'share'
  | 'about';

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  icon: IconName;
  /** 左侧目录文字 */
  labelKey: string;
  /** 右侧内容区标题 */
  titleKey: string;
  /** 右侧内容区副标题 */
  descKey: string;
}

/** 左侧目录分组（视觉分组，纯粹为了可扫描性） */
export interface SettingsNavGroup {
  labelKey: string;
  items: SettingsSectionMeta[];
}

export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  {
    id: 'typography',
    icon: 'typography',
    labelKey: 'settingsNavTypography',
    titleKey: 'typography',
    descKey: 'settingsNavTypographyDesc',
  },
  {
    id: 'theme',
    icon: 'theme',
    labelKey: 'settingsNavTheme',
    titleKey: 'settingsNavTheme',
    descKey: 'settingsNavThemeDesc',
  },
  {
    id: 'editor',
    icon: 'fileText',
    labelKey: 'settingsNavEditor',
    titleKey: 'settingsNavEditor',
    descKey: 'settingsNavEditorDesc',
  },
  {
    id: 'language',
    icon: 'globe',
    labelKey: 'settingsNavLanguage',
    titleKey: 'settingsNavLanguage',
    descKey: 'settingsNavLanguageDesc',
  },
  {
    id: 'agent',
    icon: 'agent',
    labelKey: 'settingsNavAgent',
    titleKey: 'settingsNavAgent',
    descKey: 'settingsNavAgentDesc',
  },
  {
    id: 'mcp',
    icon: 'wrench',
    labelKey: 'settingsNavMcp',
    titleKey: 'settingsNavMcp',
    descKey: 'settingsNavMcpDesc',
  },
  {
    id: 'recipes',
    icon: 'infinity',
    labelKey: 'settingsNavRecipes',
    titleKey: 'settingsNavRecipes',
    descKey: 'settingsNavRecipesDesc',
  },
  {
    id: 'share',
    icon: 'shareCard',
    labelKey: 'settingsNavShare',
    titleKey: 'settingsNavShare',
    descKey: 'settingsNavShareDesc',
  },
  {
    id: 'about',
    icon: 'info',
    labelKey: 'settingsNavAbout',
    titleKey: 'settingsNavAbout',
    descKey: 'settingsNavAboutDesc',
  },
];

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  { labelKey: 'settingsNavGroupGeneral', items: SETTINGS_SECTIONS.slice(0, 4) },
  { labelKey: 'settingsNavGroupAi', items: SETTINGS_SECTIONS.slice(4, 7) },
  { labelKey: 'settingsNavGroupOutput', items: SETTINGS_SECTIONS.slice(7, 8) },
  { labelKey: 'settingsNavGroupApp', items: SETTINGS_SECTIONS.slice(8) },
];

export const SETTINGS_SECTION_MAP: Record<SettingsSectionId, SettingsSectionMeta> =
  Object.fromEntries(SETTINGS_SECTIONS.map((s) => [s.id, s])) as Record<
    SettingsSectionId,
    SettingsSectionMeta
  >;
