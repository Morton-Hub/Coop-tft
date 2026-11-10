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
 * Lit manche, niveau, or et PV dans le texte de l'écran. Règles de première intention :
 * - manche : un texte de la forme « 3-2 » ;
 * - niveau : « Niv. 6 », « Niveau 6 », « Lvl 6 » ;
 * - or : le nombre isolé situé juste au-dessus de la boutique, le plus près de son centre ;
 * - PV : le nombre aligné avec le pseudo du joueur dans la liste des joueurs.
 */
export function readHud(frame: ScreenFrame, shop: ShopRead, playerName?: string): Hud {
  const hud: Hud = {};
  const numbers: { v: number; x: number; y: number }[] = [];
  for (const l of frame.lines) {
    const text = l.text.trim();
    const stage = /^([1-9])\s*[-–]\s*([1-7])$/.exec(text);
    if (stage && !hud.stage) hud.stage = `${stage[1]}-${stage[2]}`;
    const level = /\b(?:niv(?:eau)?|lvl?|level)\.?\s*(\d{1,2})\b/i.exec(text);
    if (level && !hud.level && Number(level[1]) >= 1 && Number(level[1]) <= 10) hud.level = Number(level[1]);
    if (/^\d{1,3}$/.test(text)) numbers.push({ v: Number(text), ...center(l) });
  }

  if (shop.row) {
    const { y, x0, x1 } = shop.row;
    const mid = (x0 + x1) / 2;
    const margin = frame.width * 0.1;
    const gold = numbers
      // Au-dessus des cartes (dont les coûts 1-5 sont sur la même rangée que les noms), pas trop haut.
      .filter((n) => n.y < y - frame.height * 0.03 && n.y > y - frame.height * 0.3 && n.x > x0 - margin && n.x < x1 + margin)
      .sort((a, b) => Math.abs(a.x - mid) - Math.abs(b.x - mid) || b.y - a.y)[0];
    if (gold && gold.v <= 300) hud.gold = gold.v;
  }

  const wanted = playerName ? normText(playerName) : '';
  if (wanted.length >= 3) {
    const mine = frame.lines.find((l) => normText(l.text).includes(wanted) && !l.text.includes('#'));
    if (mine) {
      const c = center(mine);
      const hp = numbers
        .filter((n) => Math.abs(n.y - c.y) <= mine.h * 2 && n.v <= 100)
        .sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0];
      if (hp) hud.hp = hp.v;
    }
  }
  return hud;
}
