import type { Champion } from '../data/types';

export interface ScreenLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ScreenFrame {
  width: number;
  height: number;
  lines: ScreenLine[];
}
export interface ShopRead {
  /** Champions de la boutique, de gauche à droite. */
  shop: Champion[];
  /** Tous les noms de champions repérés à l'écran, boutique comprise. */
  seen: Champion[];
}

/** Compare sans casse, accents, chiffres ni ponctuation : « Rek'Sai 3 » -> « reksai ». */
export function normText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * Repère les noms de champions dans le texte lu à l'écran. La boutique est la rangée
 * horizontale qui en aligne le plus (au moins deux), la plus basse en cas d'égalité.
 */
export function readShop(frame: ScreenFrame, champions: Champion[]): ShopRead {
  const byName = new Map(champions.map((c) => [normText(c.name), c]));
  const hits: { c: Champion; x: number; y: number }[] = [];
  for (const line of frame.lines) {
    const c = byName.get(normText(line.text));
    if (c) hits.push({ c, x: line.x + line.w / 2, y: line.y + line.h / 2 });
  }

  const tolerance = frame.height * 0.03;
  let best: typeof hits = [];
  for (const anchor of hits) {
    const row = hits.filter((h) => Math.abs(h.y - anchor.y) <= tolerance);
    if (row.length > best.length || (row.length === best.length && row.length && anchor.y > best[0].y)) best = row;
  }
  const shop = best.length >= 2 ? best.slice().sort((a, b) => a.x - b.x).map((h) => h.c) : [];
  return { shop, seen: [...new Set(hits.map((h) => h.c))] };
}
