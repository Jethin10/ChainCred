import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { it } from 'node:test';
const installer = resolve('packages/react/bin/add.mjs');
const fixture = () => { const cwd = mkdtempSync(join(tmpdir(), 'paykit-ui-')); writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'merchant-fixture', private: true })); mkdirSync(join(cwd, 'src')); return cwd; };
const lf = (text) => text.replace(/\r\n/g, '\n');
const run = (...args) => spawnSync(process.execPath, [installer, ...args], { encoding: 'utf8', windowsHide: true });
it('dry runs without changing the target and lists all six components', () => {
  const cwd = fixture();
  const result = run('checkout', '--cwd', cwd, '--dry-run');
  assert.equal(result.status, 0, result.stderr); assert.equal(existsSync(join(cwd, 'src/components')), false);
  assert.match(run('--list').stdout, /installment-plan/);
});
it('copies every component with its shared stylesheet and refuses to overwrite custom code', () => {
  const cwd = fixture();
  const first = run('--all', '--cwd', cwd, '--no-install'); assert.equal(first.status, 0, first.stderr);
  const checkout = join(cwd, 'src/components/paykit/checkout.tsx');
  assert.match(readFileSync(checkout, 'utf8'), /expectedAmount: amount/);
  assert.ok(existsSync(join(cwd, 'src/components/paykit/paykit-ui.css')));
  writeFileSync(checkout, '// my customized merchant view\n');
  const second = run('checkout', '--cwd', cwd, '--no-install'); assert.equal(second.status, 1); assert.match(second.stderr, /already exists/);
  assert.equal(readFileSync(checkout, 'utf8'), '// my customized merchant view\n');
  assert.equal(run('checkout', '--cwd', cwd, '--no-install', '--force').status, 0);
});
it('preserves custom shared styles when another component is added', () => {
  const cwd = fixture();
  assert.equal(run('checkout', '--cwd', cwd, '--no-install').status, 0);
  const css = join(cwd, 'src/components/paykit/paykit-ui.css'); writeFileSync(css, '/* merchant theme */');
  assert.equal(run('receipt', '--cwd', cwd, '--no-install').status, 0);
  assert.equal(readFileSync(css, 'utf8'), '/* merchant theme */');
});
it('rejects paths outside the project and unknown components before writing', () => {
  const cwd = fixture();
  assert.equal(run('checkout', '--cwd', cwd, '--dir', '../escape', '--no-install').status, 1);
  assert.equal(run('../secrets', '--cwd', cwd, '--no-install').status, 1);
  assert.equal(existsSync(join(cwd, 'src/components')), false);
});
it('generated registry items include source and style bytes matching the copyable files', () => {
  const catalog = JSON.parse(readFileSync('packages/react/registry/catalog.json', 'utf8'));
  for (const item of catalog) {
    const registry = JSON.parse(readFileSync(`web/public/r/${item.id}.json`, 'utf8'));
    assert.equal(registry.files.length, 2); assert.equal(registry.files[0].content, lf(readFileSync(`packages/react/registry/${item.id}.tsx`, 'utf8')));
    assert.equal(registry.files[1].content, lf(readFileSync('packages/react/registry/paykit-ui.css', 'utf8'))); assert.ok(registry.files[1].target);
  }
});
