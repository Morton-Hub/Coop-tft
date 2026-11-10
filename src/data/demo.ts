import type { Champion, GameSet, Role } from './types';

/** Jeu de données fictif, utilisé uniquement si les vraies données sont injoignables. */
const ORIGINS = ['Braise', 'Givre', 'Ombre', 'Sylve'];
const CLASSES: { name: string; role: Role; range: number }[] = [
  { name: 'Bastion', role: 'tank', range: 1 },
  { name: 'Colosse', role: 'tank', range: 1 },
  { name: 'Duelliste', role: 'melee', range: 1 },
  { name: 'Mage', role: 'backline', range: 4 },
  { name: 'Tireur', role: 'backline', range: 4 },
  { name: 'Invocateur', role: 'ranged', range: 2 },
];

const champions: Champion[] = [];
CLASSES.forEach((cl, ci) =>
  ORIGINS.forEach((origin, oi) => {
    const cost = ((ci + oi * 2) % 5) + 1;
    champions.push({
      id: `demo_${origin}_${cl.name}`,
      name: `${cl.name} de ${origin}`,
      cost,
      traits: [origin, cl.name],
      range: cl.range,
      role: cl.role,
    });
  }),
);
champions.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));

export const DEMO_SET: GameSet = {
  key: 'demo',
  label: 'Données de démo (fictives)',
  demo: true,
  champions,
  traits: [
    ...ORIGINS.map((name) => ({ name, breakpoints: [2, 4, 6] })),
    ...CLASSES.map((c) => ({ name: c.name, breakpoints: [2, 4] })),
  ],
};
