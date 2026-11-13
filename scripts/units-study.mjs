// Étude de faisabilité : reconnaître les UNITÉS du banc (et du plateau) par comparaison d'images.
//
//   node scripts/units-study.mjs <dossier des captures> [--write]
//
// Rejoue toutes les mesures de l'étude à partir des captures réelles (JPEG, NON versionnées : elles
// montrent les pseudos d'autres joueurs) et, avec --write, régénère tests/fixtures/units.json — qui
// ne contient que des histogrammes de couleurs et des étiquettes posées à l'œil.
// Le code mesuré est celui de src/screen/units.ts et src/screen/icons.ts, transpilé par esbuild.
//
// Pour ajouter des captures : compléter SHOTS (une ligne par image, une étiquette par emplacement
// de banc) puis relancer. Les étiquettes décrivent ce qu'on voit, pas le nom du champion.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { transform } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function load(name) {
  const source = readFileSync(join(root, 'src/screen', name), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const units = await load('units.ts');
const icons = await load('icons.ts');

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error('Usage : node scripts/units-study.mjs <dossier des captures> [--write]');
  process.exit(1);
}
const WRITE = process.argv.includes('--write');

// ───────────────────────────── Étiquettes ─────────────────────────────
// Une ligne par capture : arène, puis les 9 emplacements du banc de gauche à droite.
//   '-'  vide            '?'  inexploitable (masqué par l'interface, ou étiquette douteuse)
// Unités : oiseau (boule sombre), cristal / cristal2 (le même, 1 et 2 étoiles : plus clair),
// crabe, plante, golem, raptor, abeille, dore, dore43, cheveux, loup, elfe.
// Arènes : plage (partie large, à domicile), sombre (même partie, en déplacement),
// pierre (partie 4:3, à domicile), herbe (partie 4:3, en déplacement).
const SHOTS = [
  // Format large, zone de jeu 2256 × 1192 — une seule partie, étapes 2-3 à 3-6.
  ['2dcda4ca', 'plage', 'oiseau - - - - - - - -'],
  ['e7ef8787', 'plage', 'oiseau - dore - - - - - -'],
  ['90b622f7', 'plage', 'oiseau - cristal - - - - - -'],
  // Emplacement 3 : une seconde abeille aux ailes orange (autre pose ? autre unité ?) : écartée.
  ['3c862525', 'plage', 'oiseau abeille cristal ? - - - - -'],
  ['c4ee5caf', 'plage', '- - cristal - oiseau - - - -'],
  ['971efe2c', 'plage', 'cristal - cristal - oiseau - - - -'],
  ['e0d6691b', 'plage', 'cristal crabe cristal - oiseau - - - -'],
  ['8a0fd686', 'sombre', 'cristal crabe cristal - oiseau - - - -'],
  ['4110c875', 'plage', 'cristal crabe cristal2 - oiseau - - - -'],
  ['2b3d0253', 'plage', 'cristal - cristal2 - oiseau - - - -'],
  // Format 4:3, zone de jeu 2256 × 1542 (lignes 481..2023) — une autre partie.
  ['bb9ca803', 'pierre', '? - raptor plante - - crabe plante ?'],
  ['bd9e6825', 'pierre', '? cristal raptor plante cristal cristal2 golem plante ?'],
  ['3e0a0fbc', 'pierre', '? crabe raptor plante - cristal2 raptor - ?'],
  ['0618b64c', 'herbe', '? crabe - plante oiseau cristal - cristal ?'],
  ['a42e9c6d', 'pierre', '? - - plante oiseau cristal - cristal ?'],
  ['b1c0d7f5', 'pierre', '? cheveux dore43 - oiseau - - - ?'],
  ['0c6669fb', 'pierre', '? cristal loup elfe oiseau - - - ?'],
];
// Doublons exacts fournis par ailleurs (ignorés) : 19882a38 = 90b622f7, 8c4f9da5 = 4110c875,
// 8e24afa1 = 2b3d0253. Non utilisées : 7f55339f (carrousel), 1567dad1 (combat, effets sur le banc).

// Images servant à apprendre la palette du décor (emplacements vides seulement) : ce que
// l'application pourrait faire en début de partie. Les arènes « en déplacement » n'ont pas de
// palette : on leur applique celle du domicile, comme le ferait l'application.
const LEARN = { plage: ['2dcda4ca'], pierre: ['bb9ca803', 'b1c0d7f5'] };
const HOME = { plage: 'plage', sombre: 'plage', pierre: 'pierre', herbe: 'pierre' };

