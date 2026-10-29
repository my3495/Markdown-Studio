/**
 * 设置面板各分区的内容组件。
 *
 * 每个分区独立成组件，由 SettingsPanel 的左侧目录切换显示（一次只渲染一个分区），
 * 避免 8 个分区同时挂载导致的冗余渲染，也让右侧内容区始终保持聚焦。
 *
 * 依赖（网络/平台/重型）由 SettingsPanel 之外的调用方负责 mock。
 */
import { useEffect, useMemo, useState } from 'react';
import { useSettings } from '../../stores/settings';
import { useRecipes } from '../../stores/recipes';
import { useOllama } from '../../stores/ollama';
import { useModels } from '../../stores/models';
import { useDocuments } from '../../stores/document';
import { toast } from '../../stores/toast';
import { LOCALES, t, type Locale } from '../../i18n';
import {
  CUSTOM_THEME_TOKENS,
  FONT_FAMILY_PRESETS,
  FONT_FAMILY_TOKEN,
  getThemeVariables,
  type TypographyOptions,
} from '@md-studio/core';
import { resolveTheme } from '../../platform/theme';
import { runMatchedRecipes } from '../../platform/recipes/runner';
import { localizeRecipeName } from '../agent/agentChatUtils';
import {
  clearAffText,
  importAffText,
  importWordListText,
  loadedAffRuleCount,
  loadPersonalDict,
} from '../../platform/spell/personalDict';

/* ───────────────────────── 中文排版 ───────────────────────── */

const TYPO_KEYS: (keyof TypographyOptions)[] = [
  'spacing',
  'numberSpacing',
  'punctuation',
  'ellipsis',
  'quotes',
];

/** 字段名 → i18n key（此前直接把字段名当标签，中文界面会出现英文变量名） */
const TYPO_LABEL: Partial<Record<keyof TypographyOptions, string>> = {
  spacing: 'typoSpacing',
  numberSpacing: 'typoNumberSpacing',
  punctuation: 'typoPunctuation',
  ellipsis: 'typoEllipsis',
  quotes: 'typoQuotes',
};

export function TypographySection() {
  const s = useSettings();
  const locale = s.locale;
  return (
    <div className="settings-card">
      {TYPO_KEYS.map((k) => (
        <label key={k} className="ui-check">
          <input
            type="checkbox"
            checked={!!s.typography[k]}
            onChange={(e) => s.setTypography(k, e.target.checked)}
          />
          <span>{t(locale, TYPO_LABEL[k] ?? k)}</span>
        </label>
      ))}
    </div>
  );
}

/* ───────────────────────── 主题 / 令牌 ───────────────────────── */

/** 「自定义字体」在下拉里用哨兵值表示，避免和空值（跟随主题）混淆 */
const FONT_CUSTOM = '__custom__';

/**
 * 字体选择器。
 *
 * 早期实现是受控 input + datalist：datalist 是「输入联想」而非下拉选择器，
 * 一旦输入框里已是某个候选，浏览器会把列表过滤成只剩这一项 ——
 * 于是「选过一次字体后就再也选不了别的」。这里改成真正的 select：
 * 预设 + 自定义，选自定义时才显示文本输入框。
 */
function FontFamilyField({
  value,
  locale,
  onChange,
}: {
  value: string;
  locale: Locale;
  onChange: (v: string) => void;
}) {
  const isCustomValue = value !== '' && !FONT_FAMILY_PRESETS.includes(value);
  const [customMode, setCustomMode] = useState(isCustomValue);
  const showCustomInput = customMode || isCustomValue;

  // 外部把字体改回某个预设（含「重置主题令牌」）时，自动退出自定义模式，
  // 否则会留着一个空输入框和「自定义…」的选中态
  useEffect(() => {
    if (value !== '' && FONT_FAMILY_PRESETS.includes(value)) setCustomMode(false);
  }, [value]);

  return (
    <div className="ui-field ui-field-font">
      <span>{t(locale, 'themeTokenFontFamily')}</span>
      <select
        className="ui-select ui-select-font"
        value={showCustomInput ? FONT_CUSTOM : value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === FONT_CUSTOM) {
            setCustomMode(true);
            onChange('');
            return;
          }
          setCustomMode(false);
          onChange(next);
        }}
        title={value || t(locale, 'themeFontDefault')}
      >
        <option value="">{t(locale, 'themeFontDefault')}</option>
        {FONT_FAMILY_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {preset}
          </option>
        ))}
        <option value={FONT_CUSTOM}>{t(locale, 'themeFontCustom')}</option>
      </select>
      {showCustomInput && (
        <input
          className="ui-input ui-input-font ui-input-font-custom"
          type="text"
          placeholder="PingFang SC, 'Microsoft YaHei', sans-serif"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            // 点了「自定义…」却什么都没填：失焦即回到预设，不留空壳
            if (!value.trim()) setCustomMode(false);
          }}
        />
      )}
    </div>
  );
}

