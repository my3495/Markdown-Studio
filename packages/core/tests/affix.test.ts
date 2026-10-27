import { describe, it, expect } from 'vitest';
import {
  applySuffixRule,
  applyPrefixRule,
  buildDictionaryFromDic,
  buildDictionaryWithAffix,
  expandEntries,
  expandWithAffix,
  matchCondition,
  parseAffixRules,
  parseDicEntries,
  type DicEntry,
} from '../src/spell/affix';
import { checkSpelling, DEFAULT_EN_DICT } from '../src/spell/check';
import { buildSpellDictionaryFromDic, buildSpellDictionaryWithAffix } from '../src/spell/dict';

const AFF = `
# 测试用 aff 子集
TRY abcdefghijklmnopqrstuvwxyz

SFX Y Y 5
SFX Y 0 s .
SFX Y y ies [^aeiou]y
SFX Y y ied [^aeiou]y
SFX Y 0 ing .
SFX Y 0 ed .

PFX A Y 2
PFX A 0 un .
PFX A 0 re .
`;

describe('affix 解析', () => {
  it('解析 SFX/PFX 规则并跳过 header 与未知指令', () => {
    const rules = parseAffixRules(AFF);
    expect(rules.suffixes.get('Y')).toHaveLength(5);
    expect(rules.prefixes.get('A')).toHaveLength(2);
    const ied = rules.suffixes.get('Y')![2]!;
    expect(ied).toEqual({ strip: 'y', add: 'ied', condition: '[^aeiou]y' });
  });

  it('strip=0 归一为空串，形态描述被剔除', () => {
    const rules = parseAffixRules('SFX S Y 1\nSFX S 0 s/[NOUN] .');
    expect(rules.suffixes.get('S')![0]).toEqual({ strip: '', add: 's', condition: '.' });
  });
});

describe('条件匹配', () => {
  it('点号表示任意字符', () => {
    expect(matchCondition('cat', '.', true)).toBe(true);
    expect(matchCondition('', '.', true)).toBe(false);
  });

  it('字面量与字符类', () => {
    expect(matchCondition('beauty', '[^aeiou]y', true)).toBe(true);
    expect(matchCondition('day', '[^aeiou]y', true)).toBe(false);
    expect(matchCondition('happy', 'py', true)).toBe(true);
    expect(matchCondition('happy', 'ha', false)).toBe(true);
    expect(matchCondition('happy', 'un', false)).toBe(false);
  });
});

describe('规则应用', () => {
  it('后缀：study → studied（strip y + add ied）', () => {
    const rules = parseAffixRules(AFF);
    const rule = rules.suffixes.get('Y')![2]!;
    expect(applySuffixRule('study', rule)).toBe('studied');
    expect(applySuffixRule('say', rule)).toBeNull(); // 条件不满足
  });

  it('前缀：happy → unhappy / read → reread', () => {
    const rules = parseAffixRules(AFF);
    const un = rules.prefixes.get('A')![0]!;
    const re = rules.prefixes.get('A')![1]!;
    expect(applyPrefixRule('happy', un)).toBe('unhappy');
    expect(applyPrefixRule('read', re)).toBe('reread');
  });
});

describe('词形展开', () => {
  it('展开集合包含原词干与全部规则形式', () => {
    const stems = new Set(['study', 'happy', 'read']);
    const accepted = expandWithAffix(stems, parseAffixRules(AFF));
    for (const w of [
      'study',
      'studies',
      'studying',
      'studied',
      'happy',
      'happys',
      'happying',
      'happyed',
      'unhappy',
      'read',
      'reads',
      'reading',
      'readed',
      'unread',
      'reread',
    ]) {
      expect(accepted.has(w)).toBe(true);
    }
  });

  it('空规则集合时仅保留原词干', () => {
    const accepted = expandWithAffix(['cat'], { prefixes: new Map(), suffixes: new Map() });
    expect([...accepted]).toEqual(['cat']);
  });

  it('cross-product：前缀形式可再套后缀（reread + s → rereads）', () => {
    const stems = new Set(['read']);
    const accepted = expandWithAffix(stems, parseAffixRules(AFF));
    expect(accepted.has('reread')).toBe(true);
    expect(accepted.has('rereads')).toBe(true);
    expect(accepted.has('unreads')).toBe(true);
  });
});

describe('checkSpelling 接入 affix', () => {
  const stems = new Set(['study', 'happy', 'read', 'xyzzyword']);
  const affix = parseAffixRules(AFF);

  it('affix 派生词不再误报', () => {
    const issues = checkSpelling('She is studying happily and rereads notes.', {
      dictionary: stems,
      affix,
    });
    expect(issues.map((i) => i.word)).not.toContain('studying');
    expect(issues.map((i) => i.word)).not.toContain('rereads');
  });

  it('仍能检出真正未知词', () => {
    const issues = checkSpelling('This is zzqqxx nonsense.', {
      dictionary: stems,
      affix,
    });
    expect(issues.some((i) => i.word === 'zzqqxx')).toBe(true);
  });

  it('无 affix 时派生词照常报错（回归）', () => {
    const issues = checkSpelling('studying', { dictionary: stems });
    expect(issues.some((i) => i.word === 'studying')).toBe(true);
  });
});

describe('词典构建', () => {
  it('.dic + .aff → 含派生词的可接受集合', () => {
    const dic = '3\nstudy\nhappy\nread';
    const dict = buildSpellDictionaryWithAffix(dic.split('\n').slice(1), AFF);
    expect(dict.has('studying')).toBe(true);
    expect(dict.has('unhappy')).toBe(true);
  });

  it('aff 为空时退化为纯词表', () => {
    const dict = buildSpellDictionaryWithAffix(['cat']);
    expect(dict.has('cats')).toBe(false);
    expect(DEFAULT_EN_DICT.size).toBeGreaterThan(50);
  });

  it('buildDictionaryWithAffix 小写归一', () => {
    const dict = buildDictionaryWithAffix(['Study'], AFF);
    expect(dict.has('studying')).toBe(true);
  });
});

