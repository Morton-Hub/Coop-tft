import type { Champion, GameSet } from '../data/types';
import { countTraits, traitState } from './traits';

export interface Suggestion {
  champion: Champion;
  score: number;
  reasons: string[];
}

/** Coût maximal raisonnablement trouvable en boutique à un niveau donné. */
export function maxCostAtLevel(level: number): number {
  if (level <= 2) return 1;
  if (level <= 3) return 2;
  if (level <= 4) return 3;
  if (level <= 6) return 4;
  return 6;
}

/**
 * Classe les champions absents du plateau selon ce qu'ils apportent aux synergies :
 * +3 par palier franchi, puis un bonus dégressif quand ils rapprochent d'un palier.
 * Plusieurs pistes sont toujours renvoyées : c'est une aide à la décision, pas une consigne.
 */
export function suggest(champs: Champion[], set: GameSet, level: number, limit = 8): Suggestion[] {
  const counts = countTraits(champs);
  const onBoard = new Set(champs.map((c) => c.id));
  const traits = new Map(set.traits.map((t) => [t.name, t]));
  const maxCost = maxCostAtLevel(level);
  const out: Suggestion[] = [];

  for (const c of set.champions) {
    if (onBoard.has(c.id) || c.cost > maxCost) continue;
    let score = 0;
    const reasons: string[] = [];
    for (const name of c.traits) {
      const trait = traits.get(name);
      if (!trait) continue;
      const before = traitState(trait, counts.get(name) ?? 0);
      const after = traitState(trait, before.count + 1);
      if (after.tier > before.tier) {
        score += 3;
        reasons.push(`active ${name} ${after.count}`);
      } else if (after.next !== undefined && before.count > 0) {
        const missing = after.next - after.count;
        score += 1 / missing;
        reasons.push(`${name} ${after.count}/${after.next}`);
      }
    }
    if (score > 0) out.push({ champion: c, score: score + c.cost * 0.05, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.champion.name.localeCompare(b.champion.name)).slice(0, limit);
}