// Plateau (format large, plage) : cases repérées à la main, centre (x, y) en pixels. Les unités n'y
// changent jamais de case d'une capture à l'autre : la mesure « plateau » est donc flatteuse.
const T = 545;
const B = 895;
const BOARD = {
  e7ef8787: [['crabe', 976, T], ['golem', 1128, T], ['abeille', 707, B]],
  '90b622f7': [['crabe', 976, T], ['golem', 1128, T], ['abeille', 711, B], ['cristal', 874, 865]],
  '3c862525': [['crabe', 976, T], ['golem', 1128, T], ['abeille', 707, B], ['cristal-anneau', 880, B]],
  c4ee5caf: [['crabe', 976, T], ['golem', 1128, T], ['plante', 711, B], ['cristal-anneau', 880, B], ['oiseau', 1038, B]],
  '971efe2c': [['crabe', 976, T], ['golem', 1128, T], ['plante', 711, B], ['cristal-anneau', 880, B], ['oiseau', 1038, B]],
  '4110c875': [['crabe', 976, T], ['golem', 1128, T], ['plante', 711, B], ['cristal-anneau', 880, B], ['oiseau', 1038, B]],
  '2b3d0253': [['crabe', 976, T], ['golem', 1128, T], ['crabe', 1275, T], ['plante', 711, B], ['cristal-anneau', 880, B], ['oiseau', 1038, B]],
};
const BOARD_R = 78;
const BOARD_EMPTY = [['2dcda4ca', [711, 880, 1038, 1200, 1360], B], ['e7ef8787', [1275, 1425], T]];

// ───────────────────────────── Outils ─────────────────────────────
const cache = new Map();
function frameOf(file) {
  if (!cache.has(file)) {
    const path = join(dir, file + '-image.jpg');
    if (!existsSync(path)) return undefined;
    cache.set(file, jpeg.decode(readFileSync(path), { useTArray: true, maxMemoryUsageInMB: 2048 }));
  }
  return cache.get(file);
}
function slotsOf(frame) {
  const area = icons.findGameArea(frame);
  return { area, slots: units.locateUnitBenchSlots(frame.width, area.gameTop, area.gameBottom) };
}
const fmt = (v) => v.toFixed(3);
function summary(values) {
  if (values.length === 0) return 'n=0';
  const s = [...values].sort((a, b) => a - b);
  return `n=${s.length}  min ${fmt(s[0])}  médiane ${fmt(s[s.length >> 1])}  max ${fmt(s[s.length - 1])}`;
}
function pairs(list, distance) {
  const out = { same: [], sameOtherSlot: [], diff: [] };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const d = distance(list[i], list[j]);
      if (list[i].label === list[j].label) {
        out.same.push(d);
        if (list[i].slot !== list[j].slot) out.sameOtherSlot.push(d);
      } else out.diff.push(d);
    }
  }
  return out;
}
function report(title, list, distance, empties = []) {
  const p = pairs(list, distance);
  console.log(title);
  console.log('   même unité                 ' + summary(p.same));
  console.log('   … emplacements différents  ' + summary(p.sameOtherSlot));
  console.log('   unités différentes         ' + summary(p.diff));
  if (empties.length) {
    const e = [];
    for (const u of list) for (const v of empties) e.push(distance(u, v));
    console.log('   unité / emplacement vide   ' + summary(e));
  }
  // Plus proche voisin en retirant l'échantillon lui-même (unités vues au moins deux fois).
  let ok = 0;
  let n = 0;
  for (const a of list) {
    if (!list.some((b) => b !== a && b.label === a.label)) continue;
    let best;
    for (const b of list) if (b !== a && (!best || distance(a, b) < distance(a, best))) best = b;
    n++;
    if (best.label === a.label) ok++;
  }
  console.log(`   plus proche voisin correct  ${ok}/${n}`);
  return p;
}

// ───────────────────────────── 1. Banc ─────────────────────────────
const palettes = {};
for (const [arena, files] of Object.entries(LEARN)) {
  const samples = [];
  for (const file of files) {
    const frame = frameOf(file);
    if (!frame) continue;
    const labels = SHOTS.find((s) => s[0] === file)[2].split(' ');
    const { slots } = slotsOf(frame);
    samples.push({ frame, rects: slots.filter((_, i) => labels[i] === '-') });
  }
  if (samples.length) palettes[arena] = units.learnBackgroundPalette(samples);
}

