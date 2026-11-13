import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/units.json';
import type { PixelFrame } from '../src/screen/icons';
import {
  DEFAULT_UNIT_MAX_DISTANCE,
  EMPTY_COVERAGE,
  UNIT_BENCH_GEOMETRY,
  benchLooksForeign,
  isEmptySlot,
  learnBackgroundPalette,
  locateUnitBenchSlots,
  matchUnit,
  unitDistance,
  unitSignature,
  type UnitSignature,
} from '../src/screen/units';

/**
 * Les fixtures viennent de 17 captures réelles (2 parties) : scripts/units-study.mjs --write.
 * Seuls les histogrammes et des étiquettes posées à l'œil sont versionnés, jamais les images.
 */
interface Sample {
  file: string;
  layout: string;
  arena: string;
  slot: number;
  label: string;
  coverage: number;
  histogram: Record<string, number>;
}

const samples = (fixtures as unknown as { samples: Sample[] }).samples;

function signatureOf(sample: Sample): UnitSignature {
  const histogram = new Array<number>(512).fill(0);
  for (const [index, value] of Object.entries(sample.histogram)) histogram[Number(index)] = value;
  return { coverage: sample.coverage, histogram };
}

const HOME_ARENAS = ['plage', 'pierre'];
const unitsOf = (arena: string) => samples.filter((s) => s.arena === arena && s.label !== '-');
const emptiesOf = (arena: string) => samples.filter((s) => s.arena === arena && s.label === '-');

/** Image unie dans laquelle on peint des rectangles. */
function canvas(width: number, height: number, rgb: [number, number, number]): PixelFrame & { data: Uint8Array } {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  return { width, height, data };
}
function paint(frame: PixelFrame & { data: Uint8Array }, x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) frame.data.set([rgb[0], rgb[1], rgb[2], 255], (y * frame.width + x) * 4);
}

describe('géométrie du banc d\'unités', () => {
  it('place 9 emplacements centrés, au pas mesuré sur le format large', () => {
    const slots = locateUnitBenchSlots(2256, 0, 1192);
    expect(slots).toHaveLength(9);
    // Emplacement central : centré sur l'écran ; pas de 155 px ; bande de 1001 à 1168.
    expect(slots[4].x + slots[4].w / 2).toBeCloseTo(1128, 5);
    expect(slots[1].x - slots[0].x).toBeCloseTo(154.96, 1);
    expect(slots[0].x).toBeCloseTo(430.7, 0);
    expect(slots[0].y).toBeCloseTo(1001.3, 0);
    expect(slots[0].y + slots[0].h).toBeCloseTo(1168.2, 0);
  });

  it('suit la hauteur de la zone de jeu sur le format 4:3 à bandes noires', () => {
    const slots = locateUnitBenchSlots(2256, 481, 2023);
    expect(slots[1].x - slots[0].x).toBeCloseTo(UNIT_BENCH_GEOMETRY.pitch * 1542, 5);
    expect(slots[4].x + slots[4].w / 2).toBeCloseTo(1128, 5);
    expect(slots[0].y).toBeCloseTo(481 + 0.84 * 1542, 5);
    // Les emplacements extrêmes débordent sous les boutons latéraux (x < 330 et x > 1925).
    expect(slots[0].x).toBeLessThan(330);
    expect(slots[8].x + slots[8].w).toBeGreaterThan(1925);
  });
});

describe('signature sur image de synthèse', () => {
  const frame = canvas(400, 100, [200, 150, 60]);
  // Décor : fond uni + une rayure claire. Deux « unités » identiques dans deux emplacements, à des
  // positions différentes, et une troisième d'une autre couleur.
  paint(frame, 0, 0, 400, 20, [230, 200, 150]);
  paint(frame, 110, 30, 40, 50, [20, 60, 200]);
  paint(frame, 235, 45, 40, 50, [20, 60, 200]);
  paint(frame, 320, 30, 40, 50, [30, 160, 40]);
  const slot = (i: number) => ({ x: i * 100, y: 0, w: 100, h: 100 });
  const palette = learnBackgroundPalette([{ frame, rects: [slot(0)] }]);

  it('un emplacement vide n\'a pas de premier plan', () => {
    const empty = unitSignature(frame, slot(0), palette);
    expect(empty.coverage).toBe(0);
    expect(isEmptySlot(empty)).toBe(true);
  });

  it('mesure la part occupée par l\'unité', () => {
    expect(unitSignature(frame, slot(1), palette).coverage).toBeCloseTo(0.2, 5);
    // L'échantillonnage un pixel sur deux donne le même résultat.
    expect(unitSignature(frame, slot(1), palette, { step: 2 }).coverage).toBeCloseTo(0.2, 5);
  });

  it('ne dépend pas de la position de l\'unité dans l\'emplacement', () => {
    const a = unitSignature(frame, slot(1), palette);
    const b = unitSignature(frame, slot(2), palette);
    const c = unitSignature(frame, slot(3), palette);
    expect(unitDistance(a, b)).toBeCloseTo(0, 6);
    expect(unitDistance(a, c)).toBeCloseTo(1, 6);
    const library = [
      { id: 'bleue', signature: a },
      { id: 'verte', signature: c },
    ];
    expect(matchUnit(b, library)).toMatchObject({ id: 'bleue', runnerUp: 1 });
    expect(matchUnit(unitSignature(frame, slot(0), palette), library)).toBeUndefined();
  });

  it('une palette apprise sur rien ne masque rien', () => {
    const none = learnBackgroundPalette([]);
    expect(unitSignature(frame, slot(0), none).coverage).toBe(1);
  });

  it('une zone hors image donne une signature vide', () => {
    expect(unitSignature(frame, { x: 500, y: 0, w: 50, h: 50 }, palette).coverage).toBe(0);
  });
});

