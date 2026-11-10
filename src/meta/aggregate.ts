/*
 * Agrégation des parties classées (API Riot, tft-match-v1) en compos méta.
 * Fichier autonome, sans import : il est exécuté tel quel par scripts/fetch-meta.mjs.
 */

export interface RawUnit {
  character_id: string;
  itemNames?: string[];
  /** Niveau d'étoiles (1 à 3). */
  tier?: number;
}
export interface RawTraitEntry {
  name: string;
  num_units: number;
  style: number;
  tier_current: number;
}
export interface RawParticipant {
  placement: number;
  /** Niveau du joueur en fin de partie. */
  level?: number;
  traits: RawTraitEntry[];
  units: RawUnit[];
}
export interface RawMatch {
  info: {
    queue_id: number;
    tft_set_number: number;
    /** Souvent inexploitable (« TFT Unreal Version ?.?.?.? ») : le patch est alors laissé vide. */
    game_version?: string;
    /** Fin de partie, en millisecondes. */
    game_datetime?: number;
    participants: RawParticipant[];
  };
}

export type Tier = 'S' | 'A' | 'B' | 'C';
export interface MetaComp {
  tier: Tier;
  /** Les deux traits qui définissent la compo, avec leur nombre d'unités médian. */
  traits: { id: string; units: number }[];
  /** Unités les plus jouées dans cette compo (ids Riot). */
  units: string[];
  carries: { id: string; items: string[] }[];
  /** Niveau médian des joueurs qui finissent top 4 avec cette compo. */
  level?: number;
  /** Vrai si le carry principal est le plus souvent 3 étoiles chez les top 4 : compo de reroll. */
  reroll?: boolean;
  /** Unités nettement plus présentes chez les top 4 que chez les autres : à ne pas manquer. */
  core?: string[];
  count: number;
  pickRate: number;
  avgPlacement: number;
  top4: number;
  win: number;
}
export interface MetaData {
  generatedAt: string;
  region: string;
  set: number;
  patch: string;
  matches: number;
  boards: number;
  comps: MetaComp[];
}

const RANKED_QUEUE = 1100;

/**
 * Forme canonique d'un identifiant de champion, trait ou objet. L'API Riot et Community Dragon
 * n'écrivent pas toujours le même id (préfixe, numéro de set, « Item_ ») : on compare sans eux.
 */
export function canon(id: string): string {
  return id
    .toLowerCase()
    .replace(/^[a-z]+\d*_/, '')
    .replace(/^\d+_/, '')
    .replace(/^item_/, '')
    .replace(/[\d_]/g, '');
}

/** Libellé lisible de secours quand un id n'est pas trouvé dans les données du set. */
export function prettyId(id: string): string {
  return id
    .replace(/^[A-Za-z]+\d*_/, '')
    .replace(/^\d+_/, '')
    .replace(/^Item_/, '')
    .replace(/[\d_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}

/** Poids du lissage : une compo peu jouée est ramenée vers la moyenne (4,5) avant d'être classée. */
const PRIOR_BOARDS = 20;
export const adjusted = (avg: number, n: number) => (avg * n + 4.5 * PRIOR_BOARDS) / (n + PRIOR_BOARDS);

export function patchOf(gameVersion: string | undefined): string {
  if (!gameVersion) return '?';
  return (/Releases\/(\d+\.\d+)/.exec(gameVersion) ?? /(\d+\.\d+)/.exec(gameVersion))?.[1] ?? '?';
}
const patchNum = (p: string) => {
  const [a, b] = p.split('.').map(Number);
  return (a || 0) * 1000 + (b || 0);
};
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function tierOf(adj: number): Tier {
  if (adj <= 4.05) return 'S';
  if (adj <= 4.3) return 'A';
  if (adj <= 4.55) return 'B';
  return 'C';
}

/** Les deux traits actifs les plus poussés d'un plateau (les traits à 1 unité ne comptent qu'en dernier recours). */
export function signature(p: RawParticipant): RawTraitEntry[] {
  const active = p.traits.filter((t) => t.tier_current > 0);
  const rank = (t: RawTraitEntry) => (t.num_units > 1 ? 1000 : 0) + t.style * 20 + t.num_units;
  return active.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name)).slice(0, 2);
}

