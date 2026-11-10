import type { GameSet, Item } from '../data/types';
import { canon } from '../meta/aggregate';

export interface ItemNeed {
  /** Identifiant canonique de l'objet. */
  key: string;
  item: Item;
  /** Composants (identifiants canoniques) ; vide si l'objet ne se fabrique pas. */
  parts: string[];
}

export function resolveItems(ids: string[], set: GameSet): ItemNeed[] {
  return ids.flatMap((id) => {
    const item = set.items[canon(id)];
    return item ? [{ key: canon(id), item, parts: item.from ?? [] }] : [];
  });
}

/** Composants à prioriser (carrousel, PvE) : ceux qui reviennent le plus dans les objets visés. */
export function componentPriority(needs: ItemNeed[]): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of needs) for (const p of n.parts) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Objets visés que l'on peut fabriquer avec les composants en main (chaque composant ne sert qu'une fois). */
export function buildable(needs: ItemNeed[], held: Record<string, number>): ItemNeed[] {
  const left = { ...held };
  const out: ItemNeed[] = [];
  for (const n of needs) {
    if (n.parts.length !== 2) continue;
    const [a, b] = n.parts;
    const ok = a === b ? (left[a] ?? 0) >= 2 : (left[a] ?? 0) >= 1 && (left[b] ?? 0) >= 1;
    if (!ok) continue;
    left[a]--;
    left[b]--;
    out.push(n);
  }
  return out;
}
