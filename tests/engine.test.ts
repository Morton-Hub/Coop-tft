import { describe, expect, it } from 'vitest';
import { classifyRole, normalize } from '../src/data/cdragon';
import { DEMO_SET } from '../src/data/demo';
import type { Board } from '../src/data/types';
import { analyze, autoArrange, bestHex, colOf, hex, mirror, rowOf } from '../src/engine/positioning';
import { suggest } from '../src/engine/suggest';
import { boardChampions, countTraits, traitStates } from '../src/engine/traits';
import { adjusted, aggregate, canon, patchOf, prettyId, signature, type RawMatch, type RawParticipant } from '../src/meta/aggregate';

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
    const set = normalize({ ...raw, items: [
      { apiName: 'TFT_Item_Bloodthirster', name: 'Soif-de-sang', icon: 'ASSETS/Items/BT.tex' },
      { apiName: 'TFT9_Augment_X', name: 'Optimisation' },
    ] })!;
    expect(set.label).toBe('Set 99'); // pas la variante de mode, pas le set 98 sans traits
    expect(set.number).toBe(99);
    expect(set.champions).toHaveLength(25);
    expect(set.traits).toEqual([
      { id: 'Alpha', name: 'Alpha', breakpoints: [2, 4] },
      { id: 'Beta', name: 'Beta', breakpoints: [3] },
    ]);
    expect(set.champions[0].icon).toBe(
      'https://raw.communitydragon.org/latest/game/assets/characters/tft99_c/hud/tile.tft_set99.png',
    );
    expect(Object.keys(set.items)).toEqual(['bloodthirster']);
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

describe('meta', () => {
  const trait = (name: string, num_units: number, style: number) => ({ name, num_units, style, tier_current: style ? 1 : 0 });
  const board = (placement: number, kind: 'mage' | 'tank'): RawParticipant =>
    kind === 'mage'
      ? {
          placement,
          traits: [trait('Set_Mage', 6, 3), trait('Set_Bastion', 2, 1), trait('Set_Unique', 1, 4), trait('Set_Off', 1, 0)],
          units: [
            { character_id: 'M_Carry', itemNames: ['Item_A', 'Item_B', 'Item_C'] },
            ...['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map((character_id) => ({ character_id })),
            { character_id: placement % 2 ? 'M_Flex1' : 'M_Flex2' },
          ],
        }
      : {
          placement,
          traits: [trait('Set_Colosse', 4, 2), trait('Set_Tireur', 4, 2)],
          units: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map((character_id) => ({ character_id })),
        };
  const match = (version: string, queue = 1100, setNumber = 18): RawMatch => ({
    info: {
      queue_id: queue,
      tft_set_number: setNumber,
      game_version: `Linux Version 16.${version} (Nov 01 2026) [PUBLIC] <Releases/16.${version}>`,
      // Les mages finissent 1-4, les tanks 5-8.
      participants: [1, 2, 3, 4, 5, 6, 7, 8].map((p) => board(p, p <= 4 ? 'mage' : 'tank')),
    },
  });

  it('lit le patch et la signature d’un plateau', () => {
    expect(patchOf(match('22').info.game_version)).toBe('16.22');
    expect(signature(board(1, 'mage')).map((t) => t.name)).toEqual(['Set_Mage', 'Set_Bastion']);
  });

  it('compare les ids sans préfixe, numéro de set ni « Item_ »', () => {
    expect(canon('TFT18_Sejuani')).toBe('sejuani');
    expect(canon('XX_18_Sejuani')).toBe('sejuani');
    expect(canon('XX_Draven18')).toBe('draven');
    expect(canon('TFT18_Akali_AD')).toBe(canon('XX_18_Akali_AD'));
    expect(canon('TFT_Item_GargoyleStoneplate')).toBe(canon('XX_GargoyleStoneplate'));
    expect(prettyId('XX_18_EmblemInvoker')).toBe('Emblem Invoker');
  });

  it('lisse les petits échantillons vers la moyenne', () => {
    expect(adjusted(2.65, 17)).toBeGreaterThan(adjusted(3.82, 83) - 0.4);
    expect(adjusted(2.65, 17)).toBeCloseTo(3.65, 2);
    expect(adjusted(4.5, 5)).toBe(4.5);
  });

  it('regroupe par compo, ne garde que le dernier patch classé et classe par place moyenne', () => {
    const matches = [
      ...Array.from({ length: 30 }, () => match('22')),
      ...Array.from({ length: 10 }, () => match('21')),
      match('22', 1090), // partie non classée
      match('22', 1100, 17), // ancien set
    ];
    const meta = aggregate(matches, { region: 'euw1', now: new Date('2026-11-10T00:00:00Z') });
    expect(meta).toMatchObject({ set: 18, patch: '16.22', matches: 30, boards: 240, region: 'euw1' });
    expect(meta.comps).toHaveLength(2);
    const [mage, tank] = meta.comps;
    expect(mage).toMatchObject({ tier: 'S', avgPlacement: 2.5, top4: 1, win: 0.25, pickRate: 0.5, count: 120 });
    expect(mage.traits).toEqual([
      { id: 'Set_Mage', units: 6 },
      { id: 'Set_Bastion', units: 2 },
    ]);
    expect(mage.units).toEqual(['M_Carry', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M_Flex1', 'M_Flex2']);
    expect(mage.carries).toEqual([{ id: 'M_Carry', items: ['Item_A', 'Item_B', 'Item_C'] }]);
    expect(tank).toMatchObject({ tier: 'C', avgPlacement: 6.5, top4: 0, carries: [] });
  });
});
