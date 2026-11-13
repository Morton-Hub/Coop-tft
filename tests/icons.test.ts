import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/bench.json';
import {
  BENCH_GEOMETRY,
  DEFAULT_MAX_DISTANCE,
  bestMatch,
  bestMatchDetail,
  findGameArea,
  iconSignature,
  locateBenchSlots,
  matchSlot,
  signatureDistance,
  type IconSignature,
  type LibraryEntry,
  type PixelFrame,
} from '../src/screen/icons';

/**
 * Les signatures de tests/fixtures/bench.json viennent de 9 captures réelles (JPEG, zone de jeu
 * 2256 × 1542 px), fabriquées par scripts/bench-fixtures.mjs. 38 icônes de 9 objets distincts
 * (8 vus plusieurs fois, « ceinture » une seule fois) et 25 emplacements vides.
 *
 * Marges mesurées (distance 0..1, seuil 0,06) — le test « marges » les réaffiche :
 *   même objet, captures différentes ........ max 0,008
 *   même objet, capture réduite de moitié .... max 0,010
 *   même objet, cadrage décalé de 3 px ....... max 0,056  (point faible : voir matchSlot)
 *   objets différents ........................ min 0,125
 *   emplacement vide contre un objet ......... min 0,129
 *
 * Le cadrage est le point sensible : 3 px d'erreur sur 114 consomment presque toute la marge.
 * `matchSlot` y répond en essayant 25 cadrages voisins. Mesuré hors test sur les captures (les
 * pixels ne sont pas versionnés) : avec des décalages de 3 à 7 px, 37 icônes sur 37 reconnues à
 * partir des autres captures, distance ≤ 0,028, aucun faux positif sur les 25 emplacements vides.
 */

interface Crop {
  shot: string;
  slot: number;
  item: string | null;
  badge: boolean;
  covered: boolean;
  signature: IconSignature;
  half?: IconSignature;
  shifted?: IconSignature;
  unmasked?: IconSignature;
  fakeBadge?: IconSignature;
  fakeBadgeUnmasked?: IconSignature;
}

const crops = fixtures.crops as Crop[];
const items = crops.filter((c) => c.item !== null);
const empties = crops.filter((c) => c.item === null);
const names = [...new Set(items.map((c) => c.item as string))];

/** Bibliothèque faite de toutes les icônes sauf celles de la capture `shot`. */
function libraryWithout(shot: string): LibraryEntry[] {
  return items.filter((c) => c.shot !== shot).map((c) => ({ id: c.item as string, signature: c.signature }));
}
const fullLibrary: LibraryEntry[] = items.map((c) => ({ id: c.item as string, signature: c.signature }));

function pairs(): { within: number[]; between: number[] } {
  const within: number[] = [];
  const between: number[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const d = signatureDistance(items[i].signature, items[j].signature);
      (items[i].item === items[j].item ? within : between).push(d);
    }
  }
  return { within, between };
}

