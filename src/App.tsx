import { useEffect, useMemo, useState } from 'react';
import { loadSet } from './data/cdragon';
import { DEMO_SET } from './data/demo';
import { COLS, ROWS, type Board, type Champion, type GameSet } from './data/types';
import { analyze, autoArrange, bestHex, hex, mirror, SCOUTING_CHECKLIST } from './engine/positioning';
import { suggest } from './engine/suggest';
import { boardChampions, traitStates } from './engine/traits';
import { canon, prettyId, type MetaComp } from './meta/aggregate';
import { ago, loadMeta, type MetaResult } from './meta/load';
import { useStored } from './storage';

type Tab = 'meta' | 'units' | 'advice' | 'comps';
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
  const [set, setSet] = useState<GameSet>(DEMO_SET);
  const [meta, setMeta] = useState<MetaResult | 'loading' | 'error'>('loading');
  const [status, setStatus] = useState<'loading' | 'live' | 'demo'>('loading');
  const [board, setBoard] = useStored<Board>('coop-tft:board', {});
  const [level, setLevel] = useStored('coop-tft:level', 6);
  const [comps, setComps] = useStored<SavedComp[]>('coop-tft:comps', []);
  const [tab, setTab] = useState<Tab>('meta');
  const [selected, setSelected] = useState<number | null>(null);
  const [traitFilter, setTraitFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [costFilter, setCostFilter] = useState<number | null>(null);

  const load = (force: boolean) => {
    setStatus('loading');
    loadSet(force)
      .then((s) => {
        setSet(s);
        setStatus('live');
      })
      .catch(() => {
        setSet(DEMO_SET);
        setStatus('demo');
      });
  };
  const refreshMeta = (force: boolean) => {
    setMeta('loading');
    loadMeta(force)
      .then(setMeta)
      .catch(() => setMeta('error'));
  };
  useEffect(() => {
    load(false);
    refreshMeta(false);
  }, []);

  const byId = useMemo(() => new Map(set.champions.map((c) => [c.id, c])), [set]);
  // L'API Riot et Community Dragon n'écrivent pas les ids de la même façon : on compare leur forme canonique.
  const byCanon = useMemo(() => new Map(set.champions.map((c) => [canon(c.id), c])), [set]);
  const traitName = useMemo(() => new Map(set.traits.map((t) => [canon(t.id), t.name])), [set]);
  const units = useMemo(() => boardChampions(board, set), [board, set]);
  const traits = useMemo(() => traitStates(units, set), [units, set]);
  const tips = useMemo(() => analyze(board, set), [board, set]);
  const ideas = useMemo(() => suggest(units, set, level), [units, set, level]);
  const topTip = tips.find((t) => t.level === 'warn') ?? tips[0];
  const full = units.length >= level;

  const costs = useMemo(() => [...new Set(set.champions.map((c) => c.cost))].sort(), [set]);
  const palette = set.champions.filter(
    (c) =>
      (!traitFilter || c.traits.includes(traitFilter)) &&
      (!costFilter || c.cost === costFilter) &&
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
  const compUnits = (c: MetaComp) =>
    c.units.map((id) => byCanon.get(canon(id))).filter((u): u is Champion => !!u);
  const loadComp = (c: MetaComp) => {
    const raw: Board = {};
    compUnits(c).forEach((u, i) => (raw[i] = u.id));
    setBoard(autoArrange(raw, set));
    setLevel(Math.min(10, Math.max(level, Object.keys(raw).length)));
    setSelected(null);
  };
  const saveComp = () => {
    const name = prompt('Nom de la compo ?')?.trim();
    if (name) setComps([...comps.filter((c) => c.name !== name), { name, setKey: set.key, board }]);
  };

  return (
    <div className="app">
      <header>
        <strong>Coop TFT</strong>
        <span className="setname">
          {set.label}
          {typeof meta === 'object' && meta.meta.set === set.number && ` · patch ${meta.meta.patch}`}
        </span>
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
                ['meta', 'Méta'],
                ['units', 'Unités'],
                ['advice', `Conseils${tips.some((t) => t.level === 'warn') ? ' ⚠' : ''}`],
                ['comps', 'Perso'],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </nav>

          {tab === 'meta' && (
            <div className="panel">
              {meta === 'loading' && <p className="muted">Chargement de la méta…</p>}
              {meta === 'error' && (
                <p className="muted">
                  Méta indisponible pour l'instant : le fichier de données n'est pas encore publié ou le réseau est
                  coupé. <button onClick={() => refreshMeta(true)}>Réessayer</button>
                </p>
              )}
              {typeof meta === 'object' && (
                <>
                  <div className="metahead">
                    <small>
                      Patch {meta.meta.patch} · {meta.meta.matches} parties {meta.meta.region.toUpperCase()} haut
                      niveau · {ago(meta.meta.generatedAt)}
                      {meta.stale && ' · hors ligne'}
                    </small>
                    <button onClick={() => refreshMeta(true)} aria-label="Actualiser">
                      ↻
                    </button>
                  </div>
                  {meta.meta.set !== set.number && status === 'live' && (
                    <p className="muted">Ces statistiques portent sur le set {meta.meta.set}, pas sur le set chargé.</p>
                  )}
                  <ul className="metalist">
                    {meta.meta.comps.map((c, k) => (
                      <li key={k}>
                        <button className="comp" onClick={() => loadComp(c)}>
                          <span className={`tier tier-${c.tier}`}>{c.tier}</span>
                          <span className="compbody">
                            <b>
                              {c.traits.map((t) => `${t.units} ${traitName.get(canon(t.id)) ?? prettyId(t.id)}`).join(' · ')}
                            </b>
                            <small>
                              Place moy. {c.avgPlacement.toFixed(2)} · Top 4 {Math.round(c.top4 * 100)} % · Victoire{' '}
                              {Math.round(c.win * 100)} % · Jouée {(c.pickRate * 100).toFixed(1)} %
                            </small>
                            <span className="compunits">
                              {compUnits(c).map((u) => (
                                <Icon key={u.id} c={u} />
                              ))}
                            </span>
                            {c.carries.map((car) => {
                              const u = byCanon.get(canon(car.id));
                              return (
                                u && (
                                  <small key={car.id}>
                                    {u.name} : {car.items.map((it) => set.items[canon(it)]?.name ?? prettyId(it)).join(', ')}
                                  </small>
                                )
                              );
                            })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {tab === 'units' && (
            <div className="panel">
              <div className="filters">
                <input placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} />
                {costs.map((n) => (
                  <button
                    key={n}
                    className={`costbtn cost-${n} ${costFilter === n ? 'on' : ''}`}
                    onClick={() => setCostFilter(costFilter === n ? null : n)}
                    aria-label={`Coût ${n}`}
                  >
                    {n}
                  </button>
                ))}
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
