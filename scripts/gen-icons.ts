// Renders public/icon.svg into the PNG sizes the manifest and iOS need. Run: pnpm icons:generate
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

async function main() {
  const svg = await readFile('public/icon.svg');
  const targets: Array<[string, number, boolean]> = [
    ['public/icons/icon-192.png', 192, false],
    ['public/icons/icon-512.png', 512, false],
    ['public/icons/icon-maskable-512.png', 512, true],
    ['public/icons/apple-touch-icon.png', 180, false],
  ];
  for (const [out, size, maskable] of targets) {
    // Maskable icons keep the glyph inside the 80% safe zone.
    const inner = maskable ? Math.round(size * 0.8) : size;
    const glyph = await sharp(svg).resize(inner, inner).png().toBuffer();
    await sharp({
      create: { width: size, height: size, channels: 4, background: '#1e1a16' },
    })
      .composite([{ input: glyph, gravity: 'centre' }])
      .png()
      .toFile(out);
    console.log('wrote', out);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
