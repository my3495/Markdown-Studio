/**
 * 下载 tldraw 3.4.0 静态资产到 public/tldraw-assets/，并生成 tldrawAssets.ts 覆盖模块。
 * 仅依赖 cdn.tldraw.com（桌面端 CSP 阻止该域，故必须本地化）。
 * 运行：node scripts/fetch-tldraw-assets.mjs
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VERSION = '3.4.0';
const BASE = `https://cdn.tldraw.com/${VERSION}`;
const OUT = join(ROOT, 'public', 'tldraw-assets');

const FONTS = [
  'Shantell_Sans-Tldrawish.woff2',
  'IBMPlexSerif-Medium.woff2',
  'IBMPlexSans-Medium.woff2',
  'IBMPlexMono-Medium.woff2',
];

// 图标名（与 tldraw/lib/ui/icon-types.js 保持一致）
const ICON_TYPES = [
  'align-bottom','align-center-horizontal','align-center-vertical','align-left','align-right','align-top','arrow-left','arrowhead-arrow','arrowhead-bar','arrowhead-diamond','arrowhead-dot','arrowhead-none','arrowhead-square','arrowhead-triangle-inverted','arrowhead-triangle','blob','bring-forward','bring-to-front','broken','check-circle','check','chevron-down','chevron-left','chevron-right','chevron-up','chevrons-ne','chevrons-sw','clipboard-copied','clipboard-copy','color','cross-2','cross-circle','dash-dashed','dash-dotted','dash-draw','dash-solid','disconnected','discord','distribute-horizontal','distribute-vertical','dot','dots-horizontal','dots-vertical','drag-handle-dots','duplicate','edit','external-link','fill-fill','fill-none','fill-pattern','fill-semi','fill-solid','follow','following','font-draw','font-mono','font-sans','font-serif','geo-arrow-down','geo-arrow-left','geo-arrow-right','geo-arrow-up','geo-check-box','geo-cloud','geo-diamond','geo-ellipse','geo-heart','geo-hexagon','geo-octagon','geo-oval','geo-pentagon','geo-rectangle','geo-rhombus-2','geo-rhombus','geo-star','geo-trapezoid','geo-triangle','geo-x-box','github','group','horizontal-align-end','horizontal-align-middle','horizontal-align-start','info-circle','leading','link','lock','menu','minus','mixed','pack','plus','question-mark-circle','question-mark','redo','reset-zoom','rotate-ccw','rotate-cw','send-backward','send-to-back','share-1','size-extra-large','size-large','size-medium','size-small','spline-cubic','spline-line','stack-horizontal','stack-vertical','status-offline','stretch-horizontal','stretch-vertical','text-align-center','text-align-left','text-align-right','toggle-off','toggle-on','tool-arrow','tool-eraser','tool-frame','tool-hand','tool-highlight','tool-laser','tool-line','tool-media','tool-note','tool-pencil','tool-pointer','tool-screenshot','tool-text','trash','twitter','undo','ungroup','unlock','vertical-align-end','vertical-align-middle','vertical-align-start',
];

// tldraw 已知 locale 列表（与 @tldraw/editor Languages.ts 对齐）
const LOCALES = [
  'ar','bn','ca','cs','da','de','el','en','es','eu','fa','fi','fr','gl','he','hi','hr','hu','id','is','it','ja','ko','lv','mk','nb','ne','nl','nn','pl','pt','pt-BR','ro','ru','sk','sl','sr','sv','tr','uk','vi','zh-CN','zh-TW','eo','tl','th',
];

const EMBED_TYPES = [
  'codepen','codesandbox','desmos','excalidraw','felt','figma','github_gist','google_calendar','google_maps','google_slides','observable','replit','scratch','spotify','tldraw','val_town','vimeo','youtube',
];

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function download(relPath, url) {
  const dest = join(OUT, relPath);
  if (existsSync(dest)) return;
  const buf = await get(url);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log('  ✓', relPath, `${buf.length}B`);
}

async function main() {
  console.log('Downloading tldraw assets from', BASE);
  const okLocales = [];
  const okEmbeds = [];
  // fonts
  for (const f of FONTS) {
    await download(`fonts/${f}`, `${BASE}/fonts/${f}`);
  }
  // icons sprite
  await download('icons/icon/0_merged.svg', `${BASE}/icons/icon/0_merged.svg`);
  // embed icons
  for (const t of EMBED_TYPES) {
    try {
      await download(`embed-icons/${t}.png`, `${BASE}/embed-icons/${t}.png`);
      okEmbeds.push(t);
    } catch (e) {
      console.log('  ! skip embed', t, e.message);
    }
  }
  // translations
  for (const l of LOCALES) {
    try {
      await download(`translations/${l}.json`, `${BASE}/translations/${l}.json`);
      okLocales.push(l);
    } catch (e) {
      console.log('  ! skip', l, e.message);
    }
  }

  // 生成 tldrawAssets.ts
  const fontsObj = `{
    draw: '${localPublic('fonts/Shantell_Sans-Tldrawish.woff2')}',
    serif: '${localPublic('fonts/IBMPlexSerif-Medium.woff2')}',
    sansSerif: '${localPublic('fonts/IBMPlexSans-Medium.woff2')}',
    monospace: '${localPublic('fonts/IBMPlexMono-Medium.woff2')}',
  }`;
  const iconsObj =
    '{\n' +
    ICON_TYPES.map((n) => `    ${JSON.stringify(n)}: '${localPublic('icons/icon/0_merged.svg')}#${n}'`).join(',\n') +
    ',\n  }';
  const translationsObj =
    '{\n' +
    okLocales.map((l) => `    ${JSON.stringify(l)}: '${localPublic(`translations/${l}.json`)}'`).join(',\n') +
    ',\n  }';
  const embedObj =
    '{\n' +
    okEmbeds.map((t) => `    ${JSON.stringify(t)}: '${localPublic(`embed-icons/${t}.png`)}'`).join(',\n') +
    ',\n  }';

  const ts = `// 自动生成（scripts/fetch-tldraw-assets.mjs）。tldraw 资产本地化覆盖，避免桌面端 CSP 拦截 CDN。
import { setDefaultEditorAssetUrls, setDefaultUiAssetUrls } from 'tldraw';

export function installTldrawLocalAssets(): void {
  setDefaultEditorAssetUrls({
    fonts: ${fontsObj},
  });
  setDefaultUiAssetUrls({
    fonts: ${fontsObj},
    icons: ${iconsObj},
    translations: ${translationsObj},
    embedIcons: ${embedObj},
  });
}
`;
  await writeFile(join(ROOT, 'src', 'tldrawAssets.ts'), ts);
  console.log(`Generated src/tldrawAssets.ts (${okLocales.length} locales, ${okEmbeds.length} embeds)`);
}

function localPublic(rel) {
  return `tldraw-assets/${rel}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