describe('banc d’objets : icônes réelles', () => {
  it('le jeu de données couvre bien ce qu’on prétend', () => {
    expect(items.length).toBe(38);
    expect(empties.length).toBe(25);
    expect(names.length).toBe(9);
    // Huit objets apparaissent dans au moins deux captures.
    expect(names.filter((n) => items.filter((c) => c.item === n).length >= 2).length).toBe(8);
  });

  it('marges : même objet loin en dessous du seuil, objets différents loin au-dessus', () => {
    const { within, between } = pairs();
    const maxWithin = Math.max(...within);
    const minBetween = Math.min(...between);
    const minEmpty = Math.min(
      ...empties.flatMap((e) => items.map((c) => signatureDistance(e.signature, c.signature))),
    );
    const maxHalf = Math.max(...items.map((c) => signatureDistance(c.signature, c.half as IconSignature)));
    const maxShift = Math.max(...items.map((c) => signatureDistance(c.signature, c.shifted as IconSignature)));
    console.info(
      [
        `marges mesurées (seuil ${DEFAULT_MAX_DISTANCE}) :`,
        `  même objet (${within.length} paires) : max ${maxWithin.toFixed(3)}`,
        `  demi-résolution : max ${maxHalf.toFixed(3)} · cadrage décalé de 3 px : max ${maxShift.toFixed(3)}`,
        `  objets différents (${between.length} paires) : min ${minBetween.toFixed(3)}`,
        `  emplacement vide contre objet : min ${minEmpty.toFixed(3)}`,
      ].join('\n'),
    );
    expect(maxWithin).toBeLessThan(DEFAULT_MAX_DISTANCE / 2);
    expect(maxShift).toBeLessThan(DEFAULT_MAX_DISTANCE);
    expect(minBetween).toBeGreaterThan(DEFAULT_MAX_DISTANCE * 1.5);
    expect(minEmpty).toBeGreaterThan(DEFAULT_MAX_DISTANCE * 1.5);
    // Bien cadré, l'écart est très large : plus d'un facteur 10 entre le pire « même » et le meilleur « autre ».
    expect(Math.min(minBetween, minEmpty) / maxWithin).toBeGreaterThan(10);
  });

  it('chaque icône retrouve son objet à partir des AUTRES captures', () => {
    for (const crop of items) {
      const library = libraryWithout(crop.shot);
      const known = library.some((e) => e.id === crop.item);
      // « ceinture » n'existe que dans une capture : sans référence, elle ne doit rien reconnaître.
      expect(bestMatch(crop.signature, library), `${crop.shot} #${crop.slot} ${crop.item}`).toBe(
        known ? crop.item : undefined,
      );
    }
  });

  it('un emplacement vide n’est jamais pris pour un objet', () => {
    for (const empty of empties) {
      expect(bestMatch(empty.signature, fullLibrary), `${empty.shot} #${empty.slot}`).toBeUndefined();
    }
  });

  it('le panneau de boutique qui mord sur la colonne ne gêne pas', () => {
    const covered = items.filter((c) => c.covered);
    expect(covered.length).toBeGreaterThanOrEqual(10);
    for (const crop of covered) {
      const clear = items.filter((c) => c.item === crop.item && !c.covered);
      for (const other of clear) {
        expect(signatureDistance(crop.signature, other.signature)).toBeLessThan(DEFAULT_MAX_DISTANCE / 2);
      }
    }
  });

  it('une capture deux fois plus petite ou un cadrage décalé donnent le même objet', () => {
    for (const crop of items) {
      expect(bestMatch(crop.half as IconSignature, fullLibrary)).toBe(crop.item);
      expect(bestMatch(crop.shifted as IconSignature, fullLibrary)).toBe(crop.item);
    }
  });

  it('le badge de quantité ne casse pas la reconnaissance', () => {
    // Badges réels : l'objet « brun » porte un 3, un 4 ou un 5 selon la capture.
    const brun = items.filter((c) => c.item === 'brun');
    expect(brun.every((c) => c.badge)).toBe(true);
    expect(brun.length).toBe(9);
    for (const a of brun) for (const b of brun) expect(signatureDistance(a.signature, b.signature)).toBeLessThan(0.02);

    // Badge simulé : un rectangle jaune peint sur les icônes qui n'en ont pas.
    let worstMasked = 0;
    let worstUnmasked = 0;
    for (const crop of items.filter((c) => !c.badge)) {
      const masked = signatureDistance(crop.signature, crop.fakeBadge as IconSignature);
      const unmasked = signatureDistance(crop.unmasked as IconSignature, crop.fakeBadgeUnmasked as IconSignature, 0);
      worstMasked = Math.max(worstMasked, masked);
      worstUnmasked = Math.max(worstUnmasked, unmasked);
      expect(bestMatch(crop.fakeBadge as IconSignature, fullLibrary)).toBe(crop.item);
    }
    console.info(
      `badge simulé : écart max ${worstMasked.toFixed(3)} coin ignoré, ${worstUnmasked.toFixed(3)} sans l’ignorer ni écrêter`,
    );
    // Coin ignoré : le badge est invisible. Sans masque ni écrêtage, il pèserait plus que le seuil.
    expect(worstMasked).toBeLessThan(0.005);
    expect(worstUnmasked).toBeGreaterThan(DEFAULT_MAX_DISTANCE);
  });

  it('bestMatchDetail donne la distance et le second candidat', () => {
    const crop = items.find((c) => c.item === 'larme') as Crop;
    const detail = bestMatchDetail(crop.signature, libraryWithout(crop.shot));
    expect(detail?.id).toBe('larme');
    expect(detail?.distance).toBeLessThan(0.02);
    expect(detail?.runnerUp).toBeGreaterThan(0.1);
  });
});

describe('géométrie du banc', () => {
  it('retrouve les mesures faites sur les captures', () => {
    const { width, height, gameTop, gameBottom } = fixtures.game;
    const slots = locateBenchSlots(width, height, gameTop, gameBottom);
    expect(slots.length).toBe(BENCH_GEOMETRY.slots);
    expect(slots[0]).toEqual({ x: 51, y: gameTop + 213, w: 114, h: 114 });
    expect(slots[1].y - slots[0].y).toBeCloseTo(148, 6);
  });

  it('suit la taille de la zone de jeu, pas celle de l’image', () => {
    // Même zone de jeu, deux fois plus petite et sans bandes noires.
    const slots = locateBenchSlots(1128, 771, 0, 771);
    expect(slots[0].x).toBeCloseTo(25.5, 6);
    expect(slots[0].y).toBeCloseTo(106.5, 6);
    expect(slots[0].w).toBeCloseTo(57, 6);
    // Zone trop petite pour le nombre demandé : on ne sort pas de la zone de jeu.
    const many = locateBenchSlots(2256, 2504, 481, 2023, 20);
    expect(many.length).toBe(9);
    expect(many[many.length - 1].y + many[many.length - 1].h).toBeLessThanOrEqual(2023);
  });
});

