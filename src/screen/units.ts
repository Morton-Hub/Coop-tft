/**
 * Reconnaissance des UNITÉS posées sur le banc (prototype de faisabilité, banc uniquement).
 *
 * Module pur : aucun DOM, aucune dépendance. Même convention que `icons.ts` (pixels RGBA bruts).
 *
 * Pourquoi pas la grille de couleurs moyennes de `icons.ts` : une unité est un modèle 3D posé sur
 * le décor. Sur les captures étudiées, la grille 8×8 du même emplacement donne 0,002 entre deux
 * unités DIFFÉRENTES (deux cristaux fins : le décor domine la signature) et jusqu'à 0,110 pour la
 * MÊME unité vue dans deux emplacements (les rayures de la serviette ne tombent pas au même
 * endroit). Elle ne sépare donc rien.
 *
 * Ce qui a fonctionné (mesures dans scripts/units-study.mjs, rejouées par tests/units.test.ts) :
 *  1. apprendre la PALETTE DU DÉCOR sur des emplacements de banc vides (début de partie) : un
 *     histogramme RVB grossier (16 niveaux par canal), dilaté d'un cran pour tolérer le JPEG ;
 *  2. dans un emplacement, ne garder que les pixels dont la couleur est absente de cette palette :
 *     c'est le « premier plan » (l'unité, sa barre de vie, son ombre portée si elle est franche) ;
 *  3. signature = histogramme RVB (8 niveaux par canal) de ce premier plan, rapporté à l'aire de
 *     l'emplacement : il encode les couleurs ET la taille de l'unité, mais pas sa position — la
 *     même unité se reconnaît donc d'un emplacement à l'autre ;
 *  4. distance = écart L1 normalisé entre deux histogrammes, dans 0..1.
 *
 * Limites constatées (voir aussi le rapport de l'étude) :
 *  - valable sur l'arène du joueur uniquement : en déplacement, le décor (donc la palette) et la
 *    caméra changent — `benchLooksForeign` sert à écarter ces images ;
 *  - une unité qui gagne une étoile change d'aspect (le cristal ★★ est plus clair) : elle doit être
 *    réapprise ;
 *  - une unité dont les couleurs sont celles du décor est en partie « mangée » par le masque ;
 *  - validé sur 2 parties, 2 arènes et une dizaine d'unités aux silhouettes très typées : rien ne
 *    garantit la séparation entre deux champions humanoïdes aux teintes voisines ;
 *  - le PLATEAU n'est pas couvert : les signatures apprises sur le banc ne s'y transposent pas.
 */

import type { PixelFrame, Rect } from './icons';

/**
 * Géométrie du banc d'unités, en fraction de la HAUTEUR de la zone de jeu. Le banc est centré
 * horizontalement sur la zone de jeu. Mesuré sur deux formats : zone 2256 × 1192 (10 captures) et
 * 2256 × 1542 (7 captures) ; le pas (155 px et 200 px) vaut 0,130 × hauteur dans les deux cas.
 */
export const UNIT_BENCH_GEOMETRY = {
  /** Distance entre deux centres d'emplacement / hauteur de jeu. */
  pitch: 0.13,
  /** Haut de la zone analysée / hauteur de jeu (sous les barres de vie de la plupart des unités). */
  top: 0.84,
  /** Bas de la zone analysée / hauteur de jeu. */
  bottom: 0.98,
  slots: 9,
} as const;

/**
 * Rectangles des 9 emplacements du banc d'unités, de gauche à droite, en pixels de l'image.
 * `gameLeft` / `gameWidth` bornent la zone de jeu horizontalement (toute la largeur par défaut).
 *
 * Attention, sur le format 4:3 les emplacements 0 et 8 sont en partie masqués par les boutons
 * « Acheter XP » et « or » : ils ne sont pas exploitables.
 */
export function locateUnitBenchSlots(
  width: number,
  gameTop: number,
  gameBottom: number,
  gameLeft: number = 0,
  gameWidth: number = width - gameLeft,
): Rect[] {
  const gh = Math.max(0, gameBottom - gameTop);
  const pitch = UNIT_BENCH_GEOMETRY.pitch * gh;
  const centre = gameLeft + gameWidth / 2;
  const mid = (UNIT_BENCH_GEOMETRY.slots - 1) / 2;
  const y = gameTop + UNIT_BENCH_GEOMETRY.top * gh;
  const h = (UNIT_BENCH_GEOMETRY.bottom - UNIT_BENCH_GEOMETRY.top) * gh;
  const slots: Rect[] = [];
  for (let i = 0; i < UNIT_BENCH_GEOMETRY.slots; i++) {
    slots.push({ x: centre + (i - mid - 0.5) * pitch, y, w: pitch, h });
  }
  return slots;
}

