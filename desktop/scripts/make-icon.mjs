// build/icon.ico (16-256 px) and build/icon.png from web/icon.svg. The results are committed, CI does not run this.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const svg = join(here, '..', '..', 'web', 'icon.svg');
const out = join(here, '..', 'build');
mkdirSync(out, { recursive: true });
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer()));
writeFileSync(join(out, 'icon.ico'), await pngToIco(pngs));
writeFileSync(join(out, 'icon.png'), await sharp(svg, { density: 768 }).resize(512, 512).png().toBuffer());
console.log('build/icon.ico, build/icon.png');
