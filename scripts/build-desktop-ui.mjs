import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.resolve(process.env.HELENA_WEB_DIR || path.join(clientRoot, '..', 'helena-web-v3'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!fs.existsSync(path.join(webRoot, 'angular.json'))) {
  throw new Error(`Repositório helena-web-v3 não encontrado em ${webRoot}. Defina HELENA_WEB_DIR para o checkout do frontend.`);
}

const result = spawnSync(npm, ['run', 'build', '--', '--base-href', './'], {
  cwd: webRoot,
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
if (result.status !== 0) process.exit(result.status ?? 1);

const source = path.join(webRoot, 'www');
const destination = path.join(clientRoot, 'desktop-ui', 'dist');
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.cpSync(source, destination, { recursive: true });
console.log(`Angular/Ionic desktop UI staged from ${source} to ${destination}`);
