/*
 * Inventaire déduit de la boutique. L'app ne sait pas reconnaître les unités 3D du plateau : on
 * suit donc les lectures successives de la boutique (une toutes les 1,5 s environ) et on en déduit
 * les achats. Tout est pur : `observe(état, lecture)` rend un nouvel état, sans rien modifier.
 *
 * Principe : mieux vaut rater un achat que d'en inventer un.
 * - Une « instance » de boutique est la suite de cartes posée par une relance ou un début de manche.
 *   Acheter une carte la retire sans déplacer les autres : tant que les cartes lues restent une
 *   sous-suite de l'instance, c'est la même boutique.
 * - Une carte qui disparaît est un achat si l'or baisse exactement de son coût (or lu sur l'image
 *   d'avant et sur celle-ci). Sans or lisible, il faut qu'elle manque sur deux images de suite de
 *   la même instance. Si elle réapparaît, l'achat est annulé : ce n'était qu'un raté de lecture.
 * - Boutique masquée (aucune carte lue) : l'image est ignorée, ce n'est pas un achat de tout.
 * - La vente d'unités ne se voit pas : `adjust()` permet de corriger à la main.
 */
import type { Champion, GameSet } from '../data/types';
import { canon, type MetaComp } from '../meta/aggregate';

/** Ce qu'une image apporte : boutique de gauche à droite, et ce qui a pu être lu de l'ATH. */
export interface Observation {
  shop: Champion[];
  gold?: number;
  stage?: string;
  level?: number;
  /** Horodatage de la lecture (ms), recopié dans les événements. */
  at: number;
}

/**
 * État d'une carte de l'instance de boutique en cours :
 * - `seen` : lue sur la dernière image ;
 * - `pending` : disparue, achat en attente de confirmation ;
 * - `unread` : disparue, mais rien ne permet d'y voir un achat (raté de lecture présumé) ;
 * - `bought` : achat compté (annulé si la carte réapparaît).
 */
export type SlotStatus = 'seen' | 'pending' | 'unread' | 'bought';
export interface ShopSlot {
  readonly champion: Champion;
  readonly status: SlotStatus;
  /** Nombre d'images consécutives (boutique visible) où la carte manque. */
  readonly missing: number;
}

export type InventoryEvent =
  /** Achat compté ; `proof` dit ce qui l'a établi : l'or, ou la carte restée absente. */
  | { type: 'purchase'; at: number; id: string; name: string; cost: number; proof: 'gold' | 'persistence' }
  /** Achat annulé : la carte est réapparue dans la même boutique. */
  | { type: 'cancel'; at: number; id: string; name: string }
  /** Boutique remplacée dans la même manche ; `gold` = variation d'or quand elle est connue. */
  | { type: 'reroll'; at: number; gold?: number }
  /** Boutique remplacée par un changement de manche. */
  | { type: 'round'; at: number; stage?: string }
  /** Nouvelle partie : l'inventaire repart de zéro. */
  | { type: 'game'; at: number; stage: string };

export interface Inventory {
  /** Exemplaires possédés, par id de champion (id des données du set). */
  readonly owned: Readonly<Record<string, number>>;
  /** Derniers événements déduits, du plus ancien au plus récent (pour le débogage). */
  readonly events: readonly InventoryEvent[];
  /** Manche confirmée (lue deux fois de suite quand elle change). */
  readonly stage?: string;
  readonly level?: number;
  /** Or lu sur l'image précédente, si la boutique y était visible. */
  readonly gold?: number;
  /** Instance de boutique en cours, cartes achetées comprises. */
  readonly shop: readonly ShopSlot[];
  /** Manche lue quand cette instance est apparue. */
  readonly shopStage?: string;
  /** Manche lue une seule fois, en attente de confirmation. */
  readonly pendingStage?: string;
}

/** Nombre maximal de cartes dans la boutique. */
export const SHOP_SIZE = 5;
/** Nombre d'événements gardés en mémoire. */
export const MAX_EVENTS = 40;
/** Images consécutives d'absence exigées pour compter un achat sans preuve par l'or. */
const CONFIRM_FRAMES = 2;
/** Au-delà de ce nombre de cartes disparues d'un coup sans preuve par l'or, on suppose la boutique en partie masquée. */
const MAX_UNPROVEN_AT_ONCE = 2;

