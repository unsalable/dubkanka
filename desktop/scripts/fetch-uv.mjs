// Puts a pinned uv.exe into resources/: the installer ships it and uses it to set up Python and the AI packages.
import { execFileSync } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const UV_VERSION = '0.13.1';
const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, '..', 'resources', 'uv.exe');

if (existsSync(dest) && execFileSync(dest, ['--version']).toString().includes(UV_VERSION)) {
  console.log(`uv ${UV_VERSION} zaten hazır`);
  process.exit(0);
}
const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`;
const work = mkdtempSync(join(tmpdir(), 'dk-uv-'));
const zip = join(work, 'uv.zip');
const res = await fetch(url);
if (!res.ok) throw new Error(`uv indirilemedi: ${res.status} ${url}`);
await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
// Windows' own bsdtar reads zip files; a tar from Git or MSYS on PATH would not
execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', work]);
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(join(work, 'uv.exe'), dest); // temp and checkout can sit on different drives (CI)
rmSync(work, { recursive: true, force: true });
console.log(`uv ${UV_VERSION} → ${dest}`);
