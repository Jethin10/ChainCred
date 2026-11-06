import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const destination = resolve('web/public/r');
mkdirSync(destination, { recursive: true });
const items = [ ['checkout', 'Custom checkout'], ['payment-status', 'Payment status'] ].map(([name, title]) => ({
  '$schema': 'https://ui.shadcn.com/schema/registry-item.json', name: `paykit-${name}`, type: 'registry:component', title,
  description: 'Copy and customize the UI. PayKit hooks retain signing and payment logic.', dependencies: ['@paykit/react@0.1.0'],
  files: [{ path: `components/paykit/${name}.tsx`, type: 'registry:component', content: readFileSync(`packages/react/registry/${name}.tsx`, 'utf8') }],
}));
for (const item of items) writeFileSync(resolve(destination, `${item.name.replace('paykit-', '')}.json`), `${JSON.stringify(item, null, 2)}\n`);
writeFileSync(resolve(destination, 'registry.json'), `${JSON.stringify({ '$schema': 'https://ui.shadcn.com/schema/registry.json', name: 'paykit', homepage: 'http://localhost:5174', items }, null, 2)}\n`);
console.log(`Built ${items.length} local PayKit UI registry items`);
