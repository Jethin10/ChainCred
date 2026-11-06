#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(packageRoot, 'registry');
const catalog = JSON.parse(readFileSync(resolve(source, 'catalog.json'), 'utf8'));
const args = process.argv.slice(2);
const options = { cwd: process.cwd(), dir: undefined, force: false, dryRun: false, install: true, all: false };
const names = [];

function inside(root, target) {
  const path = relative(root, target);
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`);
}
function runNpm(parameters, cwd, capture = false) {
  const cli = process.env.npm_execpath?.endsWith('.js') ? process.env.npm_execpath : resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!existsSync(cli)) throw new Error('Run this installer with npm run ui:add or npm exec paykit-ui so npm can be located.');
  const result = spawnSync(process.execPath, [cli, ...parameters], { cwd, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`npm ${parameters[0]} failed. Your existing components were not overwritten.`);
  return result.stdout?.trim();
}

try {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--cwd' || arg === '--dir') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a path`);
      options[arg.slice(2)] = value;
    } else if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-install') options.install = false;
    else if (arg === '--all') options.all = true;
    else if (arg === '--list') { console.log(catalog.map((item) => `${item.id.padEnd(20)} ${item.title}`).join('\n')); process.exit(0); }
    else if (arg === '--help' || arg === '-h') {
      console.log('paykit-ui <component...> --cwd <your-react-app> [--all] [--dir components/paykit] [--no-install] [--dry-run] [--force]\nCopies presentation code and styles. Never overwrites existing components without --force.');
      process.exit(0);
    } else if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}`);
    else names.push(arg.replace(/^paykit-/, ''));
  }
  const selected = options.all ? catalog : [...new Set(names)].map((id) => {
    const item = catalog.find((item) => item.id === id);
    if (!item) throw new Error(`Unknown component "${id}". Use --list.`);
    return item;
  });
  if (!selected.length) throw new Error('Choose a component or --all. Use --list to see available components.');
  const target = realpathSync(resolve(options.cwd));
  const manifestPath = resolve(target, 'package.json');
  if (!existsSync(manifestPath)) throw new Error('The target must be an existing React project with a package.json.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  const destination = resolve(target, options.dir ?? (existsSync(resolve(target, 'src')) ? 'src/components/paykit' : 'components/paykit'));
  if (!inside(target, destination)) throw new Error('Component directory must stay inside the target project.');
  for (const directory of [destination, resolve(target, '.paykit/packages')]) {
    let ancestor = directory;
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    if (!inside(target, realpathSync(ancestor))) throw new Error('A destination symlink points outside the target project.');
  }
  const files = [...selected.map((item) => `${item.id}.tsx`), 'paykit-ui.css'].map((name) => ({ name, path: resolve(destination, name), contents: readFileSync(resolve(source, name), 'utf8') }));
  const changes = files.filter((file) => !existsSync(file.path) || readFileSync(file.path, 'utf8') !== file.contents);
  for (const file of changes) {
    if (existsSync(file.path) && file.name !== 'paykit-ui.css' && !options.force) throw new Error(`${relative(target, file.path)} already exists. Use --force to replace it, or choose another --dir.`);
    if (existsSync(file.path) && !inside(target, realpathSync(file.path))) throw new Error('A destination file points outside the target project.');
  }
  if (options.dryRun) { console.log(`Would copy ${files.map((file) => relative(target, file.path)).join(', ')}\nNo files or dependencies changed.`); process.exit(0); }
  let sdkInstalled = Boolean(manifest.dependencies?.['@paykit/react']);
  try {
    const fromTarget = createRequire(manifestPath);
    fromTarget.resolve('@paykit/react');
    fromTarget.resolve('@paykit/js');
  } catch { sdkInstalled = false; }
  if (options.install && !sdkInstalled) {
    const root = resolve(packageRoot, '../..');
    if (!existsSync(resolve(root, 'packages/core/package.json'))) throw new Error('Install @paykit/react in your target first, or run the installer from the PayKit source checkout. --no-install copies only the UI files.');
    if (['core', 'js', 'react'].some((name) => !existsSync(resolve(root, `packages/${name}/dist/index.js`)))) runNpm(['run', 'sdk:build'], root);
    const packDir = resolve(target, '.paykit/packages');
    mkdirSync(packDir, { recursive: true });
    const tarballs = ['core', 'js', 'react'].map((name) => {
      const output = runNpm(['pack', '--silent', '--pack-destination', packDir, '-w', `@paykit/${name}`], root, true);
      const file = output.split(/\r?\n/).at(-1);
      if (!file || file.includes('/') || file.includes('\\') || !file.endsWith('.tgz')) throw new Error('Unexpected npm pack output');
      return resolve(packDir, file);
    });
    runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], target);
  }
  mkdirSync(destination, { recursive: true });
  for (const file of changes) {
    if (file.name === 'paykit-ui.css' && existsSync(file.path) && !options.force) { console.log(`Preserved customized ${relative(target, file.path)}`); continue; }
    writeFileSync(file.path, file.contents, { flag: options.force ? 'w' : 'wx' });
    console.log(`Added ${relative(target, file.path)}`);
  }
  console.log(`\nWrap these components in PayKitProvider and import @paykit/react/styles.css once.\nUsage: ${selected[0].usage}\nKeep prices and secret keys on your backend. Example: examples/next-store in the PayKit repository.`);
} catch (error) { console.error(error instanceof Error ? error.message : 'Component installation failed'); process.exitCode = 1; }
