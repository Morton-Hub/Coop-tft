import { describe, expect, it } from 'vitest';
import type { Champion, GameSet } from '../src/data/types';
import { adjust, createInventory, observe, rankComps, stars, type Inventory, type Observation } from '../src/engine/inventory';
import type { MetaComp } from '../src/meta/aggregate';

const champ = (name: string, cost: number): Champion => ({ id: `TFT18_${name}`, name, cost, traits: [], range: 1, role: 'melee' });
const A = champ('Ahri', 1);
const B = champ('Braum', 2);
const C = champ('Caitlyn', 3);
const D = champ('Draven', 4);
const E = champ('Ezreal', 5);
const F = champ('Fiora', 1);
const G = champ('Garen', 2);
const H = champ('Hecarim', 3);
const I = champ('Irelia', 4);
const J = champ('Jinx', 2);

type Frame = Omit<Observation, 'at'>;
/** Enchaîne des lectures espacées de 1,5 s. */
const run = (frames: Frame[], from: Inventory = createInventory()) =>
  frames.reduce((s, f, i) => observe(s, { ...f, at: (i + 1) * 1500 }), from);
const types = (s: Inventory) => s.events.map((e) => e.type);

describe('inventaire déduit de la boutique', () => {
  it('compte un achat quand l’or baisse du coût de la carte disparue', () => {
    const s = run([
      { shop: [A, B, C, D, E], gold: 20, stage: '3-2' },
      { shop: [A, B, D, E], gold: 17, stage: '3-2' },
    ]);
    expect(s.owned).toEqual({ TFT18_Caitlyn: 1 });
    expect(s.events).toEqual([{ type: 'purchase', at: 3000, id: 'TFT18_Caitlyn', name: 'Caitlyn', cost: 3, proof: 'gold' }]);
  });

  it('compte deux achats faits entre deux lectures si l’or baisse de leur somme', () => {
    const s = run([
      { shop: [A, B, C, D, E], gold: 20 },
      { shop: [A, C, E], gold: 14 },
    ]);
    expect(s.owned).toEqual({ TFT18_Braum: 1, TFT18_Draven: 1 });
  });

  it('distingue la carte achetée de celle mal lue grâce au montant', () => {
    // Caitlyn (3) et Ahri (1) disparaissent, l'or baisse de 3 : seule Caitlyn a été achetée.
    const s = run([
      { shop: [A, B, C, D, E], gold: 20 },
      { shop: [B, D, E], gold: 17 },
      { shop: [B, D, E], gold: 17 },
      { shop: [B, D, E], gold: 17 },
    ]);
    expect(s.owned).toEqual({ TFT18_Caitlyn: 1 });
  });

  it('ne compte rien si l’or lu n’a pas bougé', () => {
    const s = run([
      { shop: [A, B, C, D, E], gold: 20 },
      { shop: [A, B, D, E], gold: 20 },
      { shop: [A, B, D, E], gold: 20 },
      { shop: [A, B, D, E], gold: 20 },
    ]);
    expect(s.owned).toEqual({});
    expect(s.events).toEqual([]);
  });

  it('ne tranche pas quand deux cartes de même coût expliquent la baisse', () => {
    const s = run([
      { shop: [A, B, G, D, E], gold: 20 },
      { shop: [A, D, E], gold: 18 },
      { shop: [A, D, E], gold: 18 },
      { shop: [A, D, E], gold: 18 },
    ]);
    expect(s.owned).toEqual({});
  });

  it('sans or lisible, attend deux images de suite sans la carte', () => {
    const first = run([{ shop: [A, B, C, D, E] }, { shop: [A, B, D, E] }]);
    expect(first.owned).toEqual({});
    expect(first.shop.find((x) => x.champion === C)?.status).toBe('pending');
    const s = run([{ shop: [A, B, D, E] }], first);
    expect(s.owned).toEqual({ TFT18_Caitlyn: 1 });
    expect(s.events[s.events.length - 1]).toMatchObject({ type: 'purchase', id: 'TFT18_Caitlyn', proof: 'persistence' });
    // Et pas une seconde fois ensuite.
    expect(run([{ shop: [A, B, D, E] }, { shop: [A, B, D, E] }], s).owned).toEqual({ TFT18_Caitlyn: 1 });
  });

  it('confirme aussi quand l’or n’est lu que d’un côté', () => {
    const s = run([
      { shop: [A, B, C, D, E], gold: 20 },
      { shop: [A, B, D, E] },
      { shop: [A, B, D, E], gold: 17 },
    ]);
    expect(s.owned).toEqual({ TFT18_Caitlyn: 1 });
  });

  it('confirme par la durée un achat noyé dans une baisse d’or inexpliquée', () => {
    // Caitlyn (3) achetée et XP (4) achetée entre deux lectures : -7 ne correspond à aucune carte.
    const s = run([
      { shop: [A, B, C, D, E], gold: 20 },
      { shop: [A, B, D, E], gold: 13 },
      { shop: [A, B, D, E], gold: 13 },
    ]);
    expect(s.owned).toEqual({ TFT18_Caitlyn: 1 });
  });

  it('ignore une carte mal lue puis relue', () => {
    const s = run([
      { shop: [A, B, C, D, E] },
      { shop: [A, B, D, E] },
      { shop: [A, B, C, D, E] },
      { shop: [A, B, D, E] },
      { shop: [A, B, C, D, E] },
    ]);
    expect(s.owned).toEqual({});
    expect(s.events).toEqual([]);
  });

  it('annule un achat compté si la carte réapparaît dans la même boutique', () => {
    const s = run([
      { shop: [A, B, C, D, E] },
      { shop: [A, B, D, E] },
      { shop: [A, B, D, E] },
      { shop: [A, B, C, D, E] },
    ]);
    expect(s.owned).toEqual({});
    expect(types(s)).toEqual(['purchase', 'cancel']);
  });

  it('ne prend pas une relance pour des achats', () => {
    const s = run([
      { shop: [A, B, C, D, E], gold: 20, stage: '3-2' },
      { shop: [F, G, H, I, J], gold: 18, stage: '3-2' },
      { shop: [F, G, H, I, J], gold: 18, stage: '3-2' },
    ]);
    expect(s.owned).toEqual({});
    expect(s.events).toEqual([{ type: 'reroll', at: 3000, gold: -2 }]);
  });

  it('reconnaît une relance qui ressort des cartes déjà vues', () => {
    // Braum (2) n'est plus là et l'or baisse de 2 : sans l'ordre et les nouvelles cartes, on croirait à un achat.
    const s = run([
      { shop: [A, B, C, D, E], gold: 20 },
      { shop: [C, A, F, G, E], gold: 18 },
      { shop: [C, A, F, G, E], gold: 18 },
    ]);
    expect(s.owned).toEqual({});
    expect(types(s)).toEqual(['reroll']);
  });

  it('repart d’une boutique neuve après une relance, et y voit les achats', () => {
    const s = run([
      { shop: [A, B, C, D, E], gold: 20 },
      { shop: [F, G, H, I, J], gold: 18 },
      { shop: [F, G, H, J], gold: 14 },
    ]);
    expect(s.owned).toEqual({ TFT18_Irelia: 1 });
  });

  it('remplace la boutique au changement de manche sans rien acheter', () => {
    const s = run([
      { shop: [A, B, C, D, E], gold: 20, stage: '3-2' },
      { shop: [F, G, H, I, J], gold: 27, stage: '3-3' },
      { shop: [F, G, H, I, J], gold: 27, stage: '3-3' },
    ]);
    expect(s.owned).toEqual({});
    expect(s.events).toEqual([{ type: 'round', at: 3000, stage: '3-3' }]);
    expect(s.stage).toBe('3-3');
  });

  it('ignore les images où la boutique est masquée', () => {
    const s = run([
      { shop: [A, B, C, D, E], gold: 20, stage: '3-2' },
      { shop: [], stage: '3-2' },
      { shop: [], gold: 20 },
      { shop: [] },
      { shop: [], gold: 12 },
      { shop: [A, B, C, D, E], gold: 20, stage: '3-2' },
    ]);
    expect(s.owned).toEqual({});
    expect(s.events).toEqual([]);
    expect(s.shop.every((x) => x.status === 'seen')).toBe(true);
  });

  it('ne se fie pas à l’or d’avant une boutique masquée', () => {
    // L'or a baissé de 3 pendant que la boutique était masquée : ce n'est pas une preuve pour Caitlyn.
    const hidden = run([
      { shop: [A, B, C, D, E], gold: 20 },
      { shop: [], gold: 17 },
      { shop: [A, B, D, E], gold: 17 },
    ]);
    expect(hidden.owned).toEqual({});
    // Mais elle reste candidate, et sera comptée si elle manque encore à l'image suivante.
    expect(run([{ shop: [A, B, D, E], gold: 17 }], hidden).owned).toEqual({ TFT18_Caitlyn: 1 });
  });

  it('prend trois cartes disparues d’un coup sans or pour une boutique en partie masquée', () => {
    const s = run([{ shop: [A, B, C, D, E] }, { shop: [A, B] }, { shop: [A, B] }, { shop: [A, B] }]);
    expect(s.owned).toEqual({});
  });

  it('gère les doublons : une seule des deux cartes identiques est achetée', () => {
    const s = run([
      { shop: [A, B, A, D, E] },
      { shop: [A, B, D, E] },
      { shop: [A, B, D, E] },
      { shop: [A, B, D, E] },
    ]);
    expect(s.owned).toEqual({ TFT18_Ahri: 1 });
  });

  it('complète une boutique lue en partie sans y voir de relance', () => {
    const s = run([
      { shop: [A, B, D, E], gold: 20 },
      { shop: [A, B, C, D, E], gold: 20 },
      { shop: [A, B, C, E], gold: 16 },
    ]);
    expect(types(s)).toEqual(['purchase']);
    expect(s.owned).toEqual({ TFT18_Draven: 1 });
  });

  it('trois exemplaires achetés font un 2 étoiles', () => {
    const s = run([
      { shop: [A, B, A, D, A], gold: 10, stage: '2-1' },
      { shop: [B, A, D, A], gold: 9, stage: '2-1' },
      { shop: [B, D, A], gold: 8, stage: '2-1' },
      { shop: [B, D], gold: 7, stage: '2-1' },
    ]);
    expect(s.owned).toEqual({ TFT18_Ahri: 3 });
    expect(stars(s.owned.TFT18_Ahri)).toBe(2);
    expect([0, 1, 2, 3, 8, 9, 12].map(stars)).toEqual([1, 1, 1, 2, 2, 3, 3]);
  });

  it('cumule les exemplaires d’une boutique à l’autre', () => {
    const s = run([
      { shop: [A, B, C, D, E], gold: 20 },
      { shop: [B, C, D, E], gold: 19 },
      { shop: [F, A, H, I, J], gold: 17 },
      { shop: [F, H, I, J], gold: 16 },
    ]);
    expect(s.owned).toEqual({ TFT18_Ahri: 2 });
  });

  it('repart de zéro à la nouvelle partie, une fois le recul de manche confirmé', () => {
    const played = run([
      { shop: [A, B, C, D, E], gold: 20, stage: '5-3' },
      { shop: [A, B, D, E], gold: 17, stage: '5-3' },
    ]);
    expect(played.owned).toEqual({ TFT18_Caitlyn: 1 });
    // Une seule lecture en arrière peut être une erreur de lecture : on garde tout.
    const once = run([{ shop: [], stage: '2-1' }], played);
    expect(once.owned).toEqual({ TFT18_Caitlyn: 1 });
    expect(run([{ shop: [], stage: '5-3' }], once).owned).toEqual({ TFT18_Caitlyn: 1 });
    const s = run([{ shop: [F, G, H, I, J], gold: 4, stage: '2-1' }], once);
    expect(s.owned).toEqual({});
    expect(s.stage).toBe('2-1');
    expect(s.events[s.events.length - 1]).toEqual({ type: 'game', at: 1500, stage: '2-1' });
    expect(s.shop.map((x) => x.champion.name)).toEqual(['Fiora', 'Garen', 'Hecarim', 'Irelia', 'Jinx']);
  });

  it('ne modifie jamais l’état reçu, garde le niveau et borne le journal', () => {
    const before = run([{ shop: [A, B, C, D, E], gold: 20, level: 6 }]);
    const snapshot = JSON.stringify(before);
    const after = observe(before, { shop: [A, B, D, E], gold: 17, at: 9 });
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after.level).toBe(6);
    expect(adjust(after, C.id, -1).owned).toEqual({});
    expect(adjust(after, A.id, 2).owned).toEqual({ TFT18_Caitlyn: 1, TFT18_Ahri: 2 });

    const frames: Frame[] = [];
    for (let i = 0; i < 100; i++) frames.push({ shop: i % 2 ? [A, B, C, D, E] : [F, G, H, I, J] });
    expect(run(frames).events).toHaveLength(40);
  });
});