/** Niveaux par canal de la palette du décor (16³ = 4096 cases). */
export const PALETTE_LEVELS = 16;
/** Niveaux par canal de la signature (8³ = 512 cases). */
export const SIGNATURE_LEVELS = 8;
/** Une couleur est « du décor » si sa case (dilatée) pèse au moins cette fraction des pixels appris. */
export const DEFAULT_BACKGROUND_FLOOR = 2e-4;

/** Palette du décor : `PALETTE_LEVELS³` fréquences (0..1), déjà dilatées. */
export interface BackgroundPalette {
  levels: number;
  weights: Float32Array;
}

function clampRect(frame: PixelFrame, rect: Rect): { xa: number; xb: number; ya: number; yb: number } {
  const xa = Math.max(0, Math.round(rect.x));
  const ya = Math.max(0, Math.round(rect.y));
  const xb = Math.min(frame.width, Math.round(rect.x + rect.w));
  const yb = Math.min(frame.height, Math.round(rect.y + rect.h));
  return { xa, xb: Math.max(xa, xb), ya, yb: Math.max(ya, yb) };
}

/**
 * Apprend la palette du décor sur des zones que l'on sait vides (emplacements de banc libres).
 * Plusieurs images peuvent être cumulées en concaténant les entrées.
 */
export function learnBackgroundPalette(samples: readonly { frame: PixelFrame; rects: readonly Rect[] }[]): BackgroundPalette {
  const L = PALETTE_LEVELS;
  const shift = 8 - Math.log2(L);
  const counts = new Float64Array(L * L * L);
  let total = 0;
  for (const { frame, rects } of samples) {
    for (const rect of rects) {
      const { xa, xb, ya, yb } = clampRect(frame, rect);
      for (let y = ya; y < yb; y++) {
        let p = (y * frame.width + xa) * 4;
        for (let x = xa; x < xb; x++, p += 4) {
          counts[((frame.data[p] >> shift) * L + (frame.data[p + 1] >> shift)) * L + (frame.data[p + 2] >> shift)]++;
          total++;
        }
      }
    }
  }
  // Dilatation d'un cran (maximum sur le voisinage 3×3×3) : tolère le bruit JPEG et un léger
  // changement d'éclairage sans élargir la palette au point d'avaler les unités.
  const weights = new Float32Array(L * L * L);
  if (total === 0) return { levels: L, weights };
  for (let r = 0; r < L; r++) {
    for (let g = 0; g < L; g++) {
      for (let b = 0; b < L; b++) {
        let best = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= L) continue;
          for (let dg = -1; dg <= 1; dg++) {
            const gg = g + dg;
            if (gg < 0 || gg >= L) continue;
            for (let db = -1; db <= 1; db++) {
              const bb = b + db;
              if (bb < 0 || bb >= L) continue;
              const v = counts[(rr * L + gg) * L + bb];
              if (v > best) best = v;
            }
          }
        }
        weights[(r * L + g) * L + b] = best / total;
      }
    }
  }
  return { levels: L, weights };
}

export interface UnitSignature {
  /** Part de l'emplacement occupée par le premier plan, 0..1. */
  coverage: number;
  /**
   * Histogramme RVB du premier plan (`SIGNATURE_LEVELS³` cases), chaque case rapportée à l'aire de
   * l'emplacement : la somme vaut `coverage`.
   */
  histogram: number[];
}

export interface UnitSignatureOptions {
  /** Seuil de fréquence sous lequel une couleur n'est plus « du décor ». */
  floor?: number;
  /** Pas d'échantillonnage en pixels (1 = tous les pixels ; 2 suffit et coûte quatre fois moins). */
  step?: number;
}

/** Signature de l'unité occupant `rect`, une fois le décor retiré grâce à `palette`. */
export function unitSignature(
  frame: PixelFrame,
  rect: Rect,
  palette: BackgroundPalette,
  options: UnitSignatureOptions = {},
): UnitSignature {
  const floor = options.floor ?? DEFAULT_BACKGROUND_FLOOR;
  const step = Math.max(1, Math.floor(options.step ?? 1));
  const L = palette.levels;
  const pShift = 8 - Math.log2(L);
  const S = SIGNATURE_LEVELS;
  const sShift = 8 - Math.log2(S);
  const histogram = new Array<number>(S * S * S).fill(0);
  const { xa, xb, ya, yb } = clampRect(frame, rect);
  let seen = 0;
  let kept = 0;
  for (let y = ya; y < yb; y += step) {
    for (let x = xa; x < xb; x += step) {
      const p = (y * frame.width + x) * 4;
      const r = frame.data[p];
      const g = frame.data[p + 1];
      const b = frame.data[p + 2];
      seen++;
      if (palette.weights[((r >> pShift) * L + (g >> pShift)) * L + (b >> pShift)] >= floor) continue;
      histogram[((r >> sShift) * S + (g >> sShift)) * S + (b >> sShift)]++;
      kept++;
    }
  }
  if (seen === 0) return { coverage: 0, histogram };
  for (let i = 0; i < histogram.length; i++) histogram[i] /= seen;
  return { coverage: kept / seen, histogram };
}