const bench = [];
for (const [file, arena, line] of SHOTS) {
  const frame = frameOf(file);
  if (!frame) {
    console.warn('capture absente : ' + file);
    continue;
  }
  const palette = palettes[HOME[arena]];
  if (!palette) continue;
  const { area, slots } = slotsOf(frame);
  const labels = line.split(' ');
  const gh = area.gameBottom - area.gameTop;
  const layout = frame.width / gh > 1.6 ? 'large' : '4:3';
  slots.forEach((rect, slot) => {
    const sig = units.unitSignature(frame, rect, palette);
    const grid = icons.iconSignature(frame, rect, { inset: 0, ignoreCorner: { w: 0, h: 0 } });
    bench.push({ file, arena, layout, slot, label: labels[slot], sig, grid });
  });
}
const usable = bench.filter((s) => s.label !== '?');
const isUnit = (s) => s.label !== '-';
const dHist = (a, b) => units.unitDistance(a.sig, b.sig);
const dGrid = (a, b) => icons.signatureDistance(a.grid, b.grid);

console.log('════ 1. BANC ════');
for (const arena of ['plage', 'pierre']) {
  const here = usable.filter((s) => s.arena === arena);
  const u = here.filter(isUnit);
  const e = here.filter((s) => !isUnit(s));
  console.log(`\n── arène « ${arena} » : ${u.length} unités étiquetées, ${e.length} emplacements vides ──`);
  console.log('   couverture des vides       ' + summary(e.map((s) => s.sig.coverage)));
  console.log('   couverture des unités      ' + summary(u.map((s) => s.sig.coverage)));
  for (const s of e.filter((x) => x.sig.coverage > 0.01)) console.log(`      vide « sale » : ${s.file} emplacement ${s.slot} couverture ${fmt(s.sig.coverage)}`);
  for (const s of u.filter((x) => x.sig.coverage < 0.1)) console.log(`      petite unité : ${s.label} ${s.file} emplacement ${s.slot} couverture ${fmt(s.sig.coverage)}`);
  report(' histogramme du premier plan (units.ts)', u, dHist, e);
  report(' grille 8×8 de icons.ts (référence, sans retrait du décor)', u, dGrid, e);
}
{
  const home = usable.filter((s) => (s.arena === 'plage' || s.arena === 'pierre') && isUnit(s));
  const cross = { same: [], diff: [] };
  for (const a of home) for (const b of home) if (a.arena === 'plage' && b.arena === 'pierre') (a.label === b.label ? cross.same : cross.diff).push(dHist(a, b));
  console.log('\n── d\'une partie à l\'autre (plage ↔ pierre : autre arène, autre format) ──');
  console.log('   même unité                 ' + summary(cross.same));
  console.log('   unités différentes         ' + summary(cross.diff));
}
console.log('\n── en déplacement (palette du domicile appliquée telle quelle) ──');
for (const arena of ['sombre', 'herbe']) {
  const here = bench.filter((s) => s.arena === arena);
  if (!here.length) continue;
  const cov = here.filter((s) => s.label !== '?').map((s) => s.sig.coverage);
  console.log(`   ${arena} : couverture ${summary(cov)} → benchLooksForeign = ${units.benchLooksForeign(here.filter((s) => s.label !== '?').map((s) => s.sig))}`);
  const lib = usable.filter((s) => s.arena === HOME[arena] && isUnit(s)).map((s) => ({ id: s.label, signature: s.sig }));
  let ok = 0;
  let wrong = 0;
  let n = 0;
  for (const s of here.filter((x) => x.label !== '?')) {
    const found = units.matchUnit(s.sig, lib)?.id;
    if (isUnit(s)) {
      n++;
      if (found === s.label) ok++;
    }
    if (found !== undefined && found !== s.label) wrong++;
  }
  console.log(`      avec la bibliothèque du domicile : ${ok}/${n} unités reconnues, ${wrong} emplacements mal identifiés`);
}
for (const arena of ['plage', 'pierre']) {
  const here = bench.filter((s) => s.arena === arena);
  const files = [...new Set(here.map((s) => s.file))];
  const flagged = files.filter((f) => units.benchLooksForeign(here.filter((s) => s.file === f && s.label !== '?').map((s) => s.sig)));
  console.log(`   ${arena} (domicile) : ${flagged.length}/${files.length} images signalées à tort`);
}

