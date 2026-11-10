import { COLS, ROWS, type Board, type Champion, type GameSet, type Role } from '../data/types';

export const hex = (row: number, col: number) => row * COLS + col;
export const rowOf = (i: number) => Math.floor(i / COLS);
export const colOf = (i: number) => i % COLS;

const CENTER_OUT = [3, 2, 4, 1, 5, 0, 6];
const CORNER_FIRST = [0, 1, 6, 2, 5, 3, 4];

/** Cases préférées par rôle, de la meilleure à la moins bonne. */
const PREFERRED: Record<Role, number[]> = {
  tank: [0, 1, 2, 3].flatMap((r) => CENTER_OUT.map((c) => hex(r, c))),
  melee: [0, 1, 2, 3].flatMap((r) => [2, 4, 1, 5, 3, 0, 6].map((c) => hex(r, c))),
  ranged: [2, 3, 1, 0].flatMap((r) => CENTER_OUT.map((c) => hex(r, c))),
  backline: [3, 2, 1, 0].flatMap((r) => CORNER_FIRST.map((c) => hex(r, c))),
};

export function bestHex(role: Role, board: Board): number | undefined {
  return PREFERRED[role].find((i) => board[i] === undefined);
}

const ROLE_ORDER: Role[] = ['backline', 'tank', 'ranged', 'melee'];

/** Replace toutes les unités : carry principal dans un coin du fond, tanks au centre devant. */
export function autoArrange(board: Board, set: GameSet): Board {
  const byId = new Map(set.champions.map((c) => [c.id, c]));
  const units = Object.values(board)
    .map((id) => byId.get(id))
    .filter((c): c is Champion => !!c)
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || b.cost - a.cost);
  const next: Board = {};
  for (const u of units) {
    const i = bestHex(u.role, next);
    if (i !== undefined) next[i] = u.id;
  }
  return next;
}

export interface Tip {
  level: 'warn' | 'info' | 'ok';
  text: string;
  /** Case concernée, pour la signaler sur le plateau. */
  hex?: number;
}

export function analyze(board: Board, set: GameSet): Tip[] {
  const byId = new Map(set.champions.map((c) => [c.id, c]));
  const units = Object.entries(board)
    .map(([i, id]) => ({ i: Number(i), c: byId.get(id) }))
    .filter((u): u is { i: number; c: Champion } => !!u.c);
  if (!units.length) return [{ level: 'info', text: 'Ajoute tes unités pour obtenir une analyse du placement.' }];

  const tips: Tip[] = [];
  const front = units.filter((u) => u.c.role === 'tank' || u.c.role === 'melee');
  const back = units.filter((u) => u.c.role === 'backline' || u.c.role === 'ranged');

  for (const u of units) {
    const row = rowOf(u.i);
    if (u.c.role === 'backline' && row <= 1)
      tips.push({ level: 'warn', text: `${u.c.name} (portée ${u.c.range}) est trop avancé : place-le au fond.`, hex: u.i });
    if (u.c.role === 'tank' && row >= 2)
      tips.push({ level: 'warn', text: `${u.c.name} est un tank : il doit encaisser en première ligne.`, hex: u.i });
    if (u.c.role === 'melee' && row === ROWS - 1)
      tips.push({ level: 'info', text: `${u.c.name} est au corps-à-corps : au fond, il perd du temps à marcher.` });
  }

  if (back.length && !front.length)
    tips.push({ level: 'warn', text: 'Aucune première ligne : tes carrys seront ciblés immédiatement.' });
  else if (back.length >= 2 && front.length * 2 < back.length)
    tips.push({ level: 'info', text: 'Première ligne légère par rapport à ta ligne arrière.' });

  const carry = back.slice().sort((a, b) => b.c.cost - a.c.cost || b.c.range - a.c.range)[0];
  if (carry && front.length) {
    const covered = front.some((f) => rowOf(f.i) < rowOf(carry.i) && Math.abs(colOf(f.i) - colOf(carry.i)) <= 1);
    if (!covered)
      tips.push({
        level: 'info',
        text: `Personne ne couvre ${carry.c.name} : mets un tank dans sa colonne ou une colonne voisine.`,
      });
  }

  const backRowCols = units.filter((u) => rowOf(u.i) === ROWS - 1).map((u) => colOf(u.i)).sort((a, b) => a - b);
  let run = 1;
  for (let k = 1; k < backRowCols.length; k++) {
    run = backRowCols[k] === backRowCols[k - 1] + 1 ? run + 1 : 1;
    if (run === 4) {
      tips.push({ level: 'info', text: 'Ligne arrière très groupée : écarte-la face aux dégâts de zone.' });
      break;
    }
  }

  if (!tips.some((t) => t.level === 'warn'))
    tips.unshift({ level: 'ok', text: 'Structure saine : tanks devant, carrys derrière.' });
  return tips;
}

/** Rappels à vérifier soi-même en regardant les adversaires (l'app ne lit pas la partie). */
export const SCOUTING_CHECKLIST = [
  'Assassins / plongeurs en face : ramène ton carry vers le centre du fond et entoure-le.',
  'Grappins ou sorts qui ciblent le plus éloigné : place un appât dans le coin, pas ton carry.',
  'Gros dégâts de zone en face : espace tes unités, évite les blocs compacts.',
  'Le carry adverse est dans un coin : mets ton tank principal et tes contrôles du même côté.',
  'Avant chaque combat de joueur : regarde le plateau du prochain adversaire probable et inverse gauche/droite si besoin.',
];

/** Miroir gauche/droite du plateau. */
export function mirror(board: Board): Board {
  const next: Board = {};
  for (const [i, id] of Object.entries(board)) next[hex(rowOf(Number(i)), COLS - 1 - colOf(Number(i)))] = id;
  return next;
}
