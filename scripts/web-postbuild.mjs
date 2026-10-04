// Cloudflare Pages は node_modules という名前のフォルダをアップロードしない。
// expo export は wasm・フォントを assets/node_modules/ に出すので、名前を変えて参照も書き換える
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
renameSync(join(dist, 'assets/node_modules'), join(dist, 'assets/vendor'));

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const f of walk(dist).filter((f) => /\.(js|html|json|css)$/.test(f))) {
  const s = readFileSync(f, 'utf8');
  if (s.includes('assets/node_modules')) writeFileSync(f, s.replaceAll('assets/node_modules', 'assets/vendor'));
}
