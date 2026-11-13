import { normText, type ScreenFrame, type ScreenLine } from './match';

export interface EndScreen {
  /** Place finale du joueur, de 1 à 8. */
  placement: number;
  /** Pseudos lus dans le classement, de haut en bas (une ligne non lue par l'OCR manque simplement). */
  players: string[];
}

/** Libellé du bouton pour relancer une partie (interface en français ou en anglais). */
const REPLAY_WORDS = ['rejouer', 'playagain'];
/** Nombre de joueurs d'une partie, donc de lignes du classement. */
const SLOTS = 8;
/** En dessous, la colonne de pseudos n'est pas assez nette pour conclure. */
const MIN_ROWS = 6;

const centerY = (l: ScreenLine) => l.y + l.h / 2;

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Vrai si a et b sont identiques à une lettre près (changée, ajoutée ou retirée). */
function nearlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let ea = a.length;
  let eb = b.length;
  while (ea > i && eb > i && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  return ea - i <= 1 && eb - i <= 1;
}

/**
 * Indice de la ligne du joueur parmi les pseudos. On accepte, par ordre de confiance :
 * le pseudo exact (après normText), un pseudo tronqué par le jeu (« The Broken... »), puis un
 * pseudo à une lettre près (« Ronse » pour « Ronce »). Une correspondance approchée ne compte
 * que si elle est unique : deux candidats = on ne sait pas, on ne répond pas.
 */
function findPlayer(names: string[], playerName: string): number {
  const wanted = normText(playerName);
  if (wanted.length < 2) return -1;
  const norms = names.map(normText);
  const only = (test: (n: string, i: number) => boolean) => {
    const hits = norms.map((n, i) => (test(n, i) ? i : -1)).filter((i) => i >= 0);
    return hits.length === 1 ? hits[0] : -1;
  };
  const exact = only((n) => n === wanted);
  if (exact >= 0) return exact;
  if (norms.includes(wanted)) return -1;
  const truncated = only((n, i) => /(\.{2,}|…)\s*$/.test(names[i]) && n.length >= 4 && wanted.startsWith(n));
  if (truncated >= 0) return truncated;
  return wanted.length >= 5 ? only((n) => nearlyEqual(n, wanted)) : -1;
}

/**
 * Reconnaît l'écran de fin de partie et y lit la place du joueur.
 *
 * Règles calées sur UN seul relevé réel (TFT mobile, interface française) :
 * - l'écran n'est retenu que si le bouton « REJOUER » / « PLAY AGAIN » est lu ET qu'au moins six
 *   textes sont alignés à gauche sur une même colonne, à intervalles verticaux réguliers : c'est le
 *   classement, un pseudo par ligne ;
 * - chaque pseudo reçoit un numéro de ligne d'après l'écart vertical (un pseudo manqué par l'OCR
 *   laisse un trou, il ne décale pas les suivants) ;
 * - reste à savoir à quelle place correspond la première ligne lue. Si la colonne couvre huit lignes,
 *   c'est forcément la 1re. Sinon ce sont les chiffres de rang lus à gauche des pseudos qui le disent,
 *   à la majorité : chaque chiffre « vote » pour un décalage entre numéro de ligne et place.
 *
 * Choix en cas de désaccord entre le chiffre lu sur la ligne du joueur et sa position dans la colonne :
 * la position l'emporte. Le chiffre du joueur n'est qu'une voix parmi les autres ; un chiffre isolé est
 * la lecture la plus fragile de l'écran (le « 1 » manque dans le relevé réel, et un « 7 » se lit vite
 * « 1 »), alors que la géométrie de huit lignes régulières et l'accord de plusieurs chiffres ne se
 * trompent pas ensemble. Sans aucun chiffre ni colonne complète, la place est ambiguë : on ne renvoie
 * rien plutôt qu'une place fausse qui irait dans l'historique.
 */
export function readEndScreen(frame: ScreenFrame, playerName: string): EndScreen | undefined {
  if (!frame.lines.some((l) => REPLAY_WORDS.includes(normText(l.text)))) return undefined;

  // Colonne de pseudos : le plus grand groupe de textes dont le bord gauche est aligné.
  const candidates = frame.lines.filter((l) => l.text.trim().length >= 2 && !REPLAY_WORDS.includes(normText(l.text)));
  const tolerance = frame.width * 0.02;
  let column: ScreenLine[] = [];
  for (const anchor of candidates) {
    const group = candidates.filter((l) => Math.abs(l.x - anchor.x) <= tolerance);
    if (group.length > column.length) column = group;
  }
  if (column.length < MIN_ROWS || column.length > SLOTS) return undefined;
  column = column.slice().sort((a, b) => centerY(a) - centerY(b));

  // Numéro de ligne de chaque pseudo, d'après le pas vertical (médiane des écarts).
  const gaps = column.slice(1).map((l, i) => centerY(l) - centerY(column[i]));
  const pitch = median(gaps);
  if (pitch < frame.height * 0.015) return undefined;
  const rows = [0];
  for (const gap of gaps) {
    const steps = Math.round(gap / pitch);
    if (steps < 1 || Math.abs(gap / pitch - steps) > 0.25) return undefined;
    rows.push(rows[rows.length - 1] + steps);
  }
  const lastRow = rows[rows.length - 1];
  if (lastRow > SLOTS - 1) return undefined;

  const names = column.map((l) => l.text.trim());
  const mine = findPlayer(names, playerName);
  if (mine < 0) return undefined;

  // Place de la première ligne lue.
  let first: number | undefined;
  if (lastRow === SLOTS - 1) first = 1;
  else {
    const left = Math.min(...column.map((l) => l.x));
    const votes = new Map<number, number>();
    for (const l of frame.lines) {
      const text = l.text.trim();
      if (!/^[1-8]$/.test(text) || l.x + l.w > left || l.x < left - frame.width * 0.2) continue;
      const row = column.findIndex((c) => Math.abs(centerY(c) - centerY(l)) <= pitch * 0.3);
      if (row < 0) continue;
      const candidate = Number(text) - rows[row];
      if (candidate >= 1 && candidate + lastRow <= SLOTS) votes.set(candidate, (votes.get(candidate) ?? 0) + 1);
    }
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) first = ranked[0][0];
  }
  if (first === undefined) return undefined;

  return { placement: first + rows[mine], players: names };
}
