import {build} from 'esbuild';
import {mkdir, readdir, cp, readFile, writeFile, rename, lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const config = JSON.parse(await readFile(join(root, '.openai/hosting.json'), 'utf8'));
if (!config.project_id || config.static) throw new Error('Worker hosting requires project_id and no static-only configuration.');
// dist contains authored source. Never clean it; move only old generated output.
const backup = join(root, '.sites-runtime', 'build-backups', `${Date.now()}-${process.pid}`);
for (const name of ['client', 'server', '.openai']) {
  try {
    await lstat(join(dist, name));
    await mkdir(backup, {recursive: true});
    await rename(join(dist, name), join(backup, name));
  } catch (error) {if (error.code !== 'ENOENT') throw error;}
}
await mkdir(join(dist, 'client'), {recursive: true});
await mkdir(join(dist, 'server'), {recursive: true});
await mkdir(join(dist, '.openai'), {recursive: true});
const allowedFiles = new Set(['.html', '.css', '.js', '.svg', '.ico', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.json']);
async function checkPublicTree(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error('Public assets must be regular files without hidden files or symlinks.');
    if (entry.isDirectory()) await checkPublicTree(join(directory, entry.name));
  }
}
for (const entry of await readdir(dist, {withFileTypes: true})) {
  if (entry.name.startsWith('.') || ['client', 'server'].includes(entry.name)) continue;
  if (entry.isSymbolicLink()) throw new Error('Public source must not contain symlinks.');
  if (entry.isDirectory() && !['assets', 'vendor', 'examples', 'reference'].includes(entry.name)) throw new Error(`Review public directory before packaging: ${entry.name}`);
  if (entry.isFile() && !allowedFiles.has(entry.name.slice(entry.name.lastIndexOf('.')))) throw new Error(`Review public file before packaging: ${entry.name}`);
  if (entry.isDirectory()) await checkPublicTree(join(dist, entry.name));
  await cp(join(dist, entry.name), join(dist, 'client', entry.name), {recursive: true, dereference: false});
}
await build({entryPoints: [join(root, 'server/site.mjs')], outfile: join(dist, 'server/index.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', sourcemap: false, plugins:[{name:'worker-adapters',setup(build){build.onResolve({filter:/\/render\.mjs$/},()=>({path:join(root,'engine/render-hosted.mjs')}));build.onResolve({filter:/\/library-store\.mjs$/},()=>({path:join(root,'server/library-worker-store.mjs')}));}}]});
await writeFile(join(dist, '.openai/hosting.json'), JSON.stringify(config, null, 2) + '\n');
await writeFile(join(dist, 'client/_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  Permissions-Policy: microphone=(self)\n');
console.log('Built Sites Worker and public assets. Authored dist files preserved.');
