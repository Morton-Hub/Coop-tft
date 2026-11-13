import { canon } from '../meta/aggregate';

/** Une partie terminée. */
export interface GameRecord {
  /** Fin de partie, en millisecondes (Date.now()). */
  at: number;
  /** Place finale, de 1 à 8. */
  placement: number;
  /** Compo jouée, quand elle était connue à la fin de la partie. */
  comp?: { traits: { id: string; units: number }[]; carry?: string };
}

export interface Stats {
  games: number;
  /** Place moyenne, 0 s'il n'y a aucune partie. */
  avgPlacement: number;
  /** Part des parties finies dans les 4 premiers, entre 0 et 1. */
  top4Rate: number;
  /** Part des parties gagnées (1re place), entre 0 et 1. */
  winRate: number;
}

export interface CompStats extends Stats {
  /** Ids canoniques des traits de la compo, triés et joints par « + ». */
  key: string;
  /** Ids canoniques des traits, triés. */
  traits: string[];
  /** Carry le plus souvent joué avec cette compo (id canonique). */
  carry?: string;
  /** Date de la dernière partie avec cette compo. */
  lastAt: number;
}

export interface Trend {
  /** Les 10 dernières parties. */
  recent: Stats;
  /** Les 10 parties d'avant (moins s'il n'y en a pas autant). */
  previous: Stats;
  /** Places gagnées en moyenne : positif = le joueur progresse (sa place moyenne baisse). */
  delta: number;
}

export interface Summary extends Stats {
  /** Détail par compo, de la plus jouée à la moins jouée. Les parties sans compo connue n'y figurent pas. */
  comps: CompStats[];
  /** Absent tant qu'il n'y a pas assez de parties pour comparer. */
  trend?: Trend;
}

/** L'écran de fin est relu en boucle : deux places identiques dans cet intervalle sont la même partie. */
export const SAME_GAME_MS = 10 * 60 * 1000;
/** Taille des deux fenêtres comparées par la tendance. */
export const TREND_WINDOW = 10;
/** Nombre minimal de parties dans la fenêtre précédente pour que la comparaison ait un sens. */
export const TREND_MIN_PREVIOUS = 5;

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/**
 * Ajoute une partie à l'historique (sans le modifier) et ne garde que les `max` plus récentes.
 * Si la partie y est déjà (même place à moins de 10 minutes), l'historique est renvoyé tel quel,
 * le même tableau, sauf si la nouvelle lecture apporte la compo qui manquait. Une place hors de
 * 1 à 8 est ignorée.
 */
export function addRecord(history: GameRecord[], record: GameRecord, max = 200): GameRecord[] {
  if (!Number.isInteger(record.placement) || record.placement < 1 || record.placement > 8) return history;
  const same = history.findIndex((r) => r.placement === record.placement && Math.abs(r.at - record.at) < SAME_GAME_MS);
  if (same >= 0) {
    if (history[same].comp || !record.comp) return history;
    return history.map((r, i) => (i === same ? { ...r, comp: record.comp } : r));
  }
  const next = [...history, record].sort((a, b) => a.at - b.at);
  return next.slice(Math.max(0, next.length - Math.max(1, max)));
}

/** Clé d'une compo : ses traits en forme canonique, sans doublon, triés. */
export function compKey(comp: NonNullable<GameRecord['comp']>): string {
  return [...new Set(comp.traits.map((t) => canon(t.id)))].sort().join('+');
}

export function stats(records: GameRecord[]): Stats {
  const games = records.length;
  if (!games) return { games: 0, avgPlacement: 0, top4Rate: 0, winRate: 0 };
  return {
    games,
    avgPlacement: round(records.reduce((t, r) => t + r.placement, 0) / games, 2),
    top4Rate: round(records.filter((r) => r.placement <= 4).length / games, 3),
    winRate: round(records.filter((r) => r.placement === 1).length / games, 3),
  };
}

/**
 * Bilan de l'historique : chiffres d'ensemble, détail par compo (triée par nombre de parties, puis
 * par meilleure place moyenne) et tendance des 10 dernières parties face aux 10 précédentes.
 */
export function summarize(history: GameRecord[]): Summary {
  const sorted = history.slice().sort((a, b) => a.at - b.at);

  const groups = new Map<string, GameRecord[]>();
  for (const r of sorted) {
    if (!r.comp?.traits.length) continue;
    const key = compKey(r.comp);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const comps = [...groups.entries()].map(([key, records]): CompStats => {
    const carries = new Map<string, number>();
    for (const r of records) {
      if (!r.comp?.carry) continue;
      const id = canon(r.comp.carry);
      carries.set(id, (carries.get(id) ?? 0) + 1);
    }
    // À égalité, le carry rencontré en premier reste (le tri est stable).
    const carry = [...carries.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return { key, traits: key.split('+'), ...(carry ? { carry } : {}), lastAt: records[records.length - 1].at, ...stats(records) };
  });
  comps.sort((a, b) => b.games - a.games || a.avgPlacement - b.avgPlacement || a.key.localeCompare(b.key));

  const summary: Summary = { ...stats(sorted), comps };
  const previous = sorted.slice(-2 * TREND_WINDOW, -TREND_WINDOW);
  if (previous.length >= TREND_MIN_PREVIOUS) {
    const recent = stats(sorted.slice(-TREND_WINDOW));
    const before = stats(previous);
    summary.trend = { recent, previous: before, delta: round(before.avgPlacement - recent.avgPlacement, 2) };
  }
  return summary;
}
