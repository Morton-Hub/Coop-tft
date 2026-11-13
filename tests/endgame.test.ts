import { describe, expect, it } from 'vitest';
import { readEndScreen } from '../src/screen/endgame';
import type { ScreenFrame } from '../src/screen/match';
import { addRecord, compKey, SAME_GAME_MS, summarize, type GameRecord } from '../src/engine/history';
import endscreen from './fixtures/endscreen.json';
import releves from './fixtures/releves.json';

type Ligne = [string, number, number, number, number];
interface Releve {
  w: number;
  h: number;
  lignes: Ligne[];
}

const frame = (r: Releve, edit: (lignes: Ligne[]) => Ligne[] = (l) => l): ScreenFrame => ({
  width: r.w,
  height: r.h,
  lines: edit(r.lignes.map((l) => [...l] as Ligne)).map(([text, x, y, w, h]) => ({ text, x, y, w, h })),
});
const end = endscreen as unknown as Releve;
const games = (releves as unknown as { releves: Releve[] }).releves;

const without = (...texts: string[]) => (lignes: Ligne[]) => lignes.filter((l) => !texts.includes(l[0]));
const rename = (from: string, to: string) => (lignes: Ligne[]) => lignes.map((l) => (l[0] === from ? ([to, l[1], l[2], l[3], l[4]] as Ligne) : l));
const DIGITS = ['2', '3', '4', '5', '6', '7', '8'];

