import type { Board, Champion, GameSet, Trait } from '../data/types';

export interface TraitState {
  trait: Trait;
  count: number;
  /** Nombre de paliers atteints (0 = inactif). */
  tier: number;
  /** Prochain palier à atteindre, s'il en reste un. */
  next?: number;
}

export function boardChampions(board: Board, set: GameSet): Champion[] {
  const byId = new Map(set.champions.map((c) => [c.id, c]));
  return Object.values(board)
    .map((id) => byId.get(id))
    .filter((c): c is Champion => !!c);
}

/** Les traits comptent les champions uniques : deux exemplaires du même champion ne comptent qu'une fois. */
export function countTraits(champs: Champion[]): Map<string, number> {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const c of champs) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    for (const t of c.traits) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

export function traitState(trait: Trait, count: number): TraitState {
  const tier = trait.breakpoints.filter((b) => count >= b).length;
  return { trait, count, tier, next: trait.breakpoints[tier] };
}

export function traitStates(champs: Champion[], set: GameSet): TraitState[] {
  const counts = countTraits(champs);
  return set.traits
    .filter((t) => counts.has(t.name))
    .map((t) => traitState(t, counts.get(t.name)!))
    .sort((a, b) => b.tier - a.tier || b.count - a.count || a.trait.name.localeCompare(b.trait.name));
}
