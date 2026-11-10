import type { Champion, GameSet } from '../data/types';

/*
 * Tables standard de TFT. Elles bougent légèrement d'un set à l'autre : les pourcentages
 * affichés sont des ordres de grandeur, pas des valeurs exactes du patch.
 */
/** Probabilité (en %) qu'une case de boutique propose une unité de coût 1 à 5, par niveau. */
export const SHOP_ODDS: Record<number, number[]> = {
  1: [100, 0, 0, 0, 0],
  2: [100, 0, 0, 0, 0],
  3: [75, 25, 0, 0, 0],
  4: [55, 30, 15, 0, 0],
  5: [45, 33, 20, 2, 0],
  6: [30, 40, 25, 5, 0],
  7: [19, 30, 40, 10, 1],
  8: [17, 24, 32, 24, 3],
  9: [15, 18, 25, 30, 12],
  10: [5, 10, 20, 40, 25],
};
/** Or nécessaire pour passer au niveau suivant en partant de 0 XP (4 or = 4 XP). */
export const GOLD_TO_LEVEL: Record<number, number> = { 1: 2, 2: 2, 3: 6, 4: 10, 5: 20, 6: 36, 7: 48, 8: 76, 9: 84 };
/** Niveau où l'on cherche son carry, selon son coût. */
const KEY_LEVEL: Record<number, number> = { 1: 5, 2: 6, 3: 7, 4: 8, 5: 9 };
/** Courbe de niveau standard : [manche, niveau attendu]. */
const CURVE: [number, number][] = [
  [2.1, 4],
  [2.5, 5],
  [3.2, 6],
  [4.1, 7],
  [4.5, 8],
  [5.5, 9],
];

export interface Situation {
  level: number;
  gold: number;
  hp: number;
  /** Manche sous la forme « 3-2 ». */
  stage: string;
}
export interface Plan {
  /** Unités recherchées (celles de la compo visée). */
  targets: Champion[];
  /** Coût du carry principal : il fixe le niveau où dépenser. */
  carryCost: number;
}
export type Action = 'save' | 'level' | 'roll' | 'allin';
export interface Advice {
  action: Action;
  title: string;
  reasons: string[];
}

export const stageValue = (stage: string) => {
  const [s, r] = stage.split('-').map(Number);
  return (s || 1) + (r || 1) / 10;
};
export const expectedLevel = (stage: string) =>
  CURVE.reduce((lvl, [at, l]) => (stageValue(stage) >= at ? l : lvl), 3);
export const keyLevel = (carryCost: number) => KEY_LEVEL[Math.min(5, Math.max(1, carryCost))];
export const interest = (gold: number) => Math.min(5, Math.floor(gold / 10));

/** Chance (0-1) qu'une boutique de 5 cases contienne au moins une des unités recherchées. */
export function hitChance(level: number, targets: Champion[], set: GameSet): number {
  const odds = SHOP_ODDS[Math.min(10, Math.max(1, level))];
  const perCost = new Map<number, number>();
  for (const c of set.champions) perCost.set(c.cost, (perCost.get(c.cost) ?? 0) + 1);
  let slot = 0;
  for (const t of new Map(targets.map((c) => [c.id, c])).values())
    slot += (odds[t.cost - 1] ?? 0) / 100 / (perCost.get(t.cost) ?? 1);
  return 1 - (1 - Math.min(1, slot)) ** 5;
}

const pct = (p: number) => `${Math.round(p * 100)} %`;

