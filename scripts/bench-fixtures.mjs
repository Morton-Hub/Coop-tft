// Fabrique tests/fixtures/bench.json à partir de captures d'écran réelles du jeu.
//
//   node scripts/bench-fixtures.mjs <dossier des captures>
//
// Les captures (JPEG) ne sont PAS versionnées : elles montrent les pseudos d'autres joueurs. Seules
// les signatures (grilles 8×8 de couleurs moyennes) et les étiquettes saisies à la main sont écrites.
// Le script réutilise le code de src/screen/icons.ts (transpilé à la volée par esbuild, déjà présent
// via Vite), pour que les fixtures soient exactement ce que l'application calculerait.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { transform } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src/screen/icons.ts'), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const icons = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

// Étiquettes posées à l'œil, de haut en bas. Les noms décrivent l'icône, pas l'objet du jeu : on n'a
// pas d'icônes de référence. `couvert` = nombre d'emplacements du haut dont le bord droit est mordu
// par le panneau de boutique ouvert. Un « + » marque une icône portant un badge de quantité.
const SHOTS = [
  { file: '1567dad1', items: ['brun+', 'feuille', 'ceinture', 'cape'], couvert: 0 },
  { file: 'bb9ca803', items: ['brun+', 'pointes', 'feuille'], couvert: 0 },
  { file: 'bd9e6825', items: ['brun+', 'feuille', 'pointes', 'orbe', 'larme'], couvert: 0 },
  { file: '3e0a0fbc', items: ['brun+', 'feuille', 'pointes', 'orbe'], couvert: 3 },
  { file: '0618b64c', items: ['gilet', 'brun+', 'cape', 'feuille', 'pointes'], couvert: 0 },
  { file: 'a42e9c6d', items: ['gilet', 'brun+', 'cape', 'feuille', 'violet'], couvert: 3 },
  { file: 'b1c0d7f5', items: ['gilet', 'brun+', 'cape', 'feuille', 'violet'], couvert: 3 },
  { file: '7f55339f', items: ['gilet', 'brun+', 'cape'], couvert: 0 },
  { file: '0c6669fb', items: ['gilet', 'brun+', 'cape', 'larme'], couvert: 3 },
];
const SLOTS = 7;

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error('Usage : node scripts/bench-fixtures.mjs <dossier des captures>');
  process.exit(1);
}

const round = (sig) => ({ grid: sig.grid, values: sig.values.map((v) => (v < 0 ? -1 : Math.round(v * 1000) / 1000)) });

/** Image réduite de moitié (moyenne 2×2) : simule une capture à plus basse résolution. */
function half(frame) {
  const w = frame.width >> 1;
  const h = frame.height >> 1;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        const p = (y * 2 * frame.width + x * 2) * 4 + c;
        const q = p + frame.width * 4;
        data[(y * w + x) * 4 + c] = (frame.data[p] + frame.data[p + 4] + frame.data[q] + frame.data[q + 4] + 2) >> 2;
      }
    }
  }
  return { width: w, height: h, data };
}

/** Copie de l'image avec un faux badge jaune peint dans le coin haut-gauche de la zone. */
function withBadge(frame, rect) {
  const data = Uint8Array.from(frame.data);
  const x1 = Math.round(rect.x + rect.w * 0.46);
  const y1 = Math.round(rect.y + rect.h * 0.37);
  for (let y = Math.round(rect.y); y < y1; y++) {
    for (let x = Math.round(rect.x); x < x1; x++) {
      const p = (y * frame.width + x) * 4;
      data[p] = 236;
      data[p + 1] = 196;
      data[p + 2] = 40;
    }
  }
  return { width: frame.width, height: frame.height, data };
}

const crops = [];
let game;
for (const shot of SHOTS) {
  const frame = jpeg.decode(readFileSync(join(dir, `${shot.file}-image.jpg`)), { useTArray: true, maxMemoryUsageInMB: 1024 });
  const area = icons.findGameArea(frame);
  game = { width: frame.width, height: frame.height, ...area };
  const slots = icons.locateBenchSlots(frame.width, frame.height, area.gameTop, area.gameBottom, SLOTS);
  const small = half(frame);
  slots.forEach((rect, slot) => {
    const label = shot.items[slot];
    const crop = {
      shot: shot.file,
      slot,
      item: label ? label.replace('+', '') : null,
      badge: !!label && label.endsWith('+'),
      covered: !!label && slot < shot.couvert,
      signature: round(icons.iconSignature(frame, rect)),
    };
    if (label) {
      // Même icône, capture deux fois plus petite.
      crop.half = round(
        icons.iconSignature(small, { x: rect.x / 2, y: rect.y / 2, w: rect.w / 2, h: rect.h / 2 }),
      );
      // Cadrage décalé de 3 px en diagonale (≈ 2,6 % du côté) : erreur de géométrie plausible.
      crop.shifted = round(icons.iconSignature(frame, { ...rect, x: rect.x + 3, y: rect.y + 3 }));
      // Sans masquer le coin : sert à mesurer ce que coûte le badge.
      crop.unmasked = round(icons.iconSignature(frame, rect, { ignoreCorner: { w: 0, h: 0 } }));
      if (!crop.badge) {
        const fake = withBadge(frame, rect);
        crop.fakeBadge = round(icons.iconSignature(fake, rect));
        crop.fakeBadgeUnmasked = round(icons.iconSignature(fake, rect, { ignoreCorner: { w: 0, h: 0 } }));
      }
    }
    crops.push(crop);
  });
}

const out = {
  note: 'Généré par scripts/bench-fixtures.mjs à partir de 9 captures JPEG non versionnées. Ne pas éditer à la main.',
  game,
  crops,
};
writeFileSync(join(root, 'tests/fixtures/bench.json'), JSON.stringify(out) + '\n');

// Résumé des marges, pour vérifier l'étiquetage d'un coup d'œil.
const items = crops.filter((c) => c.item);
const empties = crops.filter((c) => !c.item);
let within = 0;
let between = Infinity;
for (const a of items) {
  for (const b of items) {
    if (a === b) continue;
    const d = icons.signatureDistance(a.signature, b.signature);
    if (a.item === b.item) within = Math.max(within, d);
    else between = Math.min(between, d);
  }
}
let empty = Infinity;
for (const e of empties) for (const a of items) empty = Math.min(empty, icons.signatureDistance(e.signature, a.signature));
console.log(`${items.length} icônes, ${empties.length} emplacements vides, zone de jeu ${JSON.stringify(game)}`);
console.log(`même objet : max ${within.toFixed(3)} · objets différents : min ${between.toFixed(3)} · vide/objet : min ${empty.toFixed(3)}`);
