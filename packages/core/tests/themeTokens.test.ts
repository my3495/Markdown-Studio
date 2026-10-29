import { describe, it, expect } from 'vitest';
import {
  CUSTOM_THEME_TOKENS,
  FONT_FAMILY_PRESETS,
  clampTokenValue,
  getTokenDef,
  isAllowedThemeToken,
  normalizeCustomVars,
  normalizeFontFamily,
  normalizeTokenValue,
  parseTokenValue,
  serializeTokenValue,
  sanitizeCustomVars,
} from '../src/renderer/themeTokens';

describe('themeTokens', () => {
  it('白名单含常用令牌', () => {
    expect(CUSTOM_THEME_TOKENS.some((t) => t.key === '--md-color-accent')).toBe(true);
    expect(isAllowedThemeToken('--md-font-size')).toBe(true);
    expect(isAllowedThemeToken('--md-evil')).toBe(false);
  });

  it('sanitize 丢弃非法键与注入', () => {
    const out = sanitizeCustomVars({
      '--md-color-accent': '#ff0000',
      '--md-evil': 'red',
      '--md-font-size': '18px; } body { display:none',
      '--md-line-height': '1.8',
    });
    expect(out).toEqual({
      '--md-color-accent': '#ff0000',
      '--md-line-height': '1.8',
    });
  });

  it('normalizeFontFamily 补通用族兜底并给含空格的名字加引号', () => {
    // 用户实际写法：sans 不是合法通用族，不补全会整串失效
    expect(normalizeFontFamily('PingFang SC, sans')).toBe("'PingFang SC', sans-serif");
    expect(normalizeFontFamily('Microsoft YaHei')).toBe("'Microsoft YaHei', sans-serif");
    expect(normalizeFontFamily('PingFang SC, sans-serif')).toBe("'PingFang SC', sans-serif");
    // 已合规的栈保持原样（仅统一引号与空格）
    expect(normalizeFontFamily("'PingFang SC', 'Microsoft YaHei', sans-serif")).toBe(
      "'PingFang SC', 'Microsoft YaHei', sans-serif"
    );
    expect(normalizeFontFamily('mono')).toBe('monospace');
    expect(normalizeFontFamily('system-ui')).toBe('system-ui');
  });

  it('normalizeFontFamily 拒绝空串/注入/继承关键字', () => {
    expect(normalizeFontFamily('')).toBe('');
    expect(normalizeFontFamily('   ,  ')).toBe('');
    expect(normalizeFontFamily('inherit')).toBe('');
    expect(normalizeFontFamily('serif; } body{display:none')).toBe('');
  });

  it('sanitize 保留字体原文（受控输入框不能边打字边改写），注入仍被拦截', () => {
    expect(sanitizeCustomVars({ '--md-font-family': 'PingFang SC, sans' })).toEqual({
      '--md-font-family': 'PingFang SC, sans',
    });
    expect(sanitizeCustomVars({ '--md-font-family': 'serif; } body{display:none' })).toEqual({});
  });

  it('sanitize 不做 trim（否则输入框里的空格会被立刻吃掉）', () => {
    expect(sanitizeCustomVars({ '--md-font-family': 'PingFang SC' })).toEqual({
      '--md-font-family': 'PingFang SC',
    });
    expect(sanitizeCustomVars({ '--md-max-width': ' 780px ' })).toEqual({
      '--md-max-width': ' 780px ',
    });
  });

  it('字体候选都是合法 font-family 栈（规整后稳定不变）', () => {
    for (const preset of FONT_FAMILY_PRESETS) {
      const once = normalizeFontFamily(preset);
      // 预设本身必须完全合规（不会被补通用族、不会被加/去引号改变语义）
      expect(normalizeFontFamily(once)).toBe(once);
      expect(once.split(', ').length).toBe(preset.split(',').length);
    }
  });
});