export function advise(sit: Situation, plan: Plan, set: GameSet): Advice {
  const { level, gold, hp, stage } = sit;
  const key = keyLevel(plan.carryCost);
  const reroll = plan.carryCost <= 2;
  const levelCost = GOLD_TO_LEVEL[level];
  const canLevel = levelCost !== undefined && gold >= levelCost;
  const reasons: string[] = [];

  if (plan.targets.length) {
    const now = hitChance(level, plan.targets, set);
    const what = plan.targets.length === 1 ? plan.targets[0].name : 'une unité de ta compo';
    let line = `Au niveau ${level}, une boutique montre ${what} ${pct(now)} du temps`;
    if (level < 10) line += ` ; au niveau ${level + 1}, ${pct(hitChance(level + 1, plan.targets, set))}`;
    reasons.push(`${line}.`);
  }
  reasons.push(
    reroll
      ? `Carry à ${plan.carryCost} PO : compo de reroll, on reste au niveau ${key} pour le monter 3 étoiles.`
      : `Carry à ${plan.carryCost} PO : c'est au niveau ${key} qu'on le trouve le mieux.`,
  );
  const toNext = 10 - (gold % 10);
  const interestNote =
    gold < 50
      ? `${interest(gold)} or d'intérêts par tour ; encore ${toNext} or pour le palier suivant.`
      : "Intérêts au maximum (5 or par tour) : tout ce qui dépasse 50 or peut être dépensé sans rien perdre.";

  // PV critiques : la survie passe avant l'économie.
  if (hp <= 30) {
    if (level < key && canLevel && gold - levelCost! >= 20)
      return {
        action: 'allin',
        title: `Monte niveau ${level + 1} puis roll tout`,
        reasons: [`${hp} PV : une ou deux défaites et c'est fini, l'or gardé ne sert plus à rien.`, ...reasons],
      };
    return {
      action: 'allin',
      title: 'Roll tout maintenant',
      reasons: [`${hp} PV : stabilise ton plateau tout de suite, l'or gardé ne sert plus à rien.`, ...reasons],
    };
  }

  // PV sous pression : on dépense pour arrêter l'hémorragie, en gardant un fond de caisse.
  if (hp <= 55) {
    if (level < key && !reroll && canLevel && gold - levelCost! >= 10)
      return {
        action: 'level',
        title: `Monte niveau ${level + 1}, puis roll jusqu'à 20 or`,
        reasons: [`${hp} PV : tu ne peux plus te permettre de perdre en attendant les intérêts.`, ...reasons],
      };
    if (gold >= 30)
      return {
        action: 'roll',
        title: 'Roll jusqu’à 20 or',
        reasons: [`${hp} PV : renforce ton plateau maintenant, puis reconstruis ton économie.`, ...reasons],
      };
    return {
      action: 'save',
      title: 'Économise encore un tour ou deux',
      reasons: [`${hp} PV mais seulement ${gold} or : un roll à sec changerait peu de chose.`, interestNote, ...reasons],
    };
  }

  // PV confortables : on joue l'économie.
  if (reroll) {
    if (level < key && canLevel && level < expectedLevel(stage))
      return { action: 'level', title: `Monte niveau ${level + 1}`, reasons: [...reasons, interestNote] };
    if (level >= key && gold > 50)
      return {
        action: 'roll',
        title: `Roll l'excédent au-dessus de 50 or (${gold - 50} or)`,
        reasons: [...reasons, interestNote],
      };
    return { action: 'save', title: 'Économise jusqu’à 50 or', reasons: [...reasons, interestNote] };
  }
  if (level < key) {
    if (level < expectedLevel(stage) && canLevel && (gold - levelCost! >= 50 || gold - levelCost! >= 10 * interest(gold) - 10))
      return {
        action: 'level',
        title: `Monte niveau ${level + 1}`,
        reasons: [`Manche ${stage} : le rythme standard est le niveau ${expectedLevel(stage)}.`, ...reasons, interestNote],
      };
    return {
      action: 'save',
      title: gold >= 50 ? `Garde tes 50 or, monte niveau ${level + 1} avec l'excédent` : 'Économise jusqu’à 50 or',
      reasons: [`${hp} PV : tu as de la marge, laisse travailler les intérêts.`, ...reasons, interestNote],
    };
  }
  if (gold >= 50)
    return {
      action: 'roll',
      title: 'Roll jusqu’à 30 or pour compléter ta compo',
      reasons: [`Tu es au niveau clé (${key}) avec ${gold} or : c'est le moment de dépenser.`, ...reasons],
    };
  return {
    action: 'save',
    title: 'Économise jusqu’à 50 or avant de roll',
    reasons: [`Tu es au niveau clé (${key}) et en bonne santé : rien ne presse.`, ...reasons, interestNote],
  };
}
