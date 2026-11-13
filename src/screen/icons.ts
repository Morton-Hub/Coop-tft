/**
 * Reconnaissance d'icônes d'objets par comparaison de couleurs (prototype de faisabilité).
 *
 * Module pur : aucun DOM, aucune dépendance. Il travaille sur des pixels RGBA bruts (ceux d'un
 * `ImageData`, d'un JPEG décodé ou d'un tampon renvoyé par le service natif).
 *
 * Choix de la signature — une grille G×G de couleurs moyennes (G = 8 par défaut) :
 *  - chaque case est la MOYENNE de tous les pixels qu'elle couvre (filtre boîte) : la signature ne
 *    dépend donc presque pas de la résolution de la capture (une icône de 114 px ou de 57 px donne
 *    la même grille), et elle lisse les artefacts JPEG comme le crénelage ;
 *  - on garde la couleur (R, V, B) et pas seulement la luminance : les icônes d'objets de TFT se
 *    distinguent d'abord par leur teinte (feuille verte, larme bleue, cape violette…) ;
 *  - on rogne une marge autour de l'icône (`inset`) pour ne pas dépendre du cadre doré ni d'une
 *    erreur de cadrage de un ou deux pixels ;
 *  - les cases recouvertes par le badge de quantité (coin haut-gauche, jaune avec un chiffre) sont
 *    marquées « ignorées » : elles ne comptent ni dans la signature ni dans la distance ;
 *  - pas de normalisation de contraste : l'interface du jeu n'est pas éclairée par la scène, les
 *    icônes ont toujours les mêmes couleurs, et normaliser ferait ressembler un fond presque uni
 *    (emplacement vide) à n'importe quoi. Les valeurs sont simplement ramenées dans 0..1.
 *
 * Distance : moyenne, sur les cases valides des deux signatures, de l'écart euclidien RVB (ramené
 * dans 0..1), après avoir écarté les cases les plus divergentes (`trim`, 20 % par défaut). Cet
 * écrêtage rend la comparaison tolérante à un recouvrement partiel (panneau de boutique qui mord
 * sur le bord droit de la colonne, reflet, badge plus grand que prévu).
 */

/** Image RGBA brute, 4 octets par pixel, lignes de haut en bas. */
export interface PixelFrame {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SignatureOptions {
  /** Nombre de cases par côté. */
  grid?: number;
  /** Marge rognée de chaque côté, en fraction du côté de la zone. */
  inset?: number;
  /**
   * Coin haut-gauche ignoré (badge de quantité), en fraction du côté de la zone complète.
   * `{ w: 0, h: 0 }` pour ne rien ignorer.
   */
  ignoreCorner?: { w: number; h: number };
}

export interface IconSignature {
  /** Nombre de cases par côté. */
  grid: number;
  /**
   * `grid * grid * 3` valeurs (R, V, B dans 0..1), ligne par ligne. Les cases ignorées valent -1
   * sur leurs trois composantes.
   */
  values: number[];
}

export interface LibraryEntry {
  id: string;
  signature: IconSignature;
}

export interface Match {
  id: string;
  distance: number;
  /** Distance du deuxième meilleur candidat d'un AUTRE identifiant (Infinity s'il n'y en a pas). */
  runnerUp: number;
}

export const DEFAULT_GRID = 8;
export const DEFAULT_INSET = 0.06;
/**
 * Badge de quantité mesuré sur les captures : il couvre environ 46 % de la largeur et 37 % de la
 * hauteur de l'icône, depuis le coin haut-gauche. On prend un peu plus large.
 */
export const DEFAULT_IGNORE_CORNER = { w: 0.5, h: 0.42 };
/** Fraction des cases les plus divergentes écartée du calcul de distance. */
export const DEFAULT_TRIM = 0.2;
/**
 * Seuil de reconnaissance par défaut. Mesuré sur 38 icônes réelles (9 objets, captures JPEG) :
 * même objet ≤ 0,008 (mais jusqu'à 0,056 avec un cadrage décalé de 3 px : voir matchSlot), objets différents ≥ 0,125,
 * emplacement vide ≥ 0,129 — voir tests/icons.test.ts. Le seuil est placé au milieu, côté prudent.
 */
export const DEFAULT_MAX_DISTANCE = 0.06;

/**
 * Signature d'une zone carrée (ou rectangulaire) de l'image. La zone est bornée à l'image ; une
 * zone vide donne une signature entièrement ignorée.
 */
export function iconSignature(frame: PixelFrame, rect: Rect, options: SignatureOptions = {}): IconSignature {
  const grid = Math.max(1, Math.floor(options.grid ?? DEFAULT_GRID));
  const inset = options.inset ?? DEFAULT_INSET;
  const corner = options.ignoreCorner ?? DEFAULT_IGNORE_CORNER;
  const values = new Array<number>(grid * grid * 3).fill(-1);

  // Zone utile, marge retirée.
  const x0 = rect.x + rect.w * inset;
  const y0 = rect.y + rect.h * inset;
  const cw = (rect.w * (1 - 2 * inset)) / grid;
  const ch = (rect.h * (1 - 2 * inset)) / grid;
  // Limites du coin ignoré, en coordonnées image.
  const cornerX = rect.x + rect.w * corner.w;
  const cornerY = rect.y + rect.h * corner.h;

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const left = x0 + gx * cw;
      const top = y0 + gy * ch;
      // Une case est ignorée dès qu'elle touche le coin du badge.
      if (left < cornerX && top < cornerY) continue;
      const xa = Math.max(0, Math.round(left));
      const xb = Math.min(frame.width, Math.max(xa + 1, Math.round(left + cw)));
      const ya = Math.max(0, Math.round(top));
      const yb = Math.min(frame.height, Math.max(ya + 1, Math.round(top + ch)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = ya; y < yb; y++) {
        let p = (y * frame.width + xa) * 4;
        for (let x = xa; x < xb; x++, p += 4) {
          r += frame.data[p];
          g += frame.data[p + 1];
          b += frame.data[p + 2];
          n++;
        }
      }
      if (n === 0) continue;
      const i = (gy * grid + gx) * 3;
      values[i] = r / n / 255;
      values[i + 1] = g / n / 255;
      values[i + 2] = b / n / 255;
    }
  }
  return { grid, values };
}

