import type { Champion, GameSet, Role, Trait } from './types';

const BASE = 'https://raw.communitydragon.org/latest';
const CACHE_KEY = 'coop-tft:data:v1';
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
export interface RawData {
  setData?: RawSet[];
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

function normalizeSet(raw: RawSet): GameSet {
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
      name: t.name,
      breakpoints: [...new Set((t.effects ?? []).map((e) => e.minUnits ?? 0).filter((n) => n > 0))].sort(
        (a, b) => a - b,
      ),
    }))
    .filter((t) => t.breakpoints.length);
  champions.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  return {
    key: raw.mutator,
    label: `Set ${raw.number}${raw.name && raw.name !== String(raw.number) ? ` · ${raw.name}` : ''} (${raw.mutator})`,
    champions,
    traits,
  };
}

/** Sets jouables, le plus récent d'abord ; pour un même numéro, le set standard avant ses variantes. */
export function normalize(data: RawData): GameSet[] {
  const raws = (data.setData ?? []).slice().sort((a, b) => {
    if (a.number !== b.number) return b.number - a.number;
    const std = (s: RawSet) => (s.mutator === `TFTSet${s.number}` ? 0 : 1);
    return std(a) - std(b) || (b.champions?.length ?? 0) - (a.champions?.length ?? 0);
  });
  return raws.map(normalizeSet).filter((s) => s.champions.length >= 20 && s.traits.length > 0);
}

export async function loadSets(force = false): Promise<GameSet[]> {
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
      if (cached && Date.now() - cached.at < CACHE_TTL && cached.sets?.length) return cached.sets;
    } catch {
      /* cache illisible : on recharge */
    }
  }
  let lastError: unknown;
  for (const locale of ['fr_fr', 'en_us']) {
    try {
      const res = await fetch(`${BASE}/cdragon/tft/${locale}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // On ne garde que les 3 sets les plus récents pour tenir dans le localStorage.
      const sets = normalize(await res.json()).slice(0, 3);
      if (!sets.length) throw new Error('aucun set exploitable');
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), sets }));
      } catch {
        /* quota dépassé : pas de cache */
      }
      return sets;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