/**
 * Distance entre deux signatures, dans 0..1 : 0 = mêmes couleurs en mêmes quantités, 1 = aucune
 * couleur commune. Deux emplacements vides (aucun premier plan) sont à distance 0.
 */
export function unitDistance(a: UnitSignature, b: UnitSignature): number {
  if (a.histogram.length !== b.histogram.length) return 1;
  let diff = 0;
  let sum = 0;
  for (let i = 0; i < a.histogram.length; i++) {
    diff += Math.abs(a.histogram[i] - b.histogram[i]);
    sum += a.histogram[i] + b.histogram[i];
  }
  return sum > 0 ? diff / sum : 0;
}

/**
 * Sous cette couverture, l'emplacement est considéré vide. Mesuré avec une palette apprise sur une
 * ou deux images seulement : 70 emplacements vides sur 71 sont ≤ 0,010 ; le dernier (0,059) contient
 * un élément du décor absent de l'image d'apprentissage. Plus petite unité : 0,040 (une seule, très
 * fine), puis 0,090. Les deux populations se chevauchent donc d'un cas : le seuil privilégie les
 * unités fines, et un décor non appris donne « unité inconnue » plutôt qu'une fausse identification.
 */
export const EMPTY_COVERAGE = 0.036;
/**
 * Distance maximale pour reconnaître une unité. Mesuré sur une même arène (2 parties) : même unité
 * ≤ 0,312 (110 paires, dont 61 entre emplacements différents), unités différentes ≥ 0,403
 * (517 paires), unité contre emplacement vide ≥ 0,748.
 */
export const DEFAULT_UNIT_MAX_DISTANCE = 0.36;

export function isEmptySlot(signature: UnitSignature, threshold: number = EMPTY_COVERAGE): boolean {
  return signature.coverage < threshold;
}

export interface UnitLibraryEntry {
  id: string;
  signature: UnitSignature;
}

export interface UnitMatch {
  id: string;
  distance: number;
  /** Distance du meilleur candidat d'un AUTRE identifiant (Infinity s'il n'y en a pas). */
  runnerUp: number;
}

/**
 * Unité de la bibliothèque la plus proche, ou undefined si l'emplacement est vide ou si rien n'est
 * à moins de `maxDistance`. La bibliothèque se remplit sur l'appareil : à chaque achat, on associe
 * le nom lu dans la boutique à la signature de l'emplacement de banc qui vient de se remplir.
 */
export function matchUnit(
  signature: UnitSignature,
  library: readonly UnitLibraryEntry[],
  maxDistance: number = DEFAULT_UNIT_MAX_DISTANCE,
): UnitMatch | undefined {
  if (isEmptySlot(signature)) return undefined;
  let best: UnitMatch | undefined;
  for (const entry of library) {
    const d = unitDistance(signature, entry.signature);
    if (!best) {
      best = { id: entry.id, distance: d, runnerUp: Infinity };
    } else if (d < best.distance) {
      best = { id: entry.id, distance: d, runnerUp: entry.id === best.id ? best.runnerUp : best.distance };
    } else if (entry.id !== best.id && d < best.runnerUp) {
      best.runnerUp = d;
    }
  }
  return best && best.distance <= maxDistance ? best : undefined;
}

/**
 * Vrai si le banc ne ressemble pas au décor appris : au moins la moitié des emplacements sont
 * presque entièrement « premier plan ». C'est le cas en déplacement sur une arène très différente
 * ou pendant le carrousel : il ne faut alors ni reconnaître ni apprendre. Sur l'arène apprise, la
 * couverture la plus forte observée est 0,60 (une unité qui remplit tout l'emplacement).
 *
 * Garde-fou INSUFFISANT à lui seul : sur les deux images « en déplacement » étudiées, il en signale
 * une (arène sombre) et laisse passer l'autre (arène d'herbe, couvertures 0,14 à 0,75). Aucune
 * unité n'y est mal identifiée, mais aucune n'y est reconnue et les emplacements vides n'y
 * paraissent pas vides. L'appelant doit donc aussi s'appuyer sur la phase de jeu.
 */
export function benchLooksForeign(signatures: readonly UnitSignature[], coverage: number = 0.7): boolean {
  if (signatures.length === 0) return false;
  let foreign = 0;
  for (const s of signatures) if (s.coverage > coverage) foreign++;
  return foreign * 2 >= signatures.length;
}