/**
 * Distance entre deux signatures, dans 0..1 (0 = identiques). Renvoie Infinity si les grilles
 * diffèrent ou si trop peu de cases sont comparables.
 */
export function signatureDistance(a: IconSignature, b: IconSignature, trim: number = DEFAULT_TRIM): number {
  if (a.grid !== b.grid || a.values.length !== b.values.length) return Infinity;
  const cells: number[] = [];
  for (let i = 0; i < a.values.length; i += 3) {
    if (a.values[i] < 0 || b.values[i] < 0) continue;
    const dr = a.values[i] - b.values[i];
    const dg = a.values[i + 1] - b.values[i + 1];
    const db = a.values[i + 2] - b.values[i + 2];
    cells.push(Math.sqrt((dr * dr + dg * dg + db * db) / 3));
  }
  // Il faut au moins un quart de la grille pour conclure.
  if (cells.length < Math.max(1, (a.grid * a.grid) / 4)) return Infinity;
  cells.sort((x, y) => x - y);
  const keep = Math.max(1, Math.round(cells.length * (1 - Math.min(Math.max(trim, 0), 0.9))));
  let sum = 0;
  for (let i = 0; i < keep; i++) sum += cells[i];
  return sum / keep;
}

/** Meilleur candidat de la bibliothèque, avec sa distance, ou undefined si rien n'est assez proche. */
export function bestMatchDetail(
  signature: IconSignature,
  library: readonly LibraryEntry[],
  maxDistance: number = DEFAULT_MAX_DISTANCE,
): Match | undefined {
  let best: Match | undefined;
  for (const entry of library) {
    const d = signatureDistance(signature, entry.signature);
    if (!best) {
      best = { id: entry.id, distance: d, runnerUp: Infinity };
    } else if (d < best.distance) {
      // L'ancien meilleur devient le second, sauf s'il porte le même identifiant.
      best = { id: entry.id, distance: d, runnerUp: entry.id === best.id ? best.runnerUp : best.distance };
    } else if (entry.id !== best.id && d < best.runnerUp) {
      best.runnerUp = d;
    }
  }
  return best && best.distance <= maxDistance ? best : undefined;
}

/** Identifiant de l'entrée la plus proche, ou undefined si rien n'est à moins de `maxDistance`. */
export function bestMatch(
  signature: IconSignature,
  library: readonly LibraryEntry[],
  maxDistance: number = DEFAULT_MAX_DISTANCE,
): string | undefined {
  return bestMatchDetail(signature, library, maxDistance)?.id;
}

/**
 * Géométrie du banc d'objets, mesurée sur 9 captures (zone de jeu 2256 × 1542 px, tablette 4:3
 * environ). Tout est exprimé en fraction de la HAUTEUR de la zone de jeu : l'interface mobile de
 * TFT se met à l'échelle sur la hauteur et la colonne reste collée au bord gauche. Cette hypothèse
 * n'a pu être vérifiée que sur un seul format d'écran.
 *
 * Mesures (px, relatives au coin haut-gauche de la zone de jeu) : icône intérieure 114 × 114 à
 * x = 51, première icône à y = 213, pas vertical 148 ; cadre extérieur 140 px de large à x = 37.
 */