/** 合法的十六进制颜色；非法值（含空）一律回退到主题默认色 */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function ThemeSection() {
  const s = useSettings();
  const locale = s.locale;
  /**
   * 未自定义时展示当前主题的真实令牌值，避免色块停留在浏览器默认蓝色。
   * 令牌表是纯数据，随主题解析结果缓存即可（每次渲染重算没有意义）。
   */
  const resolved = resolveTheme(s.theme);
  const themeTokens = useMemo(() => getThemeVariables(resolved), [resolved]);

  return (
    <div className="settings-card">
      {CUSTOM_THEME_TOKENS.map((tok) => {
        if (tok.key === FONT_FAMILY_TOKEN) {
          return (
            <FontFamilyField
              key={tok.key}
              value={s.customVars[tok.key] ?? ''}
              locale={locale}
              onChange={(v) => s.setCustomVar(tok.key, v)}
            />
          );
        }
        const label = t(locale, tok.labelKey);
        return (
          <div key={tok.key} className="ui-field">
            <span>{label}</span>
            {tok.kind === 'color' ? (
              <input
                className="ui-input"
                type="color"
                value={
                  HEX_COLOR_RE.test(s.customVars[tok.key] ?? '')
                    ? s.customVars[tok.key]!
                    : themeTokens[tok.key] ?? '#b4542f'
                }
                onChange={(e) => s.setCustomVar(tok.key, e.target.value)}
                /* 悬浮/读屏都给出可读名称，而不是 --md-color-* 内部变量名 */
                title={label}
                aria-label={label}
              />
            ) : (
              <input
                className="ui-input"
                type="text"
                placeholder={tok.placeholder}
                value={s.customVars[tok.key] ?? ''}
                onChange={(e) => s.setCustomVar(tok.key, e.target.value)}
                aria-label={label}
              />
            )}
          </div>
        );
      })}
      <button type="button" className="ui-btn" onClick={() => s.clearCustomVars()}>
        {t(locale, 'resetTheme')}
      </button>
    </div>
  );
}

/* ───────────────────────── 编辑器（快照 / Vim / 拼写） ───────────────────────── */

export function EditorSection() {
  const s = useSettings();
  const locale = s.locale;
  const [affRuleCount, setAffRuleCount] = useState(loadedAffRuleCount());

  return (
    <div className="settings-card">
      <label className="ui-check">
        <input
          type="checkbox"
          checked={s.autoSnapshot}
          onChange={(e) => s.setAutoSnapshot(e.target.checked)}
        />
        <span>{t(locale, 'autoSnapshot')}</span>
      </label>
      <label className="ui-check">
        <input
          type="checkbox"
          checked={s.vimMode}
          onChange={(e) => s.setVimMode(e.target.checked)}
        />
        <span>{t(locale, 'vimMode')}</span>
      </label>
      <label className="ui-check">
        <input
          type="checkbox"
          checked={s.spellCheck}
          onChange={(e) => s.setSpellCheck(e.target.checked)}
        />
        <span>{t(locale, 'spellCheck')}</span>
      </label>
      <label className="ui-check">
        <input
          type="checkbox"
          checked={s.codeHighlight}
          onChange={(e) => s.setCodeHighlight(e.target.checked)}
        />
        <span>{t(locale, 'codeHighlight')}</span>
      </label>
      <p className="vault-empty" style={{ margin: '8px 0' }}>
        {t(locale, 'spellDictHint')} ({loadPersonalDict().length})
      </p>
      <label className="ui-btn" style={{ cursor: 'pointer', display: 'inline-block' }}>
        {t(locale, 'spellImport')}
        <input
          type="file"
          accept=".txt,.dic,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void f.text().then((text) => {
              const n = importWordListText(text);
              toast(t(locale, 'spellImportOk').replace('{n}', String(n)), {
                tone: 'success',
              });
            });
            e.target.value = '';
          }}
        />
      </label>
      <p className="vault-empty" style={{ margin: '8px 0' }}>
        {t(locale, 'spellAffHint')} ({affRuleCount})
      </p>
      <label className="ui-btn" style={{ cursor: 'pointer', display: 'inline-block' }}>
        {t(locale, 'spellImportAff')}
        <input
          type="file"
          accept=".aff,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void f.text().then((text) => {
              const n = importAffText(text);
              setAffRuleCount(n);
              toast(t(locale, 'spellImportAffOk').replace('{n}', String(n)), {
                tone: 'success',
              });
            });
            e.target.value = '';
          }}
        />
      </label>
      {affRuleCount > 0 && (
        <button
          type="button"
          className="ui-btn"
          style={{ marginLeft: 8 }}
          onClick={() => {
            clearAffText();
            setAffRuleCount(0);
          }}
        >
          {t(locale, 'spellClearAff')}
        </button>
      )}
    </div>
  );
}

