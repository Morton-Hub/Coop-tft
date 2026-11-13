export type Role = 'tank' | 'melee' | 'ranged' | 'backline';

export interface Champion {
  id: string; // apiName
  name: string;
  cost: number;
  traits: string[]; // noms affichés, identiques à Trait.name
  range: number;
  role: Role;
  icon?: string;
}

export interface Trait {
  id: string; // apiName
  name: string;
  breakpoints: number[]; // nombre d'unités par palier, croissant
}

export interface Item {
  name: string;
  icon?: string;
  /** Recette : identifiants canoniques des deux composants. */
  from?: string[];
  /** Vrai pour les objets standards ou propres au set en cours (pas les emblèmes d'anciens sets). */
  current?: boolean;
}

export interface GameSet {
  key: string;
  number: number;
  label: string;
  /** Objets, indexés par identifiant canonique (voir canon()). */
  items: Record<string, Item>;
  champions: Champion[];
  traits: Trait[];
  demo?: boolean;
}

export const ROWS = 4;
export const COLS = 7;
/** Plateau : index de case (0..27) -> id du champion. Ligne 0 = première ligne (face à l'ennemi). */
export type Board = Record<number, string>;