export function createInventory(): Inventory {
  return { owned: {}, events: [], shop: [] };
}

/** Niveau d'étoiles atteint avec ce nombre d'exemplaires : 3 pour un 2 étoiles, 9 pour un 3 étoiles. */
export function stars(copies: number): 1 | 2 | 3 {
  return copies >= 9 ? 3 : copies >= 3 ? 2 : 1;
}

/** Correction manuelle (vente, achat non vu) : ajoute `delta` exemplaires, sans descendre sous zéro. */
export function adjust(state: Inventory, id: string, delta: number): Inventory {
  return { ...state, owned: bump(state.owned, id, delta) };
}

function bump(owned: Readonly<Record<string, number>>, id: string, delta: number): Record<string, number> {
  const next = { ...owned };
  const n = (next[id] ?? 0) + delta;
  if (n > 0) next[id] = n;
  else delete next[id];
  return next;
}

/** « 3-2 » -> 32, pour comparer deux manches. */
function stageRank(stage: string): number {
  const m = /^(\d+)-(\d+)$/.exec(stage);
  return m ? Number(m[1]) * 10 + Number(m[2]) : -1;
}

/**
 * Suit la manche. Un changement n'est retenu qu'après deux lectures identiques de suite : une
 * manche mal lue une fois (« 8-2 » pour « 3-2 ») ne doit pas faire croire à une nouvelle partie.
 * Une manche confirmée qui recule = nouvelle partie, l'inventaire est vidé.
 */
function trackStage(state: Inventory, obs: Observation): Inventory {
  const stage = obs.stage;
  if (stage === undefined) return state;
  if (state.stage === undefined) return { ...state, stage, pendingStage: undefined };
  if (stage === state.stage) return state.pendingStage === undefined ? state : { ...state, pendingStage: undefined };
  if (stage !== state.pendingStage) return { ...state, pendingStage: stage };
  if (stageRank(stage) < stageRank(state.stage))
    return { ...createInventory(), stage, level: state.level, events: pushEvents(state.events, [{ type: 'game', at: obs.at, stage }]) };
  return { ...state, stage, pendingStage: undefined };
}

function pushEvents(events: readonly InventoryEvent[], added: InventoryEvent[]): readonly InventoryEvent[] {
  return added.length ? [...events, ...added].slice(-MAX_EVENTS) : events;
}

interface Alignment {
  /** Fusion de l'instance et de la lecture, dans l'ordre : carte connue (lue ou non) ou carte nouvelle. */
  merged: { slot?: ShopSlot; read: boolean; champion: Champion }[];
  matched: number;
  extra: number;
}

/**
 * Aligne la lecture sur l'instance en respectant l'ordre (plus longue sous-suite commune) : les
 * cartes ne changent pas de place quand on en achète une. À longueur égale, on préfère retrouver
 * une carte encore visible plutôt qu'une carte en attente, et en dernier une carte déjà achetée.
 */
function align(slots: readonly ShopSlot[], read: Champion[]): Alignment {
  const n = slots.length;
  const m = read.length;
  // Les poids restent assez proches pour que le nombre de cartes retrouvées prime toujours.
  const weight = (s: ShopSlot) => (s.status === 'seen' ? 17 : s.status === 'bought' ? 15 : 16);
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      const same = slots[i].champion.id === read[j].id ? weight(slots[i]) + best[i + 1][j + 1] : -1;
      best[i][j] = Math.max(same, best[i + 1][j], best[i][j + 1]);
    }

  const out: Alignment = { merged: [], matched: 0, extra: 0 };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && slots[i].champion.id === read[j].id && best[i][j] === weight(slots[i]) + best[i + 1][j + 1]) {
      out.merged.push({ slot: slots[i], read: true, champion: slots[i].champion });
      out.matched++;
      i++;
      j++;
    } else if (j >= m || (i < n && best[i][j] === best[i + 1][j])) {
      out.merged.push({ slot: slots[i], read: false, champion: slots[i].champion });
      i++;
    } else {
      out.merged.push({ read: true, champion: read[j] });
      out.extra++;
      j++;
    }
  }
  return out;
}

/**
 * Façons distinctes de choisir des cartes dont les coûts font exactement `amount` (deux exemplaires
 * du même champion sont interchangeables). Une seule façon : l'or désigne les cartes achetées.
 */