// ───────────────────────────── 2. Plateau ─────────────────────────────
console.log('\n════ 2. PLATEAU (format large, plage, cases repérées à la main) ════');
{
  const box = (x, y) => ({ x: x - BOARD_R, y: y - BOARD_R, w: 2 * BOARD_R, h: 2 * BOARD_R });
  const samples = [];
  for (const [file, xs, y] of BOARD_EMPTY) {
    const frame = frameOf(file);
    if (frame) samples.push({ frame, rects: xs.map((x) => box(x, y)) });
  }
  if (samples.length === BOARD_EMPTY.length) {
    const palette = units.learnBackgroundPalette(samples);
    // Sur le plateau la taille apparente dépend de la rangée : on compare la FORME de
    // l'histogramme (somme ramenée à 1), sur le banc comme sur le plateau.
    const shape = (sig) => ({ coverage: 1, histogram: sig.histogram.map((v) => (sig.coverage > 0 ? v / sig.coverage : 0)) });
    const board = [];
    for (const [file, list] of Object.entries(BOARD)) {
      const frame = frameOf(file);
      if (!frame) continue;
      for (const [label, x, y] of list) board.push({ file, label, slot: `${x},${y}`, sig: shape(units.unitSignature(frame, box(x, y), palette)) });
    }
    report(' plateau ↔ plateau', board, dHist);
    const lib = usable.filter((s) => s.arena === 'plage' && isUnit(s)).map((s) => ({ ...s, sig: shape(s.sig) }));
    const same = [];
    const diff = [];
    const byLabel = {};
    for (const b of board) {
      for (const a of lib) {
        const d = dHist(a, b);
        if (a.label === b.label) {
          same.push(d);
          (byLabel[b.label] ??= []).push(d);
        } else diff.push(d);
      }
    }
    console.log(' appris sur le banc → reconnu sur le plateau');
    console.log('   même unité                 ' + summary(same));
    for (const [label, v] of Object.entries(byLabel)) console.log(`      ${label.padEnd(10)} ${summary(v)}`);
    console.log('   unités différentes         ' + summary(diff));
  } else console.log(' captures absentes');
}

// ───────────────────────────── 3. Panneau « Dégâts infligés » ─────────────────────────────
console.log('\n════ 3. PORTRAITS DU PANNEAU DE DÉGÂTS (8a0fd686) ════');
{
  const frame = frameOf('8a0fd686');
  if (frame) {
    // Mesuré à l'œil sur cette seule image (zone de jeu 2256 × 1192) : cadre de 52 px, bord gauche
    // à 253 px du bord droit, premier cadre à y = 308, pas vertical 70 px, 5 lignes visibles.
    // Les étoiles recouvrent le bas du portrait : on ne signe que les 72 % du haut, cadre exclu.
    const rects = [0, 1, 2, 3, 4].map((i) => ({ x: frame.width - 253 + 4, y: 308 + 4 + i * 69.8, w: 44, h: 32 }));
    const sigs = rects.map((r) => icons.iconSignature(frame, r, { inset: 0, ignoreCorner: { w: 0, h: 0 } }));
    const d = [];
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) d.push(icons.signatureDistance(sigs[i], sigs[j]));
    console.log('   5 portraits, tous différents — distances iconSignature : ' + summary(d));
    const shifted = rects.map((r) => icons.iconSignature(frame, { ...r, x: r.x + 2, y: r.y + 2 }, { inset: 0, ignoreCorner: { w: 0, h: 0 } }));
    console.log('   même portrait, cadrage décalé de 2 px : ' + summary(sigs.map((s, i) => icons.signatureDistance(s, shifted[i]))));
  } else console.log(' capture absente');
}

// ───────────────────────────── Fixtures ─────────────────────────────
if (WRITE) {
  const round = (v) => Math.round(v * 1e5) / 1e5;
  const out = bench
    .filter((s) => s.label !== '?')
    .map((s) => {
      const histogram = {};
      s.sig.histogram.forEach((v, i) => {
        if (round(v) > 0) histogram[i] = round(v);
      });
      return { file: s.file, layout: s.layout, arena: s.arena, slot: s.slot, label: s.label, coverage: round(s.sig.coverage), histogram };
    });
  const path = join(root, 'tests/fixtures/units.json');
  writeFileSync(
    path,
    JSON.stringify(
      {
        note: 'Généré par scripts/units-study.mjs --write. Histogrammes creux (indice de case → part de l\'emplacement) ; étiquettes posées à l\'œil.',
        home: HOME,
        samples: out,
      },
      null,
      0,
    ).replace(/\{"file"/g, '\n{"file"') + '\n',
  );
  console.log(`\n${out.length} signatures écrites dans ${path}`);
}
