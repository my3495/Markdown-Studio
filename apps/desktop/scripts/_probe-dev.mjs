const base = 'http://localhost:1420';

async function hit(url) {
  const r = await fetch(url);
  const t = await r.text();
  const bad = /Failed to resolve|Internal server error|Pre-transform error/.test(t);
  console.log(r.status, bad ? 'FAIL' : 'ok', url.replace(base, ''), 'len', t.length);
  if (bad) console.log(t.slice(0, 500));
  return { ok: r.ok && !bad, t };
}

const index = await hit(`${base}/`);
const mod = await hit(
  `${base}/@fs/D:/pro/Markdown-Studio/apps/web/src/index.ts`
);
await hit(
  `${base}/@fs/D:/pro/Markdown-Studio/node_modules/.pnpm/katex@0.16.47/node_modules/katex/dist/katex.min.css`
);

const specs = [...mod.t.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
let failed = !index.ok || !mod.ok;
for (const spec of specs) {
  if (!spec.startsWith('/')) continue;
  const res = await hit(base + spec);
  if (!res.ok) failed = true;
}
if (!index.t.includes('id="root"') && !index.t.includes("id='root'")) {
  console.log('index missing root');
  failed = true;
}
process.exit(failed ? 1 : 0);
