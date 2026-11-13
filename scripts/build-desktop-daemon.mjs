import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Gera o runtime-config (URL central fixa) antes do bundle, para o daemon
// e o processo Electron lerem sempre o mesmo artefato.
const config = spawnSync(
  process.execPath,
  [path.join(root, 'scripts/write-desktop-config.mjs')],
  { cwd: root, stdio: 'inherit' },
);
if (config.status !== 0) process.exit(config.status ?? 1);

await build({
  entryPoints: [path.join(root, 'src/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  outfile: path.join(root, 'dist-desktop/daemon.mjs'),
  absWorkingDir: root,
});