function subsetsCosting(indexes: number[], slots: ShopSlot[], amount: number): number[][] {
  const found = new Map<string, number[]>();
  for (let mask = 1; mask < 1 << indexes.length; mask++) {
    const pick = indexes.filter((_, k) => mask & (1 << k));
    if (pick.reduce((t, k) => t + slots[k].champion.cost, 0) !== amount) continue;
    const key = pick.map((k) => slots[k].champion.id).sort().join(',');
    if (!found.has(key)) found.set(key, pick);
  }
  return [...found.values()];
}

const freshShop = (shop: Champion[]): ShopSlot[] => shop.map((champion) => ({ champion, status: 'seen', missing: 0 }));

/** Intègre une lecture et rend le nouvel état. */
export function observe(state: Inventory, obs: Observation): Inventory {
  let s = trackStage(state, obs);
  if (obs.level !== undefined && obs.level !== s.level) s = { ...s, level: obs.level };

  // Boutique masquée ou lecture aberrante : rien à en déduire, et l'or d'avant ne vaut plus référence.
  if (obs.shop.length === 0 || obs.shop.length > SHOP_SIZE) return s.gold === undefined ? s : { ...s, gold: undefined };

  if (s.shop.length === 0) return { ...s, shop: freshShop(obs.shop), shopStage: obs.stage, gold: obs.gold };

  const a = align(s.shop, obs.shop);
  const goldDelta = obs.gold !== undefined && s.gold !== undefined ? obs.gold - s.gold : undefined;

  // Même boutique si on y retrouve des cartes dans l'ordre et que le tout tient en cinq emplacements.
  const sameShop = a.matched > 0 && s.shop.length + a.extra <= SHOP_SIZE && a.extra <= a.matched;
  if (!sameShop) {
    const stageChanged = obs.stage !== undefined && s.shopStage !== undefined && obs.stage !== s.shopStage;
    // Sans changement de manche lu, un or qui monte trahit quand même le revenu de début de manche.
    const event: InventoryEvent =
      stageChanged || (goldDelta !== undefined && goldDelta > 0)
        ? { type: 'round', at: obs.at, stage: obs.stage }
        : { type: 'reroll', at: obs.at, gold: goldDelta };
    return { ...s, shop: freshShop(obs.shop), shopStage: obs.stage ?? s.shopStage, gold: obs.gold, events: pushEvents(s.events, [event]) };
  }

  let owned = s.owned;
  const events: InventoryEvent[] = [];
  const buy = (slot: ShopSlot, proof: 'gold' | 'persistence'): ShopSlot => {
    const c = slot.champion;
    owned = bump(owned, c.id, 1);
    events.push({ type: 'purchase', at: obs.at, id: c.id, name: c.name, cost: c.cost, proof });
    return { ...slot, status: 'bought' };
  };

  const slots: ShopSlot[] = [];
  const vanished: number[] = []; // cartes lues à l'image précédente et absentes de celle-ci
  for (const m of a.merged) {
    const slot = m.slot;
    if (!slot) {
      slots.push({ champion: m.champion, status: 'seen', missing: 0 });
    } else if (m.read) {
      if (slot.status === 'bought') {
        owned = bump(owned, slot.champion.id, -1);
        events.push({ type: 'cancel', at: obs.at, id: slot.champion.id, name: slot.champion.name });
      }
      slots.push(slot.status === 'seen' ? slot : { ...slot, status: 'seen', missing: 0 });
    } else if (slot.status === 'bought') {
      slots.push(slot);
    } else {
      if (slot.status === 'seen') vanished.push(slots.length);
      slots.push({ ...slot, missing: slot.missing + 1 });
    }
  }

  if (vanished.length) {
    let bought: number[] = [];
    let fallback: SlotStatus = 'unread';
    if (a.extra > 0) {
      // Une image qui révèle une carte inconnue est trop douteuse pour prouver un achat.
    } else if (goldDelta !== undefined) {
      // Or lu des deux côtés : il tranche. Sans baisse, la carte a seulement été mal lue.
      if (goldDelta < 0) {
        const picks = subsetsCosting(vanished, slots, -goldDelta);
        if (picks.length === 1) bought = picks[0];
        // Baisse qu'aucune carte n'explique (XP achetée en même temps, par exemple) : on attend la
        // confirmation. Plusieurs explications possibles : on ne sait pas laquelle, on ne compte rien.
        else if (picks.length === 0 && vanished.length <= MAX_UNPROVEN_AT_ONCE) fallback = 'pending';
      }
    } else if (vanished.length <= MAX_UNPROVEN_AT_ONCE) {
      fallback = 'pending';
    }
    for (const k of vanished) slots[k] = bought.includes(k) ? buy(slots[k], 'gold') : { ...slots[k], status: fallback };
  }

  // Sans preuve par l'or : achat compté quand la carte manque depuis assez d'images de suite.
  for (let k = 0; k < slots.length; k++)
    if (slots[k].status === 'pending' && slots[k].missing >= CONFIRM_FRAMES) slots[k] = buy(slots[k], 'persistence');

  return { ...s, owned, shop: slots, shopStage: s.shopStage ?? obs.stage, gold: obs.gold, events: pushEvents(s.events, events) };
}