describe('mesures sur captures réelles (fixtures)', () => {
  it('contient les deux parties étudiées', () => {
    expect(unitsOf('plage').length).toBe(24);
    expect(unitsOf('pierre').length).toBe(27);
    expect(emptiesOf('plage').length + emptiesOf('pierre').length).toBe(71);
  });

  it.each(HOME_ARENAS)('arène « %s » : la même unité est plus proche que deux unités différentes', (arena) => {
    const list = unitsOf(arena);
    let worstSame = 0;
    let bestDiff = 1;
    let same = 0;
    let diff = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const d = unitDistance(signatureOf(list[i]), signatureOf(list[j]));
        if (list[i].label === list[j].label) {
          same++;
          worstSame = Math.max(worstSame, d);
        } else {
          diff++;
          bestDiff = Math.min(bestDiff, d);
        }
      }
    }
    expect(same).toBeGreaterThanOrEqual(36);
    expect(diff).toBeGreaterThanOrEqual(200);
    // Le seuil passe entre les deux populations… avec une marge modeste (0,31 contre 0,40).
    expect(worstSame).toBeLessThan(DEFAULT_UNIT_MAX_DISTANCE);
    expect(bestDiff).toBeGreaterThan(DEFAULT_UNIT_MAX_DISTANCE);
  });

  it.each(HOME_ARENAS)('arène « %s » : chaque unité revue est reconnue à partir des AUTRES captures', (arena) => {
    const list = unitsOf(arena);
    let checked = 0;
    for (const sample of list) {
      // Bibliothèque = tout ce qui a été vu sur les autres images (jamais l'image elle-même).
      const library = list.filter((o) => o.file !== sample.file).map((o) => ({ id: o.label, signature: signatureOf(o) }));
      const found = matchUnit(signatureOf(sample), library);
      if (library.some((e) => e.id === sample.label)) {
        checked++;
        expect(found?.id, `${sample.label} ${sample.file} #${sample.slot}`).toBe(sample.label);
      } else {
        // Unité jamais vue ailleurs : elle doit rester inconnue plutôt que d'être confondue.
        expect(found, `${sample.label} ${sample.file} #${sample.slot}`).toBeUndefined();
      }
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  it('un emplacement vide n\'est jamais pris pour une unité connue', () => {
    for (const arena of HOME_ARENAS) {
      const library = unitsOf(arena).map((o) => ({ id: o.label, signature: signatureOf(o) }));
      for (const empty of emptiesOf(arena)) expect(matchUnit(signatureOf(empty), library)).toBeUndefined();
    }
  });

  it('vide / occupé : séparation presque parfaite, un cas limite connu', () => {
    const empties = HOME_ARENAS.flatMap(emptiesOf);
    const occupied = HOME_ARENAS.flatMap(unitsOf);
    // Toutes les unités dépassent le seuil (la plus fine de peu : 0,040).
    for (const s of occupied) expect(s.coverage).toBeGreaterThan(EMPTY_COVERAGE);
    // Un seul emplacement vide est vu « occupé » : un élément de décor absent de l'image qui a
    // servi à apprendre la palette. Il reste « inconnu » (test précédent), jamais mal identifié.
    const dirty = empties.filter((s) => s.coverage >= EMPTY_COVERAGE);
    expect(dirty.map((s) => `${s.file}#${s.slot}`)).toEqual(['c4ee5caf#0']);
  });

  it('gagner une étoile change l\'aspect : le cristal ★★ n\'est pas reconnu comme le cristal ★', () => {
    for (const arena of HOME_ARENAS) {
      const one = unitsOf(arena).filter((s) => s.label === 'cristal');
      const two = unitsOf(arena).filter((s) => s.label === 'cristal2');
      expect(two.length).toBe(2);
      for (const a of one) for (const b of two) expect(unitDistance(signatureOf(a), signatureOf(b))).toBeGreaterThan(DEFAULT_UNIT_MAX_DISTANCE);
    }
  });

  it('d\'une partie à l\'autre les signatures ne se transposent pas (autre arène, autre palette)', () => {
    let worst = 0;
    for (const a of unitsOf('plage')) for (const b of unitsOf('pierre')) if (a.label === b.label) worst = Math.max(worst, unitDistance(signatureOf(a), signatureOf(b)));
    // La même unité peut être plus loin que le seuil : la bibliothèque doit être refaite à chaque partie.
    expect(worst).toBeGreaterThan(DEFAULT_UNIT_MAX_DISTANCE);
  });

  it('en déplacement rien n\'est reconnu, et le garde-fou ne voit que l\'arène la plus différente', () => {
    const home = (fixtures as unknown as { home: Record<string, string> }).home;
    for (const arena of ['sombre', 'herbe']) {
      const library = unitsOf(home[arena]).map((o) => ({ id: o.label, signature: signatureOf(o) }));
      for (const s of samples.filter((x) => x.arena === arena)) expect(matchUnit(signatureOf(s), library)).toBeUndefined();
    }
    const signatures = (arena: string) => samples.filter((s) => s.arena === arena).map(signatureOf);
    expect(benchLooksForeign(signatures('sombre'))).toBe(true);
    // Limite connue : l'arène d'herbe passe sous le radar.
    expect(benchLooksForeign(signatures('herbe'))).toBe(false);
    // Jamais de fausse alerte à domicile.
    for (const arena of HOME_ARENAS) {
      for (const file of new Set(samples.filter((s) => s.arena === arena).map((s) => s.file))) {
        expect(benchLooksForeign(samples.filter((s) => s.file === file).map(signatureOf))).toBe(false);
      }
    }
  });
});