/** Image de synthèse : bandes noires en haut et en bas, motif coloré déterministe au milieu. */
function synthetic(width: number, height: number, top: number, bottom: number): PixelFrame {
  const data = new Uint8Array(width * height * 4);
  for (let y = top; y < bottom; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      // Motif défini en coordonnées relatives : identique quelle que soit la résolution.
      const u = x / width;
      const v = (y - top) / (bottom - top);
      data[p] = 40 + 200 * u;
      data[p + 1] = 40 + 200 * v;
      data[p + 2] = 128 + 100 * Math.sin(6 * u) * Math.cos(5 * v);
      data[p + 3] = 255;
    }
  }
  return { width, height, data };
}

describe('signature : propriétés', () => {
  it('trouve la zone de jeu entre les bandes noires', () => {
    expect(findGameArea(synthetic(200, 300, 60, 240))).toEqual({ gameTop: 60, gameBottom: 240 });
    const black: PixelFrame = { width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) };
    expect(findGameArea(black)).toEqual({ gameTop: 0, gameBottom: 8 });
  });

  it('ne dépend presque pas de l’échelle', () => {
    const big = synthetic(400, 400, 0, 400);
    const small = synthetic(100, 100, 0, 100);
    const a = iconSignature(big, { x: 0, y: 0, w: 400, h: 400 });
    const b = iconSignature(small, { x: 0, y: 0, w: 100, h: 100 });
    expect(signatureDistance(a, b)).toBeLessThan(0.01);
  });

  it('ignore les cases du coin et refuse les grilles incompatibles', () => {
    const frame = synthetic(128, 128, 0, 128);
    const rect = { x: 0, y: 0, w: 128, h: 128 };
    const masked = iconSignature(frame, rect, { grid: 8, inset: 0, ignoreCorner: { w: 0.5, h: 0.5 } });
    // 4 × 4 cases sur 64 sont ignorées.
    expect(masked.values.filter((v) => v < 0).length).toBe(16 * 3);
    const full = iconSignature(frame, rect, { grid: 8, inset: 0, ignoreCorner: { w: 0, h: 0 } });
    expect(full.values.every((v) => v >= 0)).toBe(true);
    expect(signatureDistance(masked, full)).toBe(0);
    expect(signatureDistance(full, iconSignature(frame, rect, { grid: 4 }))).toBe(Infinity);
  });

  it('matchSlot rattrape une erreur de cadrage que la comparaison directe ne tolère pas', () => {
    // Deux « icônes » très texturées posées dans une image, sur fond gris.
    const data = new Uint8Array(400 * 200 * 4).fill(90);
    const frame: PixelFrame = { width: 400, height: 200, data };
    const paint = (x0: number, seed: number): void => {
      for (let y = 0; y < 120; y++) {
        for (let x = 0; x < 120; x++) {
          const p = ((40 + y) * 400 + x0 + x) * 4;
          data[p] = 128 + 120 * Math.sin((x * seed) / 23 + y / 9);
          data[p + 1] = 128 + 120 * Math.cos((y * seed) / 17);
          data[p + 2] = 128 + 120 * Math.sin((x + y) / (7 * seed));
        }
      }
    };
    paint(40, 1);
    paint(240, 2);
    const a = { x: 40, y: 40, w: 120, h: 120 };
    const b = { x: 240, y: 40, w: 120, h: 120 };
    const library: LibraryEntry[] = [
      { id: 'a', signature: iconSignature(frame, a) },
      { id: 'b', signature: iconSignature(frame, b) },
    ];
    const off = { ...a, x: a.x + 7, y: a.y - 7 };
    // Décalé de 7 px (6 %), la comparaison directe échoue…
    expect(bestMatch(iconSignature(frame, off), library)).toBeUndefined();
    // … la recherche d'alignement retrouve l'icône, sans la confondre avec l'autre.
    expect(matchSlot(frame, off, library)?.id).toBe('a');
    expect(matchSlot(frame, { ...b, x: b.x - 5 }, library)?.id).toBe('b');
    // Fond uni : rien à reconnaître, même en cherchant.
    expect(matchSlot(frame, { x: 170, y: 40, w: 60, h: 60 }, library)).toBeUndefined();
    // steps = 0 : équivalent à la comparaison directe.
    expect(matchSlot(frame, off, library, { steps: 0 })).toBeUndefined();
  });

  it('bibliothèque vide ou zone hors image : aucun résultat, aucune exception', () => {
    const frame = synthetic(32, 32, 0, 32);
    const outside = iconSignature(frame, { x: 500, y: 500, w: 20, h: 20 });
    expect(bestMatch(outside, [])).toBeUndefined();
    expect(signatureDistance(outside, outside)).toBe(Infinity);
  });
});