describe('écran de fin de partie', () => {
  it('lit la place et les pseudos sur le relevé réel', () => {
    expect(readEndScreen(frame(end), 'Mon Pseudo')).toEqual({
      placement: 8,
      players: ['Alpha', 'The Broken...', 'Bravo', 'Charlie', 'Deltaø', 'echo', 'foxtrot', 'Mon Pseudo'],
    });
  });

  it('trouve la 1re place alors que le chiffre « 1 » n\'est pas lu', () => {
    expect(readEndScreen(frame(end), 'Alpha')?.placement).toBe(1);
    // Même sans aucun chiffre de rang : huit lignes lues, la première est la 1re.
    expect(readEndScreen(frame(end, without(...DIGITS)), 'Alpha')?.placement).toBe(1);
    expect(readEndScreen(frame(end, without(...DIGITS)), 'Charlie')?.placement).toBe(4);
  });

  it('tolère la casse, les espaces et les accents changés par l\'OCR', () => {
    expect(readEndScreen(frame(end), 'monpseudo')?.placement).toBe(8);
    expect(readEndScreen(frame(end), 'MON  PSEUDO')?.placement).toBe(8);
    expect(readEndScreen(frame(end, rename('Mon Pseudo', 'MoNPseudo')), 'Mon Pseudo')?.placement).toBe(8);
    expect(readEndScreen(frame(end, rename('echo', 'Écho')), 'echo')?.placement).toBe(6);
    expect(readEndScreen(frame(end), 'Delta')?.placement).toBe(5);
  });

  it('reconnaît un pseudo tronqué par le jeu ou lu à une lettre près', () => {
    expect(readEndScreen(frame(end), 'The Broken Sword')?.placement).toBe(2);
    expect(readEndScreen(frame(end, rename('Mon Pseudo', 'Mon Pseuda')), 'Mon Pseudo')?.placement).toBe(8);
    expect(readEndScreen(frame(end, rename('Mon Pseudo', 'Mon Pseud')), 'Mon Pseudo')?.placement).toBe(8);
    // Deux pseudos à une lettre du sien : impossible de trancher.
    const twins = (l: Ligne[]) => rename('Alpha', 'Mon Pseuda')(rename('Mon Pseudo', 'Mon Pseudi')(l));
    expect(readEndScreen(frame(end, twins), 'Mon Pseudo')).toBeUndefined();
    // Mais le pseudo exact gagne sur un voisin approchant.
    expect(readEndScreen(frame(end, rename('Alpha', 'Mon Pseuda')), 'Mon Pseudo')?.placement).toBe(8);
  });

  it('ne décale pas les places quand un pseudo du milieu n\'est pas lu', () => {
    const read = readEndScreen(frame(end, without('Bravo')), 'Mon Pseudo');
    expect(read?.placement).toBe(8);
    expect(read?.players).toHaveLength(7);
    expect(readEndScreen(frame(end, without('Bravo', 'echo', ...DIGITS)), 'Charlie')?.placement).toBe(4);
  });

  it('se recale sur les chiffres de rang quand la première ligne manque', () => {
    expect(readEndScreen(frame(end, without('Alpha')), 'Mon Pseudo')?.placement).toBe(8);
    expect(readEndScreen(frame(end, without('Alpha')), 'The Broken Sword')?.placement).toBe(2);
    expect(readEndScreen(frame(end, without('Alpha', 'The Broken...')), 'Bravo')?.placement).toBe(3);
    // Dernière ligne manquante : les chiffres disent que la première lue est bien la 1re.
    expect(readEndScreen(frame(end, without('Mon Pseudo')), 'foxtrot')?.placement).toBe(7);
    // Un seul chiffre lu suffit s'il n'est contredit par aucun autre.
    expect(readEndScreen(frame(end, without('Alpha', ...DIGITS.filter((d) => d !== '5'))), 'Mon Pseudo')?.placement).toBe(8);
  });

  it('ne répond pas quand la place est ambiguë (ligne manquante en bord et aucun chiffre)', () => {
    expect(readEndScreen(frame(end, without('Alpha', ...DIGITS)), 'Mon Pseudo')).toBeUndefined();
    expect(readEndScreen(frame(end, without('Mon Pseudo', ...DIGITS)), 'Alpha')).toBeUndefined();
  });

  it('fait confiance à la position plutôt qu\'au chiffre lu sur la ligne du joueur', () => {
    // « 8 » lu « 3 » sur la ligne du joueur, colonne complète.
    const misread = (l: Ligne[]) => l.map((x) => (x[0] === '8' ? (['3', x[1], x[2], x[3], x[4]] as Ligne) : x));
    expect(readEndScreen(frame(end, misread), 'Mon Pseudo')?.placement).toBe(8);
    // Même erreur avec la première ligne manquante : les autres chiffres l'emportent à la majorité.
    expect(readEndScreen(frame(end, (l) => without('Alpha')(misread(l))), 'Mon Pseudo')?.placement).toBe(8);
    // Écart d'une seule place (« 8 » lu « 7 ») : même règle.
    const offByOne = (l: Ligne[]) => l.map((x) => (x[0] === '8' ? (['7', x[1], x[2], x[3], x[4]] as Ligne) : x));
    expect(readEndScreen(frame(end, (l) => without('Alpha')(offByOne(l))), 'Mon Pseudo')?.placement).toBe(8);
  });

  it('accepte le bouton en anglais et exige sa présence', () => {
    expect(readEndScreen(frame(end, rename('REJOUER', 'PLAY AGAIN')), 'Mon Pseudo')?.placement).toBe(8);
    expect(readEndScreen(frame(end, without('REJOUER')), 'Mon Pseudo')).toBeUndefined();
  });

  it('ignore les écrans de jeu, même avec le pseudo à l\'écran', () => {
    for (const r of games) {
      expect(readEndScreen(frame(r), 'Mon Pseudo')).toBeUndefined();
      // Un « Rejouer » parasite ne suffit pas : il faut aussi la colonne de pseudos.
      expect(readEndScreen(frame(r, (l) => [...l, ['REJOUER', 1757, 1663, 219, 40]]), 'Mon Pseudo')).toBeUndefined();
    }
  });

  it('ne répond pas pour un pseudo inconnu, vide ou une colonne trop courte', () => {
    expect(readEndScreen(frame(end), 'Quelqu\'un d\'autre')).toBeUndefined();
    expect(readEndScreen(frame(end), '')).toBeUndefined();
    expect(readEndScreen(frame(end), '12345')).toBeUndefined();
    expect(readEndScreen(frame(end, without('Alpha', 'Bravo', 'Charlie')), 'Mon Pseudo')).toBeUndefined();
  });

  it('refuse une colonne aux écarts irréguliers', () => {
    const shifted = (l: Ligne[]) => l.map((x) => (x[0] === 'Charlie' ? ([x[0], x[1], x[2] + 50, x[3], x[4]] as Ligne) : x));
    expect(readEndScreen(frame(end, shifted), 'Mon Pseudo')).toBeUndefined();
  });
});