function topKeys(counts: Map<string, number>): [string, number][] {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

export function aggregate(
  matches: RawMatch[],
  opts: { region?: string; now?: Date; minBoardsForPatch?: number; maxAgeDays?: number } = {},
): MetaData {
  const ranked = matches.filter((m) => m.info?.queue_id === RANKED_QUEUE && m.info.participants?.length);
  const set = Math.max(0, ...ranked.map((m) => m.info.tft_set_number));
  // Seules les parties récentes comptent : la méta bouge à chaque patch.
  const oldest = (opts.now ?? new Date()).getTime() - (opts.maxAgeDays ?? 7) * 86400000;
  let pool = ranked.filter(
    (m) => m.info.tft_set_number === set && (m.info.game_datetime === undefined || m.info.game_datetime >= oldest),
  );

  // On ne garde que le dernier patch dès qu'il a assez de parties pour être représentatif.
  const latest = pool.map((m) => patchOf(m.info.game_version)).sort((a, b) => patchNum(b) - patchNum(a))[0] ?? '?';
  const onLatest = pool.filter((m) => patchOf(m.info.game_version) === latest);
  if (onLatest.length * 8 >= (opts.minBoardsForPatch ?? 200)) pool = onLatest;

  interface Cluster {
    boards: RawParticipant[];
    traitUnits: Map<string, number[]>;
  }
  const clusters = new Map<string, Cluster>();
  let boards = 0;
  for (const m of pool) {
    for (const p of m.info.participants) {
      const sig = signature(p);
      if (!sig.length) continue;
      boards++;
      const key = sig.map((t) => t.name).sort().join('|');
      let c = clusters.get(key);
      if (!c) clusters.set(key, (c = { boards: [], traitUnits: new Map() }));
      c.boards.push(p);
      for (const t of sig) c.traitUnits.set(t.name, [...(c.traitUnits.get(t.name) ?? []), t.num_units]);
    }
  }

  const minCount = Math.max(20, Math.ceil(boards * 0.015));
  const comps: MetaComp[] = [];
  for (const c of clusters.values()) {
    const n = c.boards.length;
    if (n < minCount) continue;

    const unitFreq = new Map<string, number>();
    const itemised = new Map<string, number>();
    const items = new Map<string, Map<string, number>>();
    for (const p of c.boards) {
      for (const id of new Set(p.units.map((u) => u.character_id))) bump(unitFreq, id);
      for (const u of p.units) {
        if ((u.itemNames?.length ?? 0) < 3) continue;
        bump(itemised, u.character_id);
        if (!items.has(u.character_id)) items.set(u.character_id, new Map());
        for (const it of u.itemNames!) bump(items.get(u.character_id)!, it);
      }
    }
    const byFreq = topKeys(unitFreq);
    const core = byFreq.filter(([, k]) => k / n >= 0.5).slice(0, 9);
    const units = (core.length >= 7 ? core : byFreq.slice(0, 7)).map(([id]) => id);

    const carries = topKeys(itemised)
      .filter(([id, k]) => k / n >= 0.3 && units.includes(id))
      .slice(0, 2)
      .map(([id]) => ({ id, items: topKeys(items.get(id)!).slice(0, 3).map(([it]) => it) }));

    const traits = [...c.traitUnits]
      .map(([id, list]) => ({ id, units: list.sort((a, b) => a - b)[Math.floor(list.length / 2)] }))
      .sort((a, b) => b.units - a.units || a.id.localeCompare(b.id));

    // Faits tirés des plateaux gagnants (top 4), plutôt que des règles générales.
    const top = c.boards.filter((p) => p.placement <= 4);
    const bottom = c.boards.filter((p) => p.placement > 4);
    const levels = top.map((p) => p.level ?? 0).filter(Boolean).sort((a, b) => a - b);
    const level = levels.length >= 5 ? levels[Math.floor(levels.length / 2)] : undefined;

    let reroll: boolean | undefined;
    const main = carries[0]?.id;
    if (main && top.length >= 5) {
      const withMain = top.filter((p) => p.units.some((u) => u.character_id === main));
      const starred = withMain.filter((p) => p.units.some((u) => u.character_id === main && (u.tier ?? 0) >= 3));
      if (withMain.length >= 5) reroll = starred.length / withMain.length >= 0.4;
    }

    let keyUnits: string[] | undefined;
    if (top.length >= 10 && bottom.length >= 10) {
      const share = (group: RawParticipant[], id: string) =>
        group.filter((p) => p.units.some((u) => u.character_id === id)).length / group.length;
      keyUnits = units
        .map((id) => ({ id, top: share(top, id), lift: share(top, id) - share(bottom, id) }))
        .filter((u) => u.top >= 0.6 && u.lift >= 0.15)
        .sort((a, b) => b.lift - a.lift)
        .slice(0, 3)
        .map((u) => u.id);
    }

    const avg = c.boards.reduce((s, p) => s + p.placement, 0) / n;
    comps.push({
      tier: tierOf(adjusted(avg, n)),
      traits,
      units,
      carries,
      ...(level ? { level } : {}),
      ...(reroll !== undefined ? { reroll } : {}),
      ...(keyUnits?.length ? { core: keyUnits } : {}),
      count: n,
      pickRate: round(n / boards, 3),
      avgPlacement: round(avg),
      top4: round(c.boards.filter((p) => p.placement <= 4).length / n, 3),
      win: round(c.boards.filter((p) => p.placement === 1).length / n, 3),
    });
  }
  comps.sort((a, b) => adjusted(a.avgPlacement, a.count) - adjusted(b.avgPlacement, b.count) || b.count - a.count);

  return {
    generatedAt: (opts.now ?? new Date()).toISOString(),
    region: opts.region ?? '',
    set,
    patch: latest === '?' ? '' : latest,
    matches: pool.length,
    boards,
    comps: comps.slice(0, 25),
  };
}
