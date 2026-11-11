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
  /** Position de la rangée de boutique dans l'image, quand elle est repérée. */
  row?: { y: number; x0: number; x1: number };
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
  const row = shop.length
    ? { y: best.reduce((t, h) => t + h.y, 0) / best.length, x0: Math.min(...best.map((h) => h.x)), x1: Math.max(...best.map((h) => h.x)) }
    : undefined;
  return { shop, seen: [...new Set(hits.map((h) => h.c))], row };
}

export type GameState = 'none' | 'lobby' | 'game';
/** Textes du menu principal de TFT (interface en français ou en anglais). */
const LOBBY_WORDS = ['jouer', 'boutique', 'passedecombat', 'equipements', 'play', 'battlepass', 'store'];

/**
 * Dit si TFT est visible à l'écran : en partie dès qu'une boutique ou deux noms de champions
 * sont lus, au menu si au moins deux libellés du menu principal apparaissent.
 */
export function detectGame(frame: ScreenFrame, champions: Champion[]): GameState {
  const read = readShop(frame, champions);
  if (read.shop.length || read.seen.length >= 2) return 'game';
  const texts = new Set(frame.lines.map((l) => normText(l.text)));
  return LOBBY_WORDS.filter((w) => texts.has(w)).length >= 2 ? 'lobby' : 'none';
}

export interface Hud {
  stage?: string;
  level?: number;
  gold?: number;
  hp?: number;
  /** Probabilités de boutique affichées par le jeu pour le niveau actuel (coûts 1 à 5, en %). */
  odds?: number[];
}

const center = (l: ScreenLine) => ({ x: l.x + l.w / 2, y: l.y + l.h / 2 });

/** Pseudo affiché au menu principal (« Nom#TAG »), pour retrouver ensuite ses PV dans la liste des joueurs. */
export function readPlayerName(frame: ScreenFrame): string | undefined {
  for (const l of frame.lines) {
    const m = /^(.{3,16})#[A-Za-z0-9]{2,5}$/.exec(l.text.trim());
    if (m) return m[1].trim();
  }
  return undefined;
}

/**
 * Lit manche, niveau, or, PV et probabilités de boutique dans le texte de l'écran.
 * Règles calées sur l'interface du Set 18 :
 * - manche : un texte de la forme « 3-2 » ;
 * - niveau : « Lvl. 8 », « Niv. 8 », « Niveau 8 » ;
 * - barre du bas, sur la ligne du niveau : « Lvl. 8  15/68  15% 20% 32% 30% 3%  31  15 » ;
 *   les cinq pourcentages sont les probabilités de boutique, le premier nombre isolé qui suit est l'or
 *   (le suivant est la série) ;
 * - PV : dans la colonne des joueurs à droite, sa propre ligne est écrite plus gros et sans pseudo.
 */
export function readHud(frame: ScreenFrame): Hud {
  const hud: Hud = {};
  const numbers: { v: number; x: number; y: number; h: number }[] = [];
  let levelLine: ScreenLine | undefined;
  for (const l of frame.lines) {
    const text = l.text.trim();
    const stage = /^([1-9])\s*[-–]\s*([1-7])$/.exec(text);
    if (stage && !hud.stage) hud.stage = `${stage[1]}-${stage[2]}`;
    const level = /\b(?:niv(?:eau)?|lvl?|level)\.?\s*(\d{1,2})\b/i.exec(text);
    if (level && !hud.level && Number(level[1]) >= 1 && Number(level[1]) <= 10) {
      hud.level = Number(level[1]);
      levelLine = l;
    }
    if (/^\d{1,3}$/.test(text)) numbers.push({ v: Number(text), ...center(l), h: l.h });
  }

  if (levelLine) {
    const lc = center(levelLine);
    const sameRow = (y: number) => Math.abs(y - lc.y) <= levelLine!.h * 1.5;
    // Les pourcentages peuvent être lus en un seul bloc ou un par un.
    const percents: { v: number; x: number }[] = [];
    for (const l of frame.lines) {
      if (!sameRow(center(l).y)) continue;
      const found = [...l.text.matchAll(/(\d{1,3})\s*%/g)];
      found.forEach((m, k) => percents.push({ v: Number(m[1]), x: l.x + (l.w * (k + 0.5)) / found.length }));
    }
    percents.sort((a, b) => a.x - b.x);
    const sum = percents.reduce((t, p) => t + p.v, 0);
    if (percents.length === 5 && sum >= 95 && sum <= 105) hud.odds = percents.map((p) => p.v);

    const after = percents.length ? percents[percents.length - 1].x : lc.x;
    const gold = numbers.filter((n) => sameRow(n.y) && n.x > after).sort((a, b) => a.x - b.x)[0];
    if (gold && gold.v <= 300) hud.gold = gold.v;
  }

  // Colonne des joueurs : au moins trois nombres ≤ 100 empilés tout à droite ; le sien est le plus gros.
  const column = numbers.filter((n) => n.x > frame.width * 0.8 && n.v <= 100);
  if (column.length >= 3) {
    const mine = column.slice().sort((a, b) => b.h - a.h)[0];
    const others = column.filter((n) => n !== mine).map((n) => n.h);
    if (mine.h >= Math.max(...others) * 1.2) hud.hp = mine.v;
  }
  return hud;
}