describe('compos méta selon l’inventaire', () => {
  const set: GameSet = { key: 't', number: 18, label: 'Test', items: {}, champions: [A, B, C, D, E, F, G, H, I, J], traits: [] };
  const comp = (o: Partial<MetaComp>): MetaComp => ({
    tier: 'A',
    traits: [],
    units: [],
    carries: [],
    count: 100,
    pickRate: 0.1,
    avgPlacement: 4.2,
    top4: 0.5,
    win: 0.1,
    ...o,
  });
  const x = comp({ units: ['XX_18_Ahri', 'XX_18_Braum', 'XX_18_Caitlyn'], avgPlacement: 4.4 });
  const y = comp({ units: ['XX_18_Ezreal', 'XX_18_Fiora'], carries: [{ id: 'XX_18_Ezreal', items: [] }], avgPlacement: 4.1 });
  const z = comp({ units: ['XX_18_Garen', 'XX_18_Hecarim'], core: ['XX_18_Hecarim'], avgPlacement: 3.9 });

  it('garde l’ordre d’origine quand on ne possède rien', () => {
    const ranked = rankComps({}, [x, y, z], set);
    expect(ranked.map((f) => f.comp)).toEqual([x, y, z]);
    expect(ranked.every((f) => f.score === 0 && f.owned.length === 0)).toBe(true);
  });

  it('rapproche les ids du set de ceux de la méta par leur forme canonique', () => {
    const ranked = rankComps({ TFT18_Ezreal: 1 }, [x, y, z], set);
    expect(ranked[0].comp).toBe(y);
    expect(ranked[0].index).toBe(1);
    expect(ranked[0].owned).toEqual([{ champion: E, copies: 1, core: false, carry: true }]);
    // Les compos sans aucune unité possédée restent dans l'ordre d'origine.
    expect(ranked.slice(1).map((f) => f.comp)).toEqual([x, z]);
  });

  it('pèse par le coût, et davantage les carries et les unités core', () => {
    // Ahri + Braum + Caitlyn = 6 ; Ezreal carry = 5 × 2 = 10 ; Hecarim core = 3 × 1,5 = 4,5.
    const ranked = rankComps({ TFT18_Ahri: 1, TFT18_Braum: 1, TFT18_Caitlyn: 1, TFT18_Ezreal: 1, TFT18_Hecarim: 1 }, [x, y, z], set);
    expect(ranked.map((f) => [f.comp, f.score])).toEqual([[y, 10], [x, 6], [z, 4.5]]);
    expect(ranked[1].owned.map((u) => u.champion.name)).toEqual(['Caitlyn', 'Braum', 'Ahri']);
  });

  it('valorise les exemplaires déjà montés en étoiles et ignore les ids inconnus', () => {
    const ranked = rankComps({ TFT18_Ahri: 3, TFT18_Inconnu: 2, TFT18_Garen: 0 }, [z, x], set);
    expect(ranked.map((f) => [f.comp, f.score])).toEqual([[x, 1.5], [z, 0]]);
  });

  it('départage les égalités par la meilleure place moyenne', () => {
    const p = comp({ units: ['XX_18_Draven'], avgPlacement: 4.5 });
    const q = comp({ units: ['XX_18_Draven', 'XX_18_Jinx'], avgPlacement: 4.0 });
    expect(rankComps({ TFT18_Draven: 1 }, [p, q], set).map((f) => f.comp)).toEqual([q, p]);
  });

  it('compte moitié moins une unité présente seulement dans un plateau type', () => {
    const v = comp({ units: ['XX_18_Ahri'], variants: { '9': ['XX_18_Ahri', 'XX_18_Irelia'] } });
    expect(rankComps({ TFT18_Irelia: 1 }, [v], set)[0]).toMatchObject({ score: 2, owned: [{ champion: I }] });
  });
});
