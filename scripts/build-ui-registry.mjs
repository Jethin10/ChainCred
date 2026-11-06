import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'packages/react/registry');
const destination = resolve(root, 'web/public/r');
const catalog = JSON.parse(readFileSync(resolve(source, 'catalog.json'), 'utf8'));
const css = readFileSync(resolve(source, 'paykit-ui.css'), 'utf8');
const origin = process.env.PAYKIT_REGISTRY_ORIGIN ?? 'http://localhost:5174';
mkdirSync(destination, { recursive: true });
const items = catalog.map(({ id, title, description }) => ({
  $schema: 'https://ui.shadcn.com/schema/registry-item.json',
  name: `paykit-${id}`, type: 'registry:component', title, description,
  dependencies: ['@paykit/react@0.1.0', '@paykit/js@0.1.0'],
  files: [
    { path: `components/paykit/${id}.tsx`, type: 'registry:component', content: readFileSync(resolve(source, `${id}.tsx`), 'utf8') },
    { path: 'components/paykit/paykit-ui.css', target: 'components/paykit/paykit-ui.css', type: 'registry:file', content: css },
  ],
}));
for (const [index, item] of items.entries()) writeFileSync(resolve(destination, `${catalog[index].id}.json`), `${JSON.stringify(item, null, 2)}\n`);
writeFileSync(resolve(destination, 'registry.json'), `${JSON.stringify({ $schema: 'https://ui.shadcn.com/schema/registry.json', name: 'paykit', homepage: origin, items }, null, 2)}\n`);
console.log(`Built ${items.length} PayKit components with shared styles`);
