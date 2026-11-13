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
 * Nettoie un nom lu sur une carte de boutique : le prix de la carte voisine s'y retrouve souvent collé
 * (« 95 Caitlyn », « o4 Krug », « 3 Maman Raptor 3 »). On retire les fragments de tête contenant un
 * chiffre ou trop courts, et les nombres de queue.
 */
export function cardName(text: string): string {
  const tokens = text.trim().split(/\s+/);
  while (tokens.length > 1 && (/\d/.test(tokens[0]) || !/[a-zA-ZÀ-ÿ]{2}/.test(tokens[0]))) tokens.shift();
  while (tokens.length > 1 && /^\d+$/.test(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

/**
 * Repère les noms de champions dans le texte lu à l'écran. La boutique est la rangée
 * horizontale qui en aligne le plus (au moins deux), la plus basse en cas d'égalité.
 */
export function readShop(frame: ScreenFrame, champions: Champion[]): ShopRead {
  const byName = new Map(champions.map((c) => [normText(c.name), c]));
  const hits: { c: Champion; x: number; y: number }[] = [];
  for (const line of frame.lines) {
    const c = byName.get(normText(line.text)) ?? byName.get(normText(cardName(line.text)));
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
  if (frame.lines.some((l) => ['acheterxp', 'buyxp'].includes(normText(l.text)))) return 'game';
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
  /** Progression d'XP vers le niveau suivant. */
  xp?: { have: number; total: number };
  /** Série en cours (victoires ou défaites d'affilée) : le petit nombre à flamme au-dessus de l'or. */
  streak?: number;
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
 * Lit manche, niveau, XP, or, PV et probabilités de boutique dans le texte de l'écran.
 * Règles calées sur des relevés réels de TFT mobile (Set 18), toutes relatives au bouton
 * « Acheter XP » pour ne pas dépendre de la taille de la fenêtre :
 * - manche : un texte de la forme « 3-2 » ;
 * - niveau : le chiffre seul dans le petit rond, juste à droite sous « Acheter XP » ;
 * - XP : « 18/56 », au-dessus du bouton ;
 * - or : le nombre écrit en très gros en bas à droite ; l'icône de pièce est souvent lue comme un
 *   chiffre collé devant (« 939 » pour 39 or), ce qui se voit à la largeur du texte ;
 * - probabilités : la ligne aux « % » sous la boutique, quand elle est lue sans ambiguïté ;
 * - PV : dans la liste des joueurs (visible boutique fermée), le nombre sous son propre pseudo.
 */
export function readHud(frame: ScreenFrame, playerName?: string): Hud {
  const hud: Hud = {};
  let buyXp: ScreenLine | undefined;
  let goldLine: ScreenLine | undefined;
  for (const l of frame.lines) {
    const text = l.text.trim();
    const stage = /^([1-9])\s*[-–]\s*([1-7])$/.exec(text);
    if (stage && !hud.stage) hud.stage = `${stage[1]}-${stage[2]}`;
    const n = normText(text);
    if (!buyXp && (n === 'acheterxp' || n === 'buyxp')) buyXp = l;

    // « 15% 20 %132 % 30% 3% » : une icône est parfois lue comme un « 1 » collé devant une valeur.
    if (!hud.odds && (text.match(/%/g)?.length ?? 0) >= 3) {
      const values = [...text.matchAll(/(\d{1,3})\s*%/g)].map((m) => Number(m[1])).map((v) => (v > 100 ? v % 100 : v));
      if (values.length === 5 && values.reduce((t, v) => t + v, 0) === 100) hud.odds = values;
    }
  }

  if (buyXp) {
    const right = buyXp.x + buyXp.w;
    for (const l of frame.lines) {
      const text = l.text.trim();
      const c = center(l);
      if (/^\d{1,2}$/.test(text) && l.x >= right - 12 && l.x <= right + 90 && l.y >= buyXp.y + 40 && l.y <= buyXp.y + 150) {
        const v = Number(text);
        if (v >= 1 && v <= 10) hud.level = v;
      }
      const xp = /(\d{1,3})\s*\/\s*(\d{1,3})/.exec(text);
      if (xp && !hud.xp && l.x < frame.width * 0.2 && l.y < buyXp.y && l.y > buyXp.y - 260 && Number(xp[1]) < Number(xp[2]))
        hud.xp = { have: Number(xp[1]), total: Number(xp[2]) };

      const digits = /^\D{0,2}\s?(\d{1,4})$/.exec(text);
      if (digits && c.x > frame.width * 0.85 && l.h >= buyXp.h * 1.4 && l.y > buyXp.y - 80) {
        let value = digits[1];
        // Largeur attendue pour ces chiffres seuls ; nettement plus large = l'icône de pièce a été lue avec.
        const allDigits = /^\d+$/.test(text);
        if (allDigits && value.length >= 2 && l.w > value.length * l.h * 0.46 * 1.3) value = value.slice(1);
        hud.gold = Number(value);
        goldLine = l;
      }
    }
    // La série est le petit nombre posé juste au-dessus de l'or ; sa flamme est lue comme un « o » ou rien.
    if (goldLine) {
      const g = goldLine;
      const badge = frame.lines.find(
        (l) =>
          l !== g &&
          l.h < g.h * 0.7 &&
          l.y < g.y - g.h * 0.6 &&
          l.y > g.y - g.h * 2.4 &&
          // Repéré depuis le bord droit de l'or, stable que l'icône de pièce ait été lue avec ou non.
          l.x > g.x + g.w - g.h * 3.5 &&
          l.x < g.x + g.w &&
          /^\D{0,2}\s?\d{1,2}$/.test(l.text.trim()),
      );
      const n = badge && Number(/(\d{1,2})$/.exec(badge.text.trim())![1]);
      if (n !== undefined && n <= 30) hud.streak = n;
    }
  }

  const wanted = playerName ? normText(playerName) : '';
  if (wanted.length >= 3) {
    const mine = frame.lines.find((l) => center(l).x > frame.width * 0.7 && normText(l.text).includes(wanted));
    if (mine) {
      // Pseudo et PV parfois lus sur une même ligne (« Pseudo 53 »), sinon PV juste en dessous.
      const inline = /(\d{1,3})\D*$/.exec(mine.text);
      const below = frame.lines
        .filter((l) => l !== mine && l.y > mine.y + mine.h * 0.4 && l.y < mine.y + mine.h * 2.6 && l.x + l.w > mine.x + mine.w * 0.4 && l.x < mine.x + mine.w + 40)
        .map((l) => /(\d{1,3})\D*$/.exec(l.text.trim()))
        .find((m) => m && Number(m[1]) <= 100);
      const hp = inline && Number(inline[1]) <= 100 ? Number(inline[1]) : below ? Number(below[1]) : undefined;
      if (hp !== undefined) hud.hp = hp;
    }
  }
  return hud;
}

/**
 * Devine son propre pseudo : c'est le nom qui apparaît à la fois dans la liste des joueurs (à droite)
 * et sur l'étiquette de sa Petite Légende, sur le plateau.
 */
export function guessPlayerName(frame: ScreenFrame): string | undefined {
  const board = frame.lines.filter((l) => center(l).x < frame.width * 0.6 && /[a-zA-ZÀ-ÿ]{3}/.test(l.text));
  for (const l of frame.lines) {
    if (center(l).x < frame.width * 0.75 || !/[a-zA-ZÀ-ÿ]{3}/.test(l.text)) continue;
    const n = normText(l.text);
    if (n.length >= 3 && board.some((b) => normText(b.text) === n)) return l.text.trim();
  }
  return undefined;
}

/**
 * Fiche d'unité : quand le joueur tape une unité, le jeu ouvre un panneau avec son nom et, juste
 * en dessous, ses PV sous la forme « 650/650 ». C'est le seul endroit où une unité du plateau ou du
 * banc est nommée en toutes lettres. Les cartes de boutique portent aussi un nom, mais jamais suivi
 * d'une ligne de PV.
 */
export function readUnitPanel(frame: ScreenFrame, champions: Champion[]): Champion | undefined {
  const byName = new Map(champions.map((c) => [normText(c.name), c]));
  for (const line of frame.lines) {
    const c = byName.get(normText(line.text)) ?? byName.get(normText(cardName(line.text)));
    if (!c) continue;
    const hasHealth = frame.lines.some(
      (l) =>
        l !== line &&
        /^\d{1,5}\s*\/\s*\d{2,5}$/.test(l.text.trim()) &&
        l.y > line.y + line.h * 0.4 &&
        l.y < line.y + line.h * 3 &&
        l.x + l.w / 2 > line.x &&
        l.x + l.w / 2 < line.x + line.h * 16,
    );
    if (hasHealth) return c;
  }
  return undefined;
}

/** Ce que l'interface a besoin de connaître d'une image : tout le reste du texte lu est ignoré. */
export interface FrameView {
  shop: Champion[];
  gameState: GameState;
  /** Valeurs confirmées par deux lectures successives. */
  hud: Hud;
}
export const EMPTY_VIEW: FrameView = { shop: [], gameState: 'none', hud: {} };

/** Ne garde d'une lecture que les valeurs identiques à la lecture précédente. */
export function stableHud(hud: Hud, prev: Hud): Hud {
  const stable: Hud = {};
  for (const k of ['stage', 'level', 'gold', 'hp', 'streak'] as const)
    if (hud[k] !== undefined && hud[k] === prev[k]) (stable as Record<string, unknown>)[k] = hud[k];
  if (hud.odds && hud.odds.join() === prev.odds?.join()) stable.odds = hud.odds;
  if (hud.xp && hud.xp.have === prev.xp?.have && hud.xp.total === prev.xp?.total) stable.xp = hud.xp;
  return stable;
}

/** Empreinte d'une vue : deux images qui donnent la même n'ont pas besoin de redessiner l'écran. */
export function viewKey(v: FrameView): string {
  return `${v.gameState}|${v.shop.map((c) => c.id).join(',')}|${JSON.stringify(v.hud)}`;
}
