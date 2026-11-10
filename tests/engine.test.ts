import { describe, expect, it } from 'vitest';
import { classifyRole, normalize } from '../src/data/cdragon';
import { DEMO_SET } from '../src/data/demo';
import type { Board } from '../src/data/types';
import { analyze, autoArrange, bestHex, colOf, hex, mirror, rowOf } from '../src/engine/positioning';
import { suggest } from '../src/engine/suggest';
import { boardChampions, countTraits, traitStates } from '../src/engine/traits';

const id = (origin: string, cl: string) => `demo_${origin}_${cl}`;
const champs = (...ids: string[]) => DEMO_SET.champions.filter((c) => ids.includes(c.id));

describe('traits', () => {
  it('compte les champions uniques et calcule les paliers', () => {
    const board: Board = { 0: id('Braise', 'Bastion'), 1: id('Braise', 'Bastion'), 2: id('Braise', 'Mage') };
    const units = boardChampions(board, DEMO_SET);
    expect(units).toHaveLength(3);
    expect(countTraits(units).get('Braise')).toBe(2);
    const braise = traitStates(units, DEMO_SET).find((t) => t.trait.name === 'Braise')!;
    expect(braise).toMatchObject({ count: 2, tier: 1, next: 4 });
    const bastion = traitStates(units, DEMO_SET).find((t) => t.trait.name === 'Bastion')!;
    expect(bastion).toMatchObject({ count: 1, tier: 0, next: 2 });
  });
});

describe('suggest', () => {
  it("met en tête l'unité qui franchit le plus de paliers", () => {
    const units = champs(id('Braise', 'Bastion'), id('Givre', 'Mage'));
    const [first] = suggest(units, DEMO_SET, 9);
    // Givre + Bastion ou Braise + Mage activent deux traits d'un coup.
    expect([id('Givre', 'Bastion'), id('Braise', 'Mage')]).toContain(first.champion.id);
    expect(first.reasons).toHaveLength(2);
  });
  it('exclut les unités déjà posées et les coûts hors de portée du niveau', () => {
    const units = champs(id('Braise', 'Bastion'));
    const res = suggest(units, DEMO_SET, 3, 50);
    expect(res.every((s) => s.champion.cost <= 2 && s.champion.id !== units[0].id)).toBe(true);
  });
});

describe('positioning', () => {
  it('place les tanks devant au centre et les carrys dans un coin du fond', () => {
    expect(bestHex('tank', {})).toBe(hex(0, 3));
    expect(bestHex('backline', {})).toBe(hex(3, 0));
    expect(bestHex('backline', { [hex(3, 0)]: 'x' })).toBe(hex(3, 1));
  });
  it('autoArrange corrige un plateau à l’envers, analyze le signale avant', () => {
    const bad: Board = { [hex(3, 3)]: id('Braise', 'Bastion'), [hex(0, 3)]: id('Braise', 'Tireur') };
    expect(analyze(bad, DEMO_SET).filter((t) => t.level === 'warn')).toHaveLength(2);
    const fixed = autoArrange(bad, DEMO_SET);
    const pos = Object.fromEntries(Object.entries(fixed).map(([i, c]) => [c, Number(i)]));
    expect(rowOf(pos[id('Braise', 'Bastion')])).toBe(0);
    expect(rowOf(pos[id('Braise', 'Tireur')])).toBe(3);
    expect(analyze(fixed, DEMO_SET).some((t) => t.level === 'warn')).toBe(false);
  });
  it('mirror inverse les colonnes', () => {
    const m = mirror({ [hex(3, 0)]: 'a', [hex(0, 2)]: 'b' });
    expect(m[hex(3, 6)]).toBe('a');
    expect(colOf(Number(Object.keys(m).find((k) => m[Number(k)] === 'b')))).toBe(4);
  });
});

describe('cdragon', () => {
  const champ = (n: number, extra: object = {}) => ({
    apiName: `TFT99_C${n}`,
    name: `C${n}`,
    cost: (n % 5) + 1,
    traits: [n % 2 ? 'Alpha' : 'Beta'],
    stats: { range: n % 3 === 0 ? 4 : 1, armor: 30 },
    tileIcon: 'ASSETS/Characters/TFT99_C/HUD/Tile.TFT_Set99.tex',
    ...extra,
  });
  const raw = {
    setData: [
      { number: 98, mutator: 'TFTSet98', champions: Array.from({ length: 25 }, (_, n) => champ(n)), traits: [] },
      { number: 99, mutator: 'TFTSet99_Mode', champions: Array.from({ length: 25 }, (_, n) => champ(n)), traits: [{ name: 'Alpha', effects: [{ minUnits: 2 }] }] },
      {
        number: 99,
        mutator: 'TFTSet99',
        champions: [
          ...Array.from({ length: 25 }, (_, n) => champ(n)),
          champ(0), // doublon
          champ(90, { traits: [] }), // invocation
          champ(91, { cost: 11 }), // unité spéciale
        ],
        traits: [
          { name: 'Alpha', effects: [{ minUnits: 4 }, { minUnits: 2 }] },
          { name: 'Beta', effects: [{ minUnits: 3 }] },
          { name: 'Inutilisé', effects: [{ minUnits: 2 }] },
        ],
      },
    ],
  };
  it('choisit le set standard le plus récent et filtre les unités non jouables', () => {
    const sets = normalize(raw);
    expect(sets.map((s) => s.key)).toEqual(['TFTSet99', 'TFTSet99_Mode']); // le 98 n'a pas de traits
    expect(sets[0].champions).toHaveLength(25);
    expect(sets[0].traits).toEqual([
      { name: 'Alpha', breakpoints: [2, 4] },
      { name: 'Beta', breakpoints: [3] },
    ]);
    expect(sets[0].champions[0].icon).toBe(
      'https://raw.communitydragon.org/latest/game/assets/characters/tft99_c/hud/tile.tft_set99.png',
    );
  });
  it('déduit le rôle de la portée, du rôle Riot ou de l’armure', () => {
    const base = { apiName: 'x', name: 'x', cost: 1 };
    expect(classifyRole({ ...base, stats: { range: 4 } })).toBe('backline');
    expect(classifyRole({ ...base, stats: { range: 2 } })).toBe('ranged');
    expect(classifyRole({ ...base, role: 'ADTank', stats: { range: 1 } })).toBe('tank');
    expect(classifyRole({ ...base, role: 'ADFighter', stats: { range: 1 } })).toBe('melee');
    expect(classifyRole({ ...base, stats: { range: 1, armor: 55 } })).toBe('tank');
  });
});