describe('数值令牌：不再依赖人工手写 CSS 片段', () => {
  it('四个排版令牌都带输入约束（类型/范围/步进）', () => {
    for (const key of ['--md-font-size', '--md-line-height', '--md-max-width', '--md-radius']) {
      const spec = getTokenDef(key)?.input;
      expect(spec).toBeTruthy();
      expect(spec!.min).toBeLessThan(spec!.max);
      expect(spec!.step).toBeGreaterThan(0);
    }
    // 行高是无单位倍数，长度类则固定 px
    expect(getTokenDef('--md-line-height')!.input!.type).toBe('ratio');
    expect(getTokenDef('--md-font-size')!.input!.unit).toBe('px');
    expect(getTokenDef('--md-color-accent')!.input).toBeUndefined();
  });

  it('缺单位/带空格/全角数字都归一到规范值', () => {
    expect(normalizeTokenValue('--md-font-size', '16')).toBe('16px');
    expect(normalizeTokenValue('--md-font-size', '16 px')).toBe('16px');
    expect(normalizeTokenValue('--md-font-size', '１６ｐｘ')).toBe('16px');
    expect(normalizeTokenValue('--md-max-width', '780')).toBe('780px');
    expect(serializeTokenValue('--md-radius', 12)).toBe('12px');
  });

  it('行高只接受无单位倍数：带 px/% 判错（否则行距不随字号缩放）', () => {
    expect(normalizeTokenValue('--md-line-height', '1.75')).toBe('1.75');
    expect(parseTokenValue('--md-line-height', '1.75px')).toEqual({ ok: false, reason: 'unit' });
    expect(parseTokenValue('--md-line-height', '175%')).toEqual({ ok: false, reason: 'unit' });
    expect(normalizeTokenValue('--md-line-height', '1.75px')).toBeNull();
  });

  it('越界只收敛不改语义，并把 inRange 交给界面提示', () => {
    expect(normalizeTokenValue('--md-font-size', '99')).toBe('24px');
    expect(normalizeTokenValue('--md-radius', '-4')).toBe('0px');
    expect(clampTokenValue('--md-line-height', 3)).toBe('2.2');
    const parsed = parseTokenValue('--md-max-width', '2000');
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.inRange).toBe(false);
    expect(parsed.ok && parsed.value).toBe('2000px');
  });

  it('非数字与空值被拒绝（不写 store）', () => {
    expect(parseTokenValue('--md-font-size', '大')).toEqual({ ok: false, reason: 'not-number' });
    expect(parseTokenValue('--md-font-size', '')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeTokenValue('--md-font-size', '')).toBeNull();
    expect(normalizeTokenValue('--md-font-size', '16em')).toBeNull();
  });

  it('历史持久化数据读入时归一化：补单位、收敛、丢弃脏值', () => {
    expect(
      normalizeCustomVars({
        '--md-font-size': '18',
        '--md-line-height': '1.5',
        '--md-max-width': ' 780px ',
        '--md-radius': '100',
        '--md-color-accent': '#ff0000',
        '--md-font-size-bad': '18px',
      })
    ).toEqual({
      '--md-font-size': '18px',
      '--md-line-height': '1.5',
      '--md-max-width': '780px',
      '--md-radius': '24px',
      '--md-color-accent': '#ff0000',
    });
    // 解析不了的历史脏值直接丢弃，回退主题默认而不是把无效 CSS 注入 :root
    expect(normalizeCustomVars({ '--md-font-size': '16em' })).toEqual({});
  });

  it('字体令牌不参与数值解析（保留原文，避免打字时被吃掉空格）', () => {
    expect(parseTokenValue('--md-font-family', 'PingFang SC')).toEqual({
      ok: true,
      number: Number.NaN,
      value: 'PingFang SC',
      inRange: true,
    });
    expect(normalizeCustomVars({ '--md-font-family': 'PingFang SC, sans' })).toEqual({
      '--md-font-family': 'PingFang SC, sans',
    });
  });
});