/* ---------- Compos méta les mieux servies par ce qu'on possède ---------- */

export interface OwnedUnit {
  champion: Champion;
  copies: number;
  /** Unité « à ne pas manquer » de la compo. */
  core: boolean;
  carry: boolean;
}
export interface CompFit {
  comp: MetaComp;
  /** Rang de la compo dans la liste d'origine. */
  index: number;
  /** Somme des poids des unités possédées qui servent à la compo (0 = aucune). */
  score: number;
  /** Unités possédées appartenant à la compo, les plus lourdes d'abord. */
  owned: OwnedUnit[];
}

/** Poids supplémentaire d'une unité « core », d'un carry, et d'un niveau d'étoiles en plus. */
const CORE_BONUS = 0.5;
const CARRY_BONUS = 1;
const STAR_BONUS = 0.5;
/** Une unité qui n'apparaît que dans un plateau type par niveau compte moitié moins. */
const VARIANT_ONLY = 0.5;

/**
 * Classe les compos selon ce que le joueur possède. Chaque unité possédée de la compo pèse son coût,
 * majoré si elle est « core » ou carry, et un peu plus si elle est déjà montée en étoiles. Les ids
 * Riot et ceux du set diffèrent : tout est comparé par `canon()`. À score égal (non nul), la meilleure
 * place moyenne passe devant. Sans rien de possédé — ou pour les compos sans aucune unité possédée —
 * l'ordre d'origine est conservé.
 */
export function rankComps(owned: Readonly<Record<string, number>>, comps: MetaComp[], set: GameSet): CompFit[] {
  const byCanon = new Map(set.champions.map((c) => [canon(c.id), c]));
  const mine = new Map<string, { champion: Champion; copies: number }>();
  for (const [id, copies] of Object.entries(owned)) {
    const champion = byCanon.get(canon(id));
    if (!champion || !(copies > 0)) continue;
    mine.set(canon(id), { champion, copies: (mine.get(canon(id))?.copies ?? 0) + copies });
  }

  const fits = comps.map((comp, index): CompFit => {
    const core = new Set((comp.core ?? []).map(canon));
    const carries = new Set(comp.carries.map((c) => canon(c.id)));
    const main = new Set([...comp.units.map(canon), ...core, ...carries]);
    const all = new Set([...main, ...Object.values(comp.variants ?? {}).flat().map(canon)]);
    const weighted: { unit: OwnedUnit; weight: number }[] = [];
    for (const key of all) {
      const have = mine.get(key);
      if (!have) continue;
      const unit: OwnedUnit = { ...have, core: core.has(key), carry: carries.has(key) };
      const weight =
        have.champion.cost *
        (1 + (unit.core ? CORE_BONUS : 0) + (unit.carry ? CARRY_BONUS : 0)) *
        (1 + STAR_BONUS * (stars(have.copies) - 1)) *
        (main.has(key) ? 1 : VARIANT_ONLY);
      weighted.push({ unit, weight });
    }
    weighted.sort((x, y) => y.weight - x.weight || x.unit.champion.name.localeCompare(y.unit.champion.name));
    return { comp, index, score: weighted.reduce((t, w) => t + w.weight, 0), owned: weighted.map((w) => w.unit) };
  });

  return fits.sort(
    (x, y) => y.score - x.score || (x.score > 0 ? x.comp.avgPlacement - y.comp.avgPlacement : 0) || x.index - y.index,
  );
}
