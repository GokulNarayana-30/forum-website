// Prepares the browser build for GitHub Pages, a static host under a sub-path.
// Usage: node scripts/prepare-pages.mjs <browser-dir> <base-path>   (base like /forum-website/)
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, base] = process.argv.slice(2);
if (!dir || !base || !base.startsWith('/') || !base.endsWith('/')) {
  console.error('Usage: node scripts/prepare-pages.mjs <browser-dir> </base-path/>');
  process.exit(1);
}

// The font files are referenced as /assets/... in styles.scss, which the build leaves untouched,
// and the build copies that into the pages' inline styles and a preload link. Under a sub-path
// every such reference must point inside it.
let rewritten = 0;
for (const name of readdirSync(dir).filter((f) => f.endsWith('.css') || f.endsWith('.html'))) {
  const file = join(dir, name);
  const text = readFileSync(file, 'utf8');
  const next = text
    .replaceAll('url(/assets/', `url(${base}assets/`)
    .replaceAll('"/assets/', `"${base}assets/`);
  if (next !== text) {
    writeFileSync(file, next);
    rewritten += 1;
  }
}
if (rewritten === 0) {
  console.error('Nothing referenced /assets/: the font path fix is no longer needed or broke.');
  process.exit(1);
}

// A static host answers an unknown path with 404.html. The client-rendered shell lets the router
// open /tests, /cart and the rest when they are opened directly or reloaded.
if (!existsSync(join(dir, 'index.csr.html'))) {
  console.error('index.csr.html is missing from the build.');
  process.exit(1);
}
copyFileSync(join(dir, 'index.csr.html'), join(dir, '404.html'));
// No Jekyll processing of the build output.
writeFileSync(join(dir, '.nojekyll'), '');
console.log(`Pages build ready in ${dir} (base ${base}, ${rewritten} file(s) updated).`);
