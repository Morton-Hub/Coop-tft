import { useEffect, useMemo, useState } from 'react';
import { loadSets } from './data/cdragon';
import { DEMO_SET } from './data/demo';
import { COLS, ROWS, type Board, type Champion, type GameSet } from './data/types';
import { analyze, autoArrange, bestHex, hex, mirror, SCOUTING_CHECKLIST } from './engine/positioning';
import { suggest } from './engine/suggest';
import { boardChampions, traitStates } from './engine/traits';
import { useStored } from './storage';

type Tab = 'units' | 'advice' | 'comps';
interface SavedComp {
  name: string;
  setKey: string;
  board: Board;
}

function Icon({ c }: { c: Champion }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`icon cost-${c.cost}`}>
      {c.icon && !broken ? (
        <img src={c.icon} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className="initials">{c.name.slice(0, 3)}</span>
      )}
    </span>
  );
}

export default function App() {
  const [sets, setSets] = useState<GameSet[]>([DEMO_SET]);
  const [status, setStatus] = useState<'loading' | 'live' | 'demo'>('loading');
  const [setKey, setSetKey] = useStored<string | null>('coop-tft:set', null);
  const [board, setBoard] = useStored<Board>('coop-tft:board', {});
  const [level, setLevel] = useStored('coop-tft:level', 6);
  const [comps, setComps] = useStored<SavedComp[]>('coop-tft:comps', []);
  const [tab, setTab] = useState<Tab>('units');
  const [selected, setSelected] = useState<number | null>(null);
  const [traitFilter, setTraitFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = (force: boolean) => {
    setStatus('loading');
    loadSets(force)
      .then((s) => {
        setSets(s);
        setStatus('live');
      })
      .catch(() => {
        setSets([DEMO_SET]);
        setStatus('demo');
      });
  };
  useEffect(() => load(false), []);

  const set = sets.find((s) => s.key === setKey) ?? sets[0];
  const byId = useMemo(() => new Map(set.champions.map((c) => [c.id, c])), [set]);
  const units = useMemo(() => boardChampions(board, set), [board, set]);
  const traits = useMemo(() => traitStates(units, set), [units, set]);
  const tips = useMemo(() => analyze(board, set), [board, set]);
  const ideas = useMemo(() => suggest(units, set, level), [units, set, level]);
  const topTip = tips.find((t) => t.level === 'warn') ?? tips[0];
  const full = units.length >= level;

  const palette = set.champions.filter(
    (c) =>
      (!traitFilter || c.traits.includes(traitFilter)) &&
      (!search || c.name.toLowerCase().includes(search.toLowerCase())),
  );

  const add = (c: Champion) => {
    const i = bestHex(c.role, board);
    if (i === undefined) return;
    setBoard({ ...board, [i]: c.id });
    setSelected(null);
  };
  const tapHex = (i: number) => {
    if (selected === null) return setSelected(board[i] !== undefined ? i : null);
    if (selected !== i) {
      const next = { ...board };
      const moving = next[selected];
      if (next[i] !== undefined) next[selected] = next[i];
      else delete next[selected];
      next[i] = moving;
      setBoard(next);
    }
    setSelected(null);
  };
  const removeSelected = () => {
    if (selected === null) return;
    const next = { ...board };
    delete next[selected];
    setBoard(next);
    setSelected(null);
  };
  const changeSet = (key: string) => {
    setSetKey(key);
    setBoard({});
    setSelected(null);
    setTraitFilter(null);
  };
  const saveComp = () => {
    const name = prompt('Nom de la compo ?')?.trim();
    if (name) setComps([...comps.filter((c) => c.name !== name), { name, setKey: set.key, board }]);
  };

  return (
    <div className="app">
      <header>
        <strong>Coop TFT</strong>
        <select value={set.key} onChange={(e) => changeSet(e.target.value)} aria-label="Set">
          {sets.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="level">
          Niv.
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <span className={`count ${units.length > level ? 'over' : ''}`}>
          {units.length}/{level}
        </span>
      </header>

      {status === 'demo' && (
        <div className="banner">
          Données réelles injoignables : jeu de démo fictif affiché.{' '}
          <button onClick={() => load(true)}>Réessayer</button>
        </div>
      )}
      {status === 'loading' && <div className="banner">Chargement des données du set…</div>}

      <main>
        <section className="left">
          <div className="board" aria-label="Plateau">
            <div className="side">▲ ennemi</div>
            {Array.from({ length: ROWS }, (_, r) => (
              <div className={`row ${r % 2 ? 'odd' : ''}`} key={r}>
                {Array.from({ length: COLS }, (_, col) => {
                  const i = hex(r, col);
                  const c = byId.get(board[i]);
                  return (
                    <button
                      key={i}
                      className={`hex ${selected === i ? 'sel' : ''} ${c ? `cost-${c.cost}` : ''}`}
                      style={{ gridColumn: `${col * 2 + 1 + (r % 2)} / span 2` }}
                      onClick={() => tapHex(i)}
                      aria-label={c ? c.name : `Case vide ${r + 1}-${col + 1}`}
                    >
                      {c && <Icon c={c} />}
                      {c && <span className="hexname">{c.name}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="actions">
            <button onClick={() => setBoard(autoArrange(board, set))} disabled={!units.length}>
              Auto-placer
            </button>
            <button onClick={() => setBoard(mirror(board))} disabled={!units.length}>
              Inverser
            </button>
            <button onClick={removeSelected} disabled={selected === null}>
              Retirer
            </button>
            <button
              onClick={() => {
                setBoard({});
                setSelected(null);
              }}
              disabled={!units.length}
            >
              Vider
            </button>
          </div>
          <button className={`tipbar ${topTip.level}`} onClick={() => setTab('advice')}>
            {topTip.text}
            {tips.length > 1 && <small> +{tips.length - 1}</small>}
          </button>
        </section>

        <section className="traitcol">
          <div className="traits">
            {traits.map((t) => (
              <button
                key={t.trait.name}
                className={`trait tier-${Math.min(t.tier, 3)} ${traitFilter === t.trait.name ? 'on' : ''}`}
                onClick={() => {
                  setTraitFilter(traitFilter === t.trait.name ? null : t.trait.name);
                  setTab('units');
                }}
              >
                <b>{t.count}</b> {t.trait.name}
                <small>{t.trait.breakpoints.join('·')}</small>
              </button>
            ))}
            {!traits.length && <span className="muted">Les synergies s'affichent ici.</span>}
          </div>
        </section>

        <section className="right">
          <nav>
            {(
              [
                ['units', 'Unités'],
                ['advice', `Conseils${tips.some((t) => t.level === 'warn') ? ' ⚠' : ''}`],
                ['comps', 'Mes compos'],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </nav>

          {tab === 'units' && (
            <div className="panel">
              <div className="filters">
                <input placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} />
                {traitFilter && <button onClick={() => setTraitFilter(null)}>{traitFilter} ✕</button>}
              </div>
              <div className="palette">
                {palette.map((c) => (
                  <button key={c.id} className="unit" onClick={() => add(c)} title={c.traits.join(', ')}>
                    <Icon c={c} />
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'advice' && (
            <div className="panel">
              <h3>Placement</h3>
              <ul className="tips">
                {tips.map((t, k) => (
                  <li key={k} className={t.level}>
                    {t.text}
                  </li>
                ))}
              </ul>
              <h3>Pistes pour la suite {full && <small>(plateau plein : en remplacement)</small>}</h3>
              {ideas.length ? (
                <div className="ideas">
                  {ideas.map((s) => (
                    <button key={s.champion.id} className="idea" onClick={() => add(s.champion)}>
                      <Icon c={s.champion} />
                      <span>
                        <b>{s.champion.name}</b>
                        <small>{s.reasons.join(' · ')}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">Pose quelques unités pour voir quelles synergies compléter.</p>
              )}
              <h3>À vérifier en scoutant</h3>
              <ul className="check">
                {SCOUTING_CHECKLIST.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'comps' && (
            <div className="panel">
              <button onClick={saveComp} disabled={!units.length}>
                Enregistrer le plateau actuel
              </button>
              <ul className="comps">
                {comps
                  .filter((c) => c.setKey === set.key)
                  .map((c) => (
                    <li key={c.name}>
                      <button
                        className="load"
                        onClick={() => {
                          setBoard(c.board);
                          setSelected(null);
                        }}
                      >
                        <b>{c.name}</b>
                        <small>
                          {Object.values(c.board)
                            .map((id) => byId.get(id)?.name)
                            .filter(Boolean)
                            .join(', ')}
                        </small>
                      </button>
                      <button onClick={() => setComps(comps.filter((x) => x !== c))} aria-label="Supprimer">
                        ✕
                      </button>
                    </li>
                  ))}
              </ul>
              {!comps.some((c) => c.setKey === set.key) && (
                <p className="muted">
                  Recopie ici les compos méta que tu veux jouer : tu les rechargeras en un tap en début de partie.
                </p>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