export const BENCH_GEOMETRY = {
  /** Bord gauche de l'icône (hors cadre) / hauteur de jeu. */
  left: 51 / 1542,
  /** Haut de la première icône / hauteur de jeu. */
  top: 213 / 1542,
  /** Côté de l'icône / hauteur de jeu. */
  size: 114 / 1542,
  /** Distance entre deux hauts d'icône / hauteur de jeu. */
  pitch: 148 / 1542,
  /**
   * Nombre d'emplacements renvoyés par défaut : 7 tiennent au-dessus du bouton « Acheter XP ».
   * Les captures n'en montrent jamais plus de 5 remplis ; le comportement au-delà reste à observer.
   */
  slots: 7,
} as const;

/**
 * Rectangles des icônes du banc d'objets (intérieur du cadre doré), de haut en bas, en pixels de
 * l'image complète. `gameTop` / `gameBottom` bornent la zone de jeu (hors bandes noires) ;
 * `gameLeft` vaut 0 quand le jeu occupe toute la largeur, ce qui est le cas des captures étudiées.
 */
export function locateBenchSlots(
  width: number,
  height: number,
  gameTop: number,
  gameBottom: number,
  count: number = BENCH_GEOMETRY.slots,
  gameLeft: number = 0,
): Rect[] {
  const top = Math.max(0, Math.min(gameTop, height));
  const bottom = Math.max(top, Math.min(gameBottom, height));
  const gh = bottom - top;
  const size = BENCH_GEOMETRY.size * gh;
  const slots: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const x = gameLeft + BENCH_GEOMETRY.left * gh;
    const y = top + (BENCH_GEOMETRY.top + i * BENCH_GEOMETRY.pitch) * gh;
    // On s'arrête dès qu'un emplacement sortirait de la zone de jeu ou de l'image.
    if (y + size > bottom || x + size > width) break;
    slots.push({ x, y, w: size, h: size });
  }
  return slots;
}

/**
 * Bornes verticales de la zone de jeu : première et dernière ligne non noire. `gameBottom` est
 * exclu. Renvoie l'image entière si tout est noir.
 */
export function findGameArea(frame: PixelFrame, threshold: number = 16): { gameTop: number; gameBottom: number } {
  // On n'échantillonne qu'environ 256 pixels par ligne : largement assez pour repérer une bande noire.
  const step = Math.max(1, Math.floor(frame.width / 256));
  const lit = (y: number): boolean => {
    let sum = 0;
    let n = 0;
    for (let x = 0; x < frame.width; x += step) {
      const p = (y * frame.width + x) * 4;
      sum += Math.max(frame.data[p], frame.data[p + 1], frame.data[p + 2]);
      n++;
    }
    return n > 0 && sum / n > threshold;
  };
  let top = 0;
  while (top < frame.height && !lit(top)) top++;
  if (top === frame.height) return { gameTop: 0, gameBottom: frame.height };
  let bottom = frame.height;
  while (bottom > top && !lit(bottom - 1)) bottom--;
  return { gameTop: top, gameBottom: bottom };
}


export interface SlotMatchOptions extends SignatureOptions {
  maxDistance?: number;
  /**
   * Amplitude de la recherche d'alignement, en fraction du côté de la zone (0 = aucune). La
   * signature tolère mal un cadrage décalé : 3 px sur 114 font déjà passer la distance d'un même
   * objet de 0,008 à 0,056. On essaie donc plusieurs décalages et on garde le meilleur.
   */
  search?: number;
  /** Nombre de pas de chaque côté : 2 donne 5 × 5 = 25 cadrages essayés. */
  steps?: number;
}

/**
 * Reconnaît l'icône d'un emplacement en tolérant une erreur de cadrage : essaie une petite grille
 * de décalages autour de `rect` et renvoie le meilleur résultat (ou undefined). Le cadrage centré
 * est toujours essayé. Les signatures de la bibliothèque doivent avoir été calculées avec les
 * mêmes options (`grid`, `inset`, `ignoreCorner`).
 */
export function matchSlot(
  frame: PixelFrame,
  rect: Rect,
  library: readonly LibraryEntry[],
  options: SlotMatchOptions = {},
): Match | undefined {
  const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;
  const steps = Math.max(0, Math.floor(options.steps ?? 2));
  const reach = steps === 0 ? 0 : (options.search ?? 0.06) * rect.w;
  let best: Match | undefined;
  for (let iy = -steps; iy <= steps; iy++) {
    for (let ix = -steps; ix <= steps; ix++) {
      const dx = steps === 0 ? 0 : (ix / steps) * reach;
      const dy = steps === 0 ? 0 : (iy / steps) * reach;
      const signature = iconSignature(frame, { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h }, options);
      const found = bestMatchDetail(signature, library, maxDistance);
      if (found && (!best || found.distance < best.distance)) best = found;
    }
  }
  return best;
}
