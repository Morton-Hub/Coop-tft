import type { Item } from '../data/types';
import { iconSignature, locateBenchSlots, matchSlot, type IconSignature, type LibraryEntry, type PixelFrame } from './icons';

/*
 * Reconnaissance du banc d'objets : la colonne d'icônes à gauche du jeu est comparée aux icônes
 * officielles des objets (les mêmes textures que celles du jeu, servies par Community Dragon).
 */

export interface BenchRead {
  /** Identifiant canonique de l'objet le plus proche. */
  id: string;
  distance: number;
  runnerUp: number;
  /** Vrai si la ressemblance est assez nette pour être retenue. */
  accepted: boolean;
}

/**
 * Seuils de première intention. Entre captures du même appareil, un même objet reste sous 0,06 et
 * deux objets différents au-dessus de 0,125 ; face aux icônes officielles l'écart sera plus grand,
 * d'où un seuil un peu relevé et l'exigence d'un net avantage sur le deuxième candidat.
 * À recaler avec les distances réelles, enregistrées dans les relevés.
 */
export const ACCEPT_DISTANCE = 0.1;
export const ACCEPT_RATIO = 0.8;

export const isAccepted = (distance: number, runnerUp: number) =>
  distance <= ACCEPT_DISTANCE && distance <= runnerUp * ACCEPT_RATIO;

/** Objets utiles à reconnaître : les composants et tout ce qui se fabrique à partir d'eux. */
export function recognisable(items: Record<string, Item>): string[] {
  const ids = new Set<string>();
  for (const [key, item] of Object.entries(items)) {
    if (item.from?.length !== 2) continue;
    ids.add(key);
    for (const part of item.from) if (items[part]) ids.add(part);
  }
  return [...ids].filter((id) => items[id].icon);
}

/** Lit chaque emplacement de la bande (zone de jeu entière en hauteur, bord gauche à x = 0). */
export function readBench(strip: PixelFrame, library: readonly LibraryEntry[]): BenchRead[] {
  if (!library.length) return [];
  const out: BenchRead[] = [];
  for (const rect of locateBenchSlots(strip.width, strip.height, 0, strip.height)) {
    const m = matchSlot(strip, rect, library, { maxDistance: Infinity });
    if (m) out.push({ id: m.id, distance: m.distance, runnerUp: m.runnerUp, accepted: isAccepted(m.distance, m.runnerUp) });
  }
  return out;
}

/** Nombre d'exemplaires de chaque objet reconnu avec assez de certitude. */
export function benchCounts(reads: BenchRead[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of reads) if (r.accepted) counts[r.id] = (counts[r.id] ?? 0) + 1;
  return counts;
}

/* ---- Partie navigateur : décodage d'images ---- */

function toFrame(image: CanvasImageSource, width: number, height: number): PixelFrame {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function loadImage(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image illisible'));
    img.src = src;
  });
}

/** Image envoyée par la capture (PNG en base64). */
export async function decodeStrip(pngBase64: string): Promise<PixelFrame> {
  const img = await loadImage(`data:image/png;base64,${pngBase64}`, false);
  return toFrame(img, img.naturalWidth, img.naturalHeight);
}

async function referenceFrame(url: string): Promise<PixelFrame> {
  try {
    const img = await loadImage(url, true);
    return toFrame(img, img.naturalWidth, img.naturalHeight);
  } catch {
    // Serveur sans en-tête de partage : on passe par un téléchargement direct.
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob);
    return toFrame(bitmap, bitmap.width, bitmap.height);
  }
}

const LIB_KEY = 'coop-tft:iconlib:v1';

/** Signatures des icônes officielles, calculées une fois par set puis gardées sur l'appareil. */
export async function loadLibrary(setKey: string, items: Record<string, Item>): Promise<{ library: LibraryEntry[]; wanted: number }> {
  const ids = recognisable(items);
  let cache: { setKey: string; entries: Record<string, IconSignature> } = { setKey, entries: {} };
  try {
    const stored = JSON.parse(localStorage.getItem(LIB_KEY) ?? 'null');
    if (stored?.setKey === setKey) cache = stored;
  } catch {
    /* cache illisible */
  }
  let changed = false;
  await Promise.all(
    ids
      .filter((id) => !cache.entries[id])
      .map(async (id) => {
        try {
          const frame = await referenceFrame(items[id].icon!);
          cache.entries[id] = iconSignature(frame, { x: 0, y: 0, w: frame.width, h: frame.height });
          changed = true;
        } catch {
          /* icône indisponible : l'objet ne sera pas reconnu */
        }
      }),
  );
  if (changed) {
    try {
      localStorage.setItem(LIB_KEY, JSON.stringify(cache));
    } catch {
      /* pas de cache */
    }
  }
  return {
    library: ids.filter((id) => cache.entries[id]).map((id) => ({ id, signature: cache.entries[id] })),
    wanted: ids.length,
  };
}
