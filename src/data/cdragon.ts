import { canon } from '../meta/aggregate';
import type { Champion, GameSet, Item, Role, Trait } from './types';

const BASE = 'https://raw.communitydragon.org/latest';
const CACHE_KEY = 'coop-tft:data:v4';
const CACHE_TTL = 12 * 3600 * 1000;

/* Forme (partielle) du fichier cdragon/tft/<locale>.json */
interface RawChampion {
  apiName: string;
  name: string;
  cost: number;
  traits?: string[] | null;
  role?: string | null;
  squareIcon?: string | null;
  tileIcon?: string | null;
  icon?: string | null;
  stats?: { range?: number | null; armor?: number | null; hp?: number | null } | null;
}
interface RawTrait {
  apiName?: string;
  name: string;
  effects?: { minUnits?: number | null }[] | null;
}
interface RawSet {
  number: number;
  mutator: string;
  name?: string;
  champions?: RawChampion[];
  traits?: RawTrait[];
}
interface RawItem {
  apiName?: string | null;
  name?: string | null;
  icon?: string | null;
  composition?: string[] | null;
}
export interface RawData {
  setData?: RawSet[];
  items?: RawItem[];
}

export function assetUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  return `${BASE}/game/${path.toLowerCase().replace(/\.(tex|dds)$/, '.png')}`;
}

export function classifyRole(c: RawChampion): Role {
  const range = c.stats?.range ?? 1;
  const role = (c.role ?? '').toLowerCase();
  if (range >= 4) return 'backline';
  if (range >= 2) return 'ranged';
  if (role.includes('tank')) return 'tank';
  if (role) return 'melee';
  // Pas de rôle fourni : un corps-à-corps très blindé est traité comme tank.
  return (c.stats?.armor ?? 0) >= 45 ? 'tank' : 'melee';
}

function normalizeSet(raw: RawSet, items: Record<string, Item>): GameSet {
  const seen = new Set<string>();
  const champions: Champion[] = [];
  for (const c of raw.champions ?? []) {
    const traits = (c.traits ?? []).filter(Boolean);
    // Les invocations, PNJ et unités d'événement n'ont pas de trait ou pas de coût jouable.
    if (!traits.length || c.cost < 1 || c.cost > 6 || seen.has(c.apiName)) continue;
    seen.add(c.apiName);
    champions.push({
      id: c.apiName,
      name: c.name,
      cost: c.cost,
      traits,
      range: c.stats?.range ?? 1,
      role: classifyRole(c),
      icon: assetUrl(c.tileIcon ?? c.squareIcon ?? c.icon),
    });
  }
  const used = new Set(champions.flatMap((c) => c.traits));
  const traits: Trait[] = (raw.traits ?? [])
    .filter((t) => used.has(t.name))
    .map((t) => ({
      id: t.apiName ?? t.name,
      name: t.name,
      breakpoints: [...new Set((t.effects ?? []).map((e) => e.minUnits ?? 0).filter((n) => n > 0))].sort(
        (a, b) => a - b,
      ),
    }))
    .filter((t) => t.breakpoints.length);
  champions.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  return {
    key: raw.mutator,
    number: raw.number,
    items,
    // Le champ « name » de Community Dragon n'est pas fiable (ex. « Set10 » pour le set 18).
    label: raw.mutator === `TFTSet${raw.number}` ? `Set ${raw.number}` : `Set ${raw.number} (${raw.mutator})`,
    champions,
    traits,
  };
}

/** Le set jouable le plus récent (le set standard passe avant ses variantes de mode). */
export function normalize(data: RawData): GameSet | undefined {
  const items: Record<string, Item> = {};
  for (const it of data.items ?? []) {
    if (it.apiName && it.name && /item/i.test(it.apiName))
      items[canon(it.apiName)] ??= {
        name: it.name,
        icon: assetUrl(it.icon),
        ...(it.composition?.length === 2 ? { from: it.composition.map(canon) } : {}),
      };
  }
  const raws = (data.setData ?? []).slice().sort((a, b) => {
    if (a.number !== b.number) return b.number - a.number;
    const std = (s: RawSet) => (s.mutator === `TFTSet${s.number}` ? 0 : 1);
    return std(a) - std(b) || (b.champions?.length ?? 0) - (a.champions?.length ?? 0);
  });
  for (const raw of raws) {
    const set = normalizeSet(raw, items);
    if (set.champions.length >= 20 && set.traits.length > 0) return set;
  }
  return undefined;
}

export async function loadSet(force = false): Promise<GameSet> {
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
      if (cached && Date.now() - cached.at < CACHE_TTL && cached.set) return cached.set;
    } catch {
      /* cache illisible : on recharge */
    }
  }
  let lastError: unknown;
  for (const locale of ['fr_fr', 'en_us']) {
    try {
      const res = await fetch(`${BASE}/cdragon/tft/${locale}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const set = normalize(await res.json());
      if (!set) throw new Error('aucun set exploitable');
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), set }));
      } catch {
        /* quota dépassé : pas de cache */
      }
      return set;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