describe('historique des parties', () => {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const game = (i: number, placement: number, traits?: string[], carry?: string): GameRecord => ({
    at: i * HOUR,
    placement,
    ...(traits ? { comp: { traits: traits.map((id) => ({ id, units: 4 })), ...(carry ? { carry } : {}) } } : {}),
  });
  const build = (records: GameRecord[]) => records.reduce((h, r) => addRecord(h, r), [] as GameRecord[]);

  it('n\'enregistre qu\'une fois l\'écran de fin relu en boucle', () => {
    let history: GameRecord[] = [];
    for (let i = 0; i < 40; i++) history = addRecord(history, { at: HOUR + i * 1500, placement: 3 });
    expect(history).toEqual([{ at: HOUR, placement: 3 }]);
    // Même tableau renvoyé : rien à réécrire.
    expect(addRecord(history, { at: HOUR + 5 * MIN, placement: 3 })).toBe(history);
    // Même place mais plus de 10 minutes après, ou autre place : une autre partie.
    expect(addRecord(history, { at: HOUR + SAME_GAME_MS, placement: 3 })).toHaveLength(2);
    expect(addRecord(history, { at: HOUR + MIN, placement: 4 })).toHaveLength(2);
    expect(history).toHaveLength(1);
  });

  it('complète la compo d\'une partie déjà enregistrée sans la dupliquer ni l\'écraser', () => {
    const first = addRecord([], { at: HOUR, placement: 2 });
    const comp = { traits: [{ id: 'TFT18_Bastion', units: 4 }], carry: 'TFT18_Azir' };
    const filled = addRecord(first, { at: HOUR + MIN, placement: 2, comp });
    expect(filled).toEqual([{ at: HOUR, placement: 2, comp }]);
    expect(first[0].comp).toBeUndefined();
    const other = { traits: [{ id: 'TFT18_Mage', units: 6 }] };
    expect(addRecord(filled, { at: HOUR + 2 * MIN, placement: 2, comp: other })).toBe(filled);
  });

  it('garde les parties les plus récentes, dans l\'ordre, et refuse une place invalide', () => {
    let history: GameRecord[] = [];
    for (let i = 0; i < 12; i++) history = addRecord(history, game(i, (i % 8) + 1), 5);
    expect(history.map((r) => r.at / HOUR)).toEqual([7, 8, 9, 10, 11]);
    // Une partie plus ancienne que toutes celles gardées ne chasse pas une récente.
    expect(addRecord(history, game(1, 2), 5).map((r) => r.at / HOUR)).toEqual([7, 8, 9, 10, 11]);
    expect(addRecord([game(5, 1)], game(2, 4)).map((r) => r.at / HOUR)).toEqual([2, 5]);
    let big: GameRecord[] = [];
    for (let i = 0; i < 230; i++) big = addRecord(big, game(i, 4));
    expect(big).toHaveLength(200);
    expect(big[0].at).toBe(30 * HOUR);
    for (const placement of [0, 9, 2.5, NaN]) expect(addRecord(history, game(20, placement))).toBe(history);
  });

  it('résume un historique vide sans diviser par zéro', () => {
    expect(summarize([])).toEqual({ games: 0, avgPlacement: 0, top4Rate: 0, winRate: 0, comps: [] });
  });

  it('calcule les chiffres d\'ensemble', () => {
    const s = summarize(build([game(1, 1), game(2, 4), game(3, 5), game(4, 8)]));
    expect(s).toMatchObject({ games: 4, avgPlacement: 4.5, top4Rate: 0.5, winRate: 0.25 });
    expect(s.trend).toBeUndefined();
  });

  it('regroupe par compo, quel que soit l\'ordre ou l\'écriture des traits', () => {
    const history = build([
      game(1, 1, ['TFT18_Bastion', 'TFT18_Mage'], 'TFT18_Azir'),
      game(2, 3, ['Set18_Mage', 'TFT18_Bastion'], 'TFT18_Azir'),
      game(3, 6, ['tft18_mage', 'tft18_bastion'], 'TFT18_Elise'),
      game(4, 2, ['TFT18_Chasseur']),
      game(5, 8, ['TFT18_Chasseur']),
      game(6, 7, ['TFT18_Bastion']),
      game(7, 4),
    ]);
    const s = summarize(history);
    expect(s.games).toBe(7);
    expect(s.comps.map((c) => [c.key, c.games])).toEqual([
      ['bastion+mage', 3],
      ['chasseur', 2],
      ['bastion', 1],
    ]);
    expect(s.comps[0]).toEqual({
      key: 'bastion+mage',
      traits: ['bastion', 'mage'],
      carry: 'azir',
      lastAt: 3 * HOUR,
      games: 3,
      avgPlacement: 3.33,
      top4Rate: 0.667,
      winRate: 0.333,
    });
    expect(s.comps[1]).toMatchObject({ avgPlacement: 5, top4Rate: 0.5, winRate: 0 });
    expect(s.comps[1].carry).toBeUndefined();
    expect(compKey({ traits: [{ id: 'TFT18_Mage', units: 2 }, { id: 'TFT18_Bastion', units: 4 }, { id: 'tft18_mage', units: 4 }] })).toBe('bastion+mage');
  });

  it('départage les compos autant jouées par la meilleure place moyenne', () => {
    const s = summarize(build([game(1, 6, ['TFT18_A']), game(2, 2, ['TFT18_B'])]));
    expect(s.comps.map((c) => c.key)).toEqual(['b', 'a']);
  });

  it('compare les 10 dernières parties aux 10 précédentes', () => {
    // 5 vieilles parties hors fenêtres (8e), puis 10 parties 6e, puis 10 parties 3e.
    const history = build([
      ...Array.from({ length: 5 }, (_, i) => game(i, 8)),
      ...Array.from({ length: 10 }, (_, i) => game(5 + i, 6)),
      ...Array.from({ length: 10 }, (_, i) => game(15 + i, i === 0 ? 1 : 3)),
    ]);
    const s = summarize(history);
    expect(s.trend?.previous).toEqual({ games: 10, avgPlacement: 6, top4Rate: 0, winRate: 0 });
    expect(s.trend?.recent).toEqual({ games: 10, avgPlacement: 2.8, top4Rate: 1, winRate: 0.1 });
    expect(s.trend?.delta).toBe(3.2);
    // L'ordre du tableau ne compte pas : c'est la date qui classe.
    expect(summarize(history.slice().reverse()).trend).toEqual(s.trend);
  });

  it('ne donne une tendance qu\'avec assez de parties avant les 10 dernières', () => {
    const many = (n: number) => build(Array.from({ length: n }, (_, i) => game(i, i < n - 10 ? 2 : 5)));
    expect(summarize(many(10)).trend).toBeUndefined();
    expect(summarize(many(14)).trend).toBeUndefined();
    const t = summarize(many(15)).trend;
    expect(t?.previous.games).toBe(5);
    expect(t?.recent.games).toBe(10);
    expect(t?.delta).toBe(-3);
  });
});