/* ───────────────────────── 语言 ───────────────────────── */

export function LanguageSection() {
  const s = useSettings();
  const locale = s.locale;
  return (
    <div className="settings-card">
      <div className="ui-field">
        <span>{t(locale, 'language')}</span>
        <select
          className="ui-select"
          value={locale}
          onChange={(e) => s.setLocale(e.target.value as typeof locale)}
        >
          {LOCALES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* ───────────────────────── AI / Agent ───────────────────────── */

export function AgentSection() {
  const s = useSettings();
  const locale = s.locale;

  const ollamaStatus = useOllama((st) => st.status);
  const ollamaBaseUrl = useOllama((st) => st.baseUrl);
  const ollamaModels = useOllama((st) => st.models);
  const ollamaError = useOllama((st) => st.error);
  const checkOllama = useOllama((st) => st.check);

  // 其他 provider 的模型列表
  const modelStore = useModels();
  const providerModels = s.agent.provider === 'ollama' ? ollamaModels : modelStore.models;
  const modelLoading =
    s.agent.provider === 'ollama' ? ollamaStatus === 'checking' : modelStore.loading;
  const modelError =
    (s.agent.provider === 'ollama' ? ollamaError : modelStore.error) ?? undefined;

  // provider 或 apiKey 变化时重新拉取模型列表
  useEffect(() => {
    if (s.agent.provider === 'ollama') {
      void checkOllama();
    } else {
      void modelStore.fetch(s.agent.provider, s.agent.apiKey);
    }
  }, [s.agent.provider, s.agent.apiKey, checkOllama, modelStore.fetch]);

  const connDotCls =
    ollamaStatus === 'online'
      ? 'ok'
      : ollamaStatus === 'checking'
        ? 'checking'
        : ollamaStatus === 'offline'
          ? 'offline'
          : '';
  const connText =
    ollamaStatus === 'online'
      ? `${t(locale, 'agentConnOnline')}${ollamaModels.length ? ` (${ollamaModels.length})` : ''}`
      : ollamaStatus === 'checking'
        ? t(locale, 'agentConnChecking')
        : ollamaStatus === 'offline'
          ? `${t(locale, 'agentConnOffline')}${ollamaError ? `（${ollamaError}）` : ''}`
          : '';

  return (
    <div className="settings-card">
      <div className="ui-field">
        <span>{t(locale, 'agentProvider')}</span>
        <select
          className="ui-select"
          value={s.agent.provider}
          onChange={(e) => {
            // 切换 provider 时清空旧 model，避免跨 Provider 时 StatusBar 显示旧 model
            s.setAgent({ provider: e.target.value, model: '' });
          }}
        >
          <option value="ollama">{t(locale, 'agentProviderOllama')}</option>
          <option value="openai">OpenAI</option>
          <option value="claude">Claude (Anthropic)</option>
          <option value="deepseek">DeepSeek</option>
          <option value="qwen">{t(locale, 'agentProviderQwen')}</option>
          <option value="glm">{t(locale, 'agentProviderGlm')}</option>
          <option value="kimi">{t(locale, 'agentProviderKimi')}</option>
          <option value="doubao">{t(locale, 'agentProviderDoubao')}</option>
          <option value="custom">{t(locale, 'agentProviderCustom')}</option>
        </select>
      </div>
      <div className="ui-field">
        <span>{t(locale, 'agentApiKey')}</span>
        <input
          className="ui-input"
          type="password"
          placeholder={t(locale, 'agentApiKeyHint')}
          value={s.agent.apiKey}
          onChange={(e) => s.setAgent({ apiKey: e.target.value })}
        />
      </div>
      <div className="ui-field">
        <span>{t(locale, 'agentModel')}</span>
        {providerModels.length > 0 ? (
          <select
            className="ui-select"
            value={s.agent.model}
            onChange={(e) => s.setAgent({ model: e.target.value })}
          >
            {providerModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="ui-input"
            type="text"
            placeholder={t(locale, 'agentModelPlaceholder')}
            value={s.agent.model}
            onChange={(e) => s.setAgent({ model: e.target.value })}
          />
        )}
      </div>
      {/* 模型列表状态提示 */}
      {s.agent.provider !== 'ollama' && (
        <div className="agent-conn" style={{ fontSize: 12 }}>
          {modelLoading ? (
            <span>{t(locale, 'agentModelsLoading')}</span>
          ) : modelError ? (
            <span style={{ color: 'var(--orange)' }}>
              {t(locale, 'agentModelsPreset')
                .replace('{error}', modelError)
                .replace('{n}', String(providerModels.length))}
            </span>
          ) : providerModels.length === 0 ? (
            <span style={{ color: 'var(--muted)' }}>{t(locale, 'agentModelsNone')}</span>
          ) : (
            <span style={{ color: 'var(--muted)' }}>
              {t(locale, 'agentModelsLoaded').replace('{n}', String(providerModels.length))}
            </span>
          )}
        </div>
      )}
      {s.agent.provider === 'ollama' && (
        <>
          <div className="agent-conn">
            <span className={`sb-dot ${connDotCls}`} />
            <span className="agent-conn-text">{connText}</span>
            <button
              type="button"
              className="ui-btn"
              disabled={ollamaStatus === 'checking'}
              onClick={() => void checkOllama()}
            >
              {t(locale, 'agentRecheck')}
            </button>
          </div>
          {ollamaStatus === 'offline' && (
            <p className="agent-conn-hint">
              {t(locale, 'agentOfflineHint').replace('{url}', ollamaBaseUrl)}
            </p>
          )}
        </>
      )}
      <label className="ui-check">
        <input
          type="checkbox"
          checked={s.agent.allowWrite}
          onChange={(e) => s.setAgent({ allowWrite: e.target.checked })}
        />
        <span>{t(locale, 'agentAllowWrite')}</span>
      </label>
      <label className="ui-check">
        <input
          type="checkbox"
          checked={s.agent.useRemoteEmbed}
          onChange={(e) => s.setAgent({ useRemoteEmbed: e.target.checked })}
        />
        <span>{t(locale, 'agentRemoteEmbed')}</span>
      </label>
      {s.agent.useRemoteEmbed && (
        <>
          <div className="ui-field">
            <span>{t(locale, 'agentEmbedModel')}</span>
            <input
              className="ui-input"
              type="text"
              placeholder={t(locale, 'agentEmbedModelHint')}
              value={s.agent.embedModel}
              onChange={(e) => s.setAgent({ embedModel: e.target.value })}
            />
          </div>
          <div className="ui-field">
            <span>{t(locale, 'agentEmbedBaseUrl')}</span>
            <input
              className="ui-input"
              type="text"
              placeholder={t(locale, 'agentEmbedBaseUrlHint')}
              value={s.agent.embedBaseUrl}
              onChange={(e) => s.setAgent({ embedBaseUrl: e.target.value })}
            />
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────────────────── 自动化 Recipes ───────────────────────── */

export function RecipesSection() {
  const s = useSettings();
  const locale = s.locale;
  const recipes = useRecipes();
  const docs = useDocuments();
  const active = docs.activeId ? docs.docs[docs.activeId] : null;

  return (
    <div className="settings-card">
      <label className="ui-check">
        <input
          type="checkbox"
          checked={s.recipesOnSave}
          onChange={(e) => s.setRecipesOnSave(e.target.checked)}
        />
        <span>{t(locale, 'recipesOnSave')}</span>
      </label>
      {recipes.recipes.map((r) => (
        <label key={r.id} className="ui-check">
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => recipes.setEnabled(r.id, e.target.checked)}
          />
          <span>
            {localizeRecipeName(r.id, r.name, locale)}{' '}
            <span style={{ opacity: 0.55, fontSize: 12 }}>({r.trigger})</span>
          </span>
        </label>
      ))}
      <button
        type="button"
        className="ui-btn"
        disabled={!active}
        onClick={() => {
          if (!active) return;
          const n = runMatchedRecipes('manual', {
            path: active.path ?? active.name,
            name: active.name,
            content: active.content,
          });
          toast(n > 0 ? t(locale, 'recipeQueued') : t(locale, 'recipeNone'), {
            tone: n > 0 ? 'success' : 'info',
          });
        }}
      >
        {t(locale, 'runManualRecipes')}
      </button>
      {recipes.lastRun && (
        <div className="vault-empty" style={{ marginTop: 8 }}>
          {t(locale, 'lastRecipe')}: {localizeRecipeName(recipes.lastRun.id, recipes.lastRun.name, locale)}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── 分享卡片 / 页脚 ───────────────────────── */

export function ShareSection() {
  const s = useSettings();
  const locale = s.locale;
  return (
    <div className="settings-card">
      <label className="ui-check">
        <input
          type="checkbox"
          checked={s.footer.enabled}
          onChange={(e) => s.setFooter({ ...s.footer, enabled: e.target.checked })}
        />
        <span>{t(locale, 'footer')}</span>
      </label>
      <div className="ui-field">
        <input
          className="ui-input"
          style={{ width: '100%' }}
          type="text"
          placeholder={t(locale, 'footerText')}
          value={s.footer.text ?? ''}
          onChange={(e) => s.setFooter({ ...s.footer, text: e.target.value })}
        />
      </div>
    </div>
  );
}