// ---------- B3 增强：词级 flags / 双 affix / 形态描述 ----------

const FLAG_AFF = `
SFX A Y 2
SFX A 0 s .
SFX A y ied [^aeiou]y

SFX B Y 1
SFX B 0 ed .

PFX U Y 1
PFX U 0 un .
`;

describe('.dic 词条解析', () => {
  it('解析词级 flags（word/FLAGS）', () => {
    const entries = parseDicEntries('3\nstudy/AB\nhappy\nrun/U');
    expect(entries).toEqual([
      { stem: 'study', flags: ['A', 'B'] },
      { stem: 'happy', flags: [] },
      { stem: 'run', flags: ['U'] },
    ]);
  });

  it('形态描述被忽略（word/FLAGS po:noun）', () => {
    const entries = parseDicEntries('1\nnote/AB po:noun is:sg');
    expect(entries).toEqual([{ stem: 'note', flags: ['A', 'B'] }]);
  });

  it('忽略注释与空行', () => {
    const entries = parseDicEntries('# comment\n\nword\n');
    expect(entries).toEqual([{ stem: 'word', flags: [] }]);
  });
});

describe('词级 flags 过滤', () => {
  it('只应用对应 flag 的规则', () => {
    const rules = parseAffixRules(FLAG_AFF);
    // happy 无 flags → 全部规则；study 仅 A/B
    const happy = expandEntries([{ stem: 'happy', flags: [] }], rules);
    expect(happy.has('happys')).toBe(true); // SFX A
    expect(happy.has('happyed')).toBe(true); // SFX B
    expect(happy.has('unhappy')).toBe(true); // PFX U

    const study = expandEntries([{ stem: 'study', flags: ['A'] }], rules);
    expect(study.has('studys')).toBe(true); // SFX A
    expect(study.has('studied')).toBe(true); // SFX A（ied）
    expect(study.has('studyd')).toBe(false); // SFX B 不在 flags 中
    expect(study.has('unstudy')).toBe(false); // PFX U 不在 flags 中
  });

  it('flags 与 checkSpelling 联动', () => {
    const rules = parseAffixRules(FLAG_AFF);
    const dict = expandEntries(
      [
        { stem: 'study', flags: ['A'] },
        { stem: 'happy', flags: [] },
      ],
      rules
    );
    const issues = checkSpelling('study studys studied studyd happy', {
      dictionary: dict,
    });
    expect(issues.map((i) => i.word)).toEqual(['studyd']);
  });
});

describe('双 affix 链', () => {
  it('PFX + SFX：unhappy → unhappys', () => {
    const rules = parseAffixRules(FLAG_AFF);
    const set = expandEntries([{ stem: 'happy', flags: ['A', 'U'] }], rules);
    expect(set.has('unhappy')).toBe(true);
    expect(set.has('happys')).toBe(true);
    expect(set.has('unhappys')).toBe(true);
  });

  it('SFX + SFX：study → studieded（双后缀链）', () => {
    const rules = parseAffixRules(FLAG_AFF);
    const set = expandEntries([{ stem: 'study', flags: ['A', 'B'] }], rules);
    expect(set.has('studied')).toBe(true); // A→ied
    expect(set.has('studyed')).toBe(true); // B→ed
    expect(set.has('studieded')).toBe(true); // A→ied 后再套 B→ed
    expect(set.has('studysed')).toBe(true); // A→s 后再套 B→ed
  });

  it('allowDouble=false 时只有单 affix', () => {
    const rules = parseAffixRules(FLAG_AFF);
    const set = expandEntries([{ stem: 'happy', flags: ['A', 'U'] }], rules, {
      allowDouble: false,
    });
    expect(set.has('unhappy')).toBe(true);
    expect(set.has('happys')).toBe(true);
    expect(set.has('unhappys')).toBe(false);
  });

  it('规模上限生效（maxForms / maxPairsPerStem）', () => {
    const rules = parseAffixRules(FLAG_AFF);
    const set = expandEntries([{ stem: 'happy', flags: ['A', 'U'] }], rules, {
      maxPairsPerStem: 0,
    });
    expect(set.has('unhappys')).toBe(false);
    // maxForms 为「超过后停止处理后续词干」的防爆闸：100 个词干被截断，
    // 集合大小有界（远小于 100 个词干的全量展开）
    const capped = expandEntries(
      Array.from({ length: 100 }, (): DicEntry => ({ stem: 'word', flags: [] })),
      rules,
      { maxForms: 20 }
    );
    expect(capped.size).toBeLessThan(40);
    expect(capped.has('word')).toBe(true);
  });
});

describe('buildDictionaryFromDic（.dic 文本直建）', () => {
  it('flags + 双 affix 全链路', () => {
    const dic = '2\nhappy/AU\nstudy/AB';
    const dict = buildDictionaryFromDic(dic, FLAG_AFF);
    expect(dict.has('happy')).toBe(true);
    expect(dict.has('unhappy')).toBe(true);
    expect(dict.has('unhappys')).toBe(true);
    expect(dict.has('studied')).toBe(true);
    expect(dict.has('studieded')).toBe(true);
  });

  it('buildSpellDictionaryFromDic 合并默认词表', () => {
    const dict = buildSpellDictionaryFromDic('1\nzzcustom/A', FLAG_AFF);
    expect(dict.has('zzcustom')).toBe(true);
    expect(dict.has('zzcustoms')).toBe(true);
    expect(dict.has('the')).toBe(true); // 默认词表
  });
});
