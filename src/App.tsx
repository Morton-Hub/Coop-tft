import { useEffect, useMemo, useState } from 'react';
import { copyText } from './clipboard';
import { Bar, Icon } from './components';
import { loadSet } from './data/cdragon';
import { DEMO_SET } from './data/demo';
import { COLS, ROWS, type Board, type Champion, type GameSet } from './data/types';
import { advise, hitChance, income, interest, type Action, type Situation } from './engine/economy';
import { addRecord, summarize, type GameRecord } from './engine/history';
import { rankComps, stars } from './engine/inventory';
import { buildable, componentPriority, resolveItems } from './engine/items';
import { analyze, autoArrange, bestHex, hex, mirror, SCOUTING_CHECKLIST } from './engine/positioning';
import { suggest } from './engine/suggest';
import { boardChampions, traitStates } from './engine/traits';
import { canon, prettyId, type MetaComp } from './meta/aggregate';
import { ago, loadMeta, type MetaResult } from './meta/load';
import type { Hud } from './screen/match';
import { requestSnapshot, screenReaderAvailable } from './screen/reader';
import { useScreenReader } from './screen/useScreenReader';
import { useStored } from './storage';
import { APK_URL, updateAvailable } from './update';

type Tab = 'live' | 'meta' | 'units' | 'advice' | 'comps' | 'screen';
interface SavedComp {
  name: string;
  setKey: string;
  board: Board;
}

const ACTION_LOOK: Record<Action, { icon: string; label: string }> = {
  save: { icon: '💰', label: 'Économise' },
  level: { icon: '⬆️', label: 'Monte de niveau' },
  roll: { icon: '🎲', label: 'Roll' },
  allin: { icon: '🔥', label: 'Roll tout' },
};

export default function App() {
  const [set, setSet] = useState<GameSet>(DEMO_SET);
  const [meta, setMeta] = useState<MetaResult | 'loading' | 'error'>('loading');
  const [status, setStatus] = useState<'loading' | 'live' | 'demo'>('loading');
  const [board, setBoard] = useStored<Board>('coop-tft:board', {});
  const [level, setLevel] = useStored('coop-tft:level', 6);
  const [comps, setComps] = useStored<SavedComp[]>('coop-tft:comps', []);
  const [plan, setPlan] = useStored<MetaComp | null>('coop-tft:plan', null);
  const [planLevel, setPlanLevel] = useStored('coop-tft:planlevel', 8);
  const [game, setGame] = useStored('coop-tft:game', { stage: '2-1', gold: 10, hp: 100 });
  const [held, setHeld] = useStored<Record<string, number>>('coop-tft:held', {});
  const [autoFill, setAutoFill] = useStored('coop-tft:autofill', true);
  const [tab, setTab] = useState<Tab>('meta');
  const [selected, setSelected] = useState<number | null>(null);
  const [traitFilter, setTraitFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [costFilter, setCostFilter] = useState<number | null>(null);
  const [update, setUpdate] = useState(false);
  const [copied, setCopied] = useState(false);

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
    // La mise à jour ne concerne que l'app Android installée : vérifiée à l'ouverture, puis à chaque
    // retour dans l'app (au plus toutes les 10 minutes).
    if (!screenReaderAvailable()) return;
    let last = 0;
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 600000) return;
      last = Date.now();
      updateAvailable().then((yes) => yes && setUpdate(true));
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);

  const screen = useScreenReader(set.champions, set.key, set.items);
  const { reading, hud: autoRead, shop, gameState, shots, samples, player, setPlayer, frame, owned, ended, bench } = screen;
  const [history, setHistory] = useStored<GameRecord[]>('coop-tft:history', []);
  // Le texte brut change à chaque image : on ne le suit que lorsque son onglet est ouvert.
  screen.watchRaw(tab === 'screen');

  const byId = useMemo(() => new Map(set.champions.map((c) => [c.id, c])), [set]);
  // L'API Riot et Community Dragon n'écrivent pas les ids de la même façon : on compare leur forme canonique.
  const byCanon = useMemo(() => new Map(set.champions.map((c) => [canon(c.id), c])), [set]);
  const traitName = useMemo(() => new Map(set.traits.map((t) => [canon(t.id), t.name])), [set]);
  const units = useMemo(() => boardChampions(board, set), [board, set]);
  const traits = useMemo(() => traitStates(units, set), [units, set]);
  const tips = useMemo(() => analyze(board, set), [board, set]);
  const ideas = useMemo(() => suggest(units, set, level), [units, set, level]);
  // Carry principal : celui de la compo méta chargée, sinon l'unité à distance la plus chère du plateau.
  const carry = useMemo(() => {
    const fromPlan = plan?.carries.map((k) => byCanon.get(canon(k.id))).find(Boolean);
    if (fromPlan) return fromPlan;
    const ranged = units.filter((u) => u.role === 'backline' || u.role === 'ranged');
    return (ranged.length ? ranged : units).slice().sort((a, b) => b.cost - a.cost)[0];
  }, [plan, byCanon, units]);
  // Probabilités de boutique lues à l'écran : valables seulement pour le niveau où elles ont été lues.
  const liveOdds = reading === 'on' && autoRead.odds && autoRead.level === level ? autoRead.odds : undefined;
  // Coût réel du prochain niveau, d'après l'XP lue à l'écran (4 or donnent 4 XP).
  const levelCost =
    reading === 'on' && autoRead.xp && autoRead.level === level
      ? Math.ceil((autoRead.xp.total - autoRead.xp.have) / 4) * 4
      : undefined;
  const streak = reading === 'on' ? autoRead.streak : undefined;
  const situation: Situation = { level, ...game, levelCost, streak };
  const econ = useMemo(
    () => (carry ? advise(
            { level, ...game, levelCost, streak },
            { targets: [carry], carryCost: carry.cost, keyLevel: plan?.level, reroll: plan?.reroll, odds: liveOdds },
            set,
          ) : null),
    [level, game, units, carry, set, plan, liveOdds, levelCost, streak],
  );
  const itemNeeds = useMemo(
    () =>
      (plan?.carries ?? []).map((k) => ({
        unit: byCanon.get(canon(k.id)),
        needs: resolveItems(k.items, set),
      })),
    [plan, byCanon, set],
  );
  const allNeeds = itemNeeds.flatMap((n) => n.needs);
  const parts = componentPriority(allNeeds);
  // Composants en main : ceux reconnus sur le banc quand la lecture en trouve, sinon la saisie manuelle.
  const benchSeen = reading === 'on' && Object.keys(bench).length > 0;
  const inHand = benchSeen ? bench : held;
  const ready = buildable(allNeeds, inHand);

  // Fin de partie reconnue à l'écran : on l'ajoute à l'historique avec la compo qui était visée.
  useEffect(() => {
    if (!ended) return;
    const comp = plan ? { traits: plan.traits, carry: plan.carries[0]?.id } : undefined;
    setHistory((h) => addRecord(h, { at: ended.at, placement: ended.placement, comp }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended]);
  const summary = useMemo(() => summarize(history), [history]);

  // Inventaire déduit des achats : unités possédées, ce qui manque au plateau visé, compos qui collent.
  const ownedUnits = useMemo(
    () =>
      Object.entries(owned)
        .map(([id, copies]) => ({ unit: byId.get(id), copies }))
        .filter((o): o is { unit: Champion; copies: number } => !!o.unit && o.copies > 0)
        .sort((a, b) => b.copies - a.copies || b.unit.cost - a.unit.cost),
    [owned, byId],
  );
  const hasOwned = ownedUnits.length > 0;
  const missing = useMemo(() => (hasOwned ? units.filter((u) => !owned[u.id]) : []), [hasOwned, units, owned]);
  const fits = useMemo(
    () => (typeof meta === 'object' ? rankComps(owned, meta.meta.comps, set) : []),
    [owned, meta, set],
  );

  const mode: Action | 'idle' = econ?.action ?? 'idle';
  const badHexes = new Set(tips.filter((t) => t.level === 'warn' && t.hex !== undefined).map((t) => t.hex));
  const warnings = tips.filter((t) => t.level === 'warn');
  const hpTone = game.hp <= 30 ? 'red' : game.hp <= 55 ? 'orange' : 'green';

  // Pastille : grise = lecture arrêtée, orange = lecture active sans jeu visible, verte = TFT détecté.
  const dot =
    reading !== 'on'
      ? { cls: 'off', label: 'Lecture arrêtée' }
      : gameState === 'game'
        ? { cls: 'game', label: 'Partie détectée' }
        : gameState === 'lobby'
          ? { cls: 'game', label: 'TFT détecté (menu)' }
          : { cls: 'wait', label: 'Jeu non détecté' };
  // Unités de la boutique qui font partie du plan (le plateau chargé) ou qui en complètent une synergie.
  const planIds = useMemo(() => new Set(Object.values(board)), [board]);
  const ideaIds = useMemo(() => new Set(ideas.map((s) => s.champion.id)), [ideas]);
  const toBuy = useMemo(() => shop.filter((c) => planIds.has(c.id)), [shop, planIds]);

  // Remplissage automatique depuis les valeurs lues à l'écran (déjà confirmées par deux lectures).
  useEffect(() => {
    if (reading !== 'on' || !autoFill) return;
    if (autoRead.level !== undefined && autoRead.level !== level) setLevel(autoRead.level);
    const next = {
      stage: autoRead.stage ?? game.stage,
      gold: autoRead.gold ?? game.gold,
      hp: autoRead.hp !== undefined && autoRead.hp >= 1 ? autoRead.hp : game.hp,
    };
    if (next.stage !== game.stage || next.gold !== game.gold || next.hp !== game.hp) setGame(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRead, reading, autoFill]);
  const auto = (k: keyof Hud) => reading === 'on' && autoFill && autoRead[k] !== undefined;

  const lines = (f: { lines: { text: string; x: number; y: number; w: number; h: number }[] }) =>
    f.lines.map((l) => [l.text, l.x, l.y, l.w, l.h]);
  const copy = async (payload: unknown) => {
    await copyText(JSON.stringify(payload));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const copyDiagnostic = () =>
    frame &&
    copy({
      w: frame.width,
      h: frame.height,
      etat: gameState,
      boutique: shop.map((c) => c.name),
      lu: autoRead,
      objets: screen.benchReads,
      lignes: lines(frame),
    });
  const copySamples = () =>
    copy({ releves: samples.map((x) => ({ w: x.f.width, h: x.f.height, lu: x.lu, objets: x.objets, lignes: lines(x.f) })) });

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
  const toUnits = (ids: string[]) => ids.map((id) => byCanon.get(canon(id))).filter((u): u is Champion => !!u);
  const compUnits = (c: MetaComp) => toUnits(c.units);
  /** Plateau type de la compo au niveau donné (7, 8 ou 9), ou le plateau général à défaut. */
  const variantFor = (c: MetaComp, lvl: number) => {
    const ids = c.variants?.[String(Math.min(9, Math.max(7, lvl)))];
    return ids?.length ? toUnits(ids) : compUnits(c);
  };
  const showVariant = (c: MetaComp, lvl: number) => {
    const raw: Board = {};
    variantFor(c, lvl).forEach((u, i) => (raw[i] = u.id));
    setBoard(autoArrange(raw, set));
    setSelected(null);
  };
  const loadComp = (c: MetaComp) => {
    showVariant(c, Math.max(level, 8));
    setPlan(c);
    setPlanLevel(Math.min(9, Math.max(8, level)));
    setHeld({});
    setTab('live');
  };
  /** Unités à ajouter en passant au niveau suivant, d'après les parties. */
  const nextAdds = (c: MetaComp, lvl: number) => {
    if (lvl >= 9 || !c.variants?.[String(lvl + 1)]) return [];
    const now = new Set(variantFor(c, lvl).map((u) => u.id));
    return variantFor(c, lvl + 1).filter((u) => !now.has(u.id));
  };
  const saveComp = () => {
    const name = prompt('Nom de la compo ?')?.trim();
    if (name) setComps([...comps.filter((c) => c.name !== name), { name, setKey: set.key, board }]);
  };

  return (
    <div className={`app mode-${mode}`}>
      <header>
        <button className={`dot ${dot.cls}`} onClick={() => setTab('screen')} title={dot.label} aria-label={dot.label} />
        <strong>Coop TFT</strong>
        <span className="setname">
          {set.label}
          {typeof meta === 'object' && meta.meta.set === set.number && meta.meta.patch && ` · patch ${meta.meta.patch}`}
        </span>
        {econ && (
          <button className="pill" onClick={() => setTab('live')}>
            {ACTION_LOOK[econ.action].icon} {ACTION_LOOK[econ.action].label}
          </button>
        )}
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

      {update && (
        <div className="banner update">
          Mise à jour disponible.{' '}
          <a href={APK_URL} target="_blank" rel="noreferrer">
            Télécharger et installer
          </a>
        </div>
      )}
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
                      className={`hex ${selected === i ? 'sel' : ''} ${c ? `cost-${c.cost}` : ''} ${badHexes.has(i) ? 'bad' : ''} ${
                        c && toBuy.some((b) => b.id === c.id) ? 'buy' : ''
                      } ${c && hasOwned && !owned[c.id] ? 'lack' : ''}`}
                      style={{ gridColumn: `${col * 2 + 1 + (r % 2)} / span 2` }}
                      onClick={() => tapHex(i)}
                      aria-label={c ? c.name : `Case vide ${r + 1}-${col + 1}`}
                    >
                      {c && <Icon c={c} />}
                      {c && <span className="hexname">{c.name}</span>}
                      {c && carry?.id === c.id && <span className="star">★</span>}
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
          {reading === 'on' && toBuy.length > 0 ? (
            <button className="tipbar buy" onClick={() => setTab('live')}>
              🛒 Achète{' '}
              {[...new Set(toBuy.map((c) => c.name + ((owned[c.id] ?? 0) % 3 === 2 ? ' (monte en étoile !)' : '')))].join(', ')}
            </button>
          ) : warnings.length > 0 ? (
            <button className="tipbar warn" onClick={() => setTab('live')}>
              ⚠ {warnings[0].text}
              {tips.length > 1 && <small> +{tips.length - 1}</small>}
            </button>
          ) : econ ? (
            <button className={`tipbar act ${econ.action}`} onClick={() => setTab('live')}>
              {ACTION_LOOK[econ.action].icon} {econ.title}
            </button>
          ) : (
            <button className={`tipbar ${topTip.level}`} onClick={() => setTab('advice')}>
              {topTip.text}
            </button>
          )}
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
                ['live', 'Direct'],
                ['meta', 'Méta'],
                ['units', 'Unités'],
                ['advice', `Conseils${tips.some((t) => t.level === 'warn') ? ' ⚠' : ''}`],
                ['comps', 'Perso'],
                ['screen', reading === 'on' ? 'Écran ●' : 'Écran'],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </nav>

          {tab === 'live' && (
            <div className="panel live">
              {!econ ? (
                <p className="muted">
                  Choisis une compo dans l'onglet Méta : cette vue t'indique ensuite quoi faire à chaque moment de la
                  partie.
                </p>
              ) : (
                <>
                  <div className={`card action ${econ.action}`}>
                    <span className="big">{ACTION_LOOK[econ.action].icon}</span>
                    <div>
                      <b>{econ.title}</b>
                      <small>{econ.reasons[0]}</small>
                    </div>
                  </div>

                  {reading === 'on' && shop.length > 0 && (
                    <div className={`card ${toBuy.length ? 'gold' : ''}`}>
                      <h4>{toBuy.length ? 'À acheter dans la boutique' : 'Boutique : rien pour ta compo'}</h4>
                      <div className="shoprow">
                        {shop.map((c, k) => (
                          <span key={k} className={planIds.has(c.id) ? 'want' : 'skip'}>
                            <Icon c={c} />
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {ready.length > 0 && (
                    <div className="card gold">
                      <h4>Objet faisable maintenant{benchSeen && <em className="auto">auto</em>}</h4>
                      {ready.map((n, k) => (
                        <div key={k} className="itemline">
                          {n.item.icon && <img src={n.item.icon} alt="" />}
                          <b>{n.item.name}</b>
                        </div>
                      ))}
                    </div>
                  )}

                  {warnings.length > 0 && (
                    <div className="card red">
                      <h4>Placement à corriger</h4>
                      {warnings.slice(0, 2).map((t, k) => (
                        <small key={k}>{t.text}</small>
                      ))}
                      <button onClick={() => setBoard(autoArrange(board, set))}>Corriger automatiquement</button>
                    </div>
                  )}

                  {benchSeen && (
                    <div className="card">
                      <h4>Tes objets (lus à l'écran)</h4>
                      <small>
                        {Object.entries(bench)
                          .map(([id, n]) => `${set.items[id]?.name ?? id}${n > 1 ? ` ×${n}` : ''}`)
                          .join(', ')}
                      </small>
                    </div>
                  )}

                  {hasOwned && (
                    <div className="card">
                      <h4>Tes achats repérés</h4>
                      <div className="owned">
                        {ownedUnits.map(({ unit, copies }) => (
                          <button
                            key={unit.id}
                            onClick={() => screen.adjustOwned(unit.id, -1)}
                            title="Tape pour retirer un exemplaire (vente)"
                          >
                            <Icon c={unit} />
                            <small>
                              {'★'.repeat(stars(copies))} ×{copies}
                            </small>
                          </button>
                        ))}
                      </div>
                      {missing.length > 0 && <small>Il te manque : {missing.map((u) => u.name).join(', ')}</small>}
                      <small className="muted">Déduit de la boutique : approximatif. Tape une unité vendue pour la retirer.</small>
                    </div>
                  )}

                  {plan?.variants && (
                    <div className="card">
                      <h4>Plateau visé</h4>
                      <div className="seg">
                        {[7, 8, 9]
                          .filter((n) => plan.variants?.[String(n)])
                          .map((n) => (
                            <button
                              key={n}
                              className={planLevel === n ? 'on' : ''}
                              onClick={() => {
                                setPlanLevel(n);
                                showVariant(plan, n);
                              }}
                            >
                              Niveau {n}
                            </button>
                          ))}
                      </div>
                      {nextAdds(plan, planLevel).length > 0 && (
                        <small>
                          Au niveau {planLevel + 1}, ajoute :{' '}
                          {nextAdds(plan, planLevel)
                            .map((u) => u.name)
                            .join(', ')}
                        </small>
                      )}
                    </div>
                  )}

                  {carry && (
                    <div className="card">
                      <h4>Trouver {carry.name} en boutique</h4>
                      <Bar label={`Niv. ${level}`} value={hitChance(level, [carry], set, liveOdds)} />
                      {liveOdds && <small>Probabilités lues à l'écran : {liveOdds.join(' · ')} %</small>}
                      {level < 10 && (
                        <Bar label={`Niv. ${level + 1}`} value={hitChance(level + 1, [carry], set)} tone="next" />
                      )}
                    </div>
                  )}

                  <div className="card">
                    <div className="gauges">
                      <label>
                        <span>Manche{auto('stage') && <em className="auto">auto</em>}</span>
                        <select value={game.stage} onChange={(e) => setGame({ ...game, stage: e.target.value })}>
                          {[2, 3, 4, 5, 6, 7].flatMap((st) =>
                            [1, 2, 3, 4, 5, 6, 7].map((r) => (
                              <option key={`${st}-${r}`}>
                                {st}-{r}
                              </option>
                            )),
                          )}
                        </select>
                      </label>
                      <label>
                        <span>
                          PV <b className={`hp ${hpTone}`}>{game.hp}</b>
                          {auto('hp') && <em className="auto">auto</em>}
                        </span>
                        <input
                          type="range"
                          min={1}
                          max={100}
                          className={hpTone}
                          value={game.hp}
                          onChange={(e) => setGame({ ...game, hp: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        <span>
                          Or <b>{game.gold}</b>
                          {auto('gold') && <em className="auto">auto</em>}
                          <span className="pips">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <i key={n} className={interest(game.gold) >= n ? 'on' : ''} />
                            ))}
                          </span>
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={game.gold}
                          onChange={(e) => setGame({ ...game, gold: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                    <small>
                      Revenu : +{income(game.gold, streak)} or par tour
                      {streak ? ` (série de ${streak})` : ''}
                      {levelCost !== undefined && ` · niveau suivant : ${levelCost} or`}
                    </small>
                  </div>
                </>
              )}
            </div>
          )}

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
                      {meta.meta.patch && `Patch ${meta.meta.patch} · `}
                      {meta.meta.matches} parties {meta.meta.region.toUpperCase()} haut
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
                    {(hasOwned ? fits : meta.meta.comps.map((comp, index) => ({ comp, index, score: 0, owned: [] }))).map(
                      ({ comp: c, index: k, score, owned: got }) => (
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
                            {(c.level || c.reroll) && (
                              <span className="badges">
                                {c.level && <em>Niveau {c.level}</em>}
                                {c.reroll && <em className="reroll">Reroll</em>}
                                {c.core?.length ? <em className="corekey">◆ unités clés</em> : null}
                              </span>
                            )}
                            <span className="compunits">
                              {compUnits(c).map((u) => (
                                <span key={u.id} className={c.core?.some((id) => canon(id) === canon(u.id)) ? 'core' : ''}>
                                  <Icon c={u} />
                                </span>
                              ))}
                            </span>
                            {c.variants?.['9'] && nextAdds(c, 8).length > 0 && (
                              <small>
                                Niveau 9 : +{' '}
                                {nextAdds(c, 8)
                                  .map((u) => u.name)
                                  .join(', ')}
                              </small>
                            )}
                            {score > 0 && (
                              <small className="fit">Tu as déjà : {got.map((o) => o.champion.name).join(', ')}</small>
                            )}
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
              <h3>Économie</h3>
              {econ ? (
                <div className={`verdict ${econ.action}`}>
                  <b>{econ.title}</b>
                  <ul>
                    {econ.reasons.map((r, k) => (
                      <li key={k}>{r}</li>
                    ))}
                  </ul>
                  <small>
                    Niveau {situation.level}, manche {situation.stage}, {situation.gold} or, {situation.hp} PV (réglables dans
                    Direct). Pourcentages indicatifs, basés sur les tables standard.
                  </small>
                </div>
              ) : (
                <p className="muted">Charge une compo depuis l'onglet Méta pour obtenir un conseil d'économie.</p>
              )}

              <h3>Objets</h3>
              {allNeeds.length ? (
                <>
                  {itemNeeds.map(
                    ({ unit, needs }) =>
                      unit && (
                        <div key={unit.id} className="itemrow">
                          <Icon c={unit} />
                          <ul>
                            {needs.map((n, k) => (
                              <li key={k} className={ready.includes(n) ? 'ready' : ''}>
                                <b>{n.item.name}</b>
                                {n.parts.length === 2 && (
                                  <small> = {n.parts.map((p) => set.items[p]?.name ?? p).join(' + ')}</small>
                                )}
                                {ready.includes(n) && <small> · faisable maintenant</small>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ),
                  )}
                  {parts.length > 0 && (
                    <>
                      <small>Composants à prioriser (tape ceux que tu as en main) :</small>
                      <div className="parts">
                        {parts.map((p) => (
                          <button
                            key={p.key}
                            className={held[p.key] ? 'on' : ''}
                            onClick={() => setHeld({ ...held, [p.key]: ((held[p.key] ?? 0) + 1) % 4 })}
                          >
                            {set.items[p.key]?.name ?? p.key} ×{p.count}
                            {held[p.key] ? <b> · en main {held[p.key]}</b> : null}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="muted">Les objets conseillés apparaissent quand une compo méta est chargée.</p>
              )}

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

          {tab === 'screen' && (
            <div className="panel">
              {!screenReaderAvailable() ? (
                <p className="muted">La lecture de l'écran n'existe que dans l'application Android.</p>
              ) : (
                <>
                  <button onClick={screen.toggle} disabled={reading === 'starting'}>
                    {reading === 'off' ? "Démarrer la lecture de l'écran" : 'Arrêter la lecture'}
                  </button>
                  {samples.length > 0 && (
                    <button onClick={copySamples}>
                      {copied ? 'Copié ✓' : `Copier les relevés de la partie (${samples.length})`}
                    </button>
                  )}
                  <p className="muted">
                    Expérimental. Android demande quoi partager : choisis l'écran entier, ou l'application TFT. L'app
                    lit le texte affiché environ toutes les 1,5 s, sur l'appareil, sans rien envoyer. Riot n'autorise
                    pas les outils qui lisent la partie : à toi de décider où tu l'utilises.
                  </p>
                  {reading !== 'off' && (
                    <p className="detect">
                      <span className={`dot ${dot.cls}`} /> {dot.label}
                    </p>
                  )}
                  {screen.error && <p className="tips"><span className="warn">{screen.error}</span></p>}
                  {reading !== 'off' && (
                    <>
                      <label className="check">
                        <input type="checkbox" checked={autoFill} onChange={(e) => setAutoFill(e.target.checked)} />
                        Remplir automatiquement manche, niveau, or et PV
                      </label>
                      <p className="readout">
                        Lu à l'écran : manche <b>{autoRead.stage ?? '—'}</b> · niveau <b>{autoRead.level ?? '—'}</b> · or{' '}
                        <b>{autoRead.gold ?? '—'}</b> · PV <b>{autoRead.hp ?? '—'}</b> · boutique{' '}
                        <b>{autoRead.odds ? autoRead.odds.join('/') : '—'}</b> · XP{' '}
                        <b>{autoRead.xp ? `${autoRead.xp.have}/${autoRead.xp.total}` : '—'}</b> · série{' '}
                        <b>{autoRead.streak ?? '—'}</b>
                      </p>
                      <label className="check">
                        Ton pseudo en jeu (pour lire tes PV)
                        <input value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="détecté en partie" />
                      </label>
                      <p className="readout">
                        Objets : <b>{screen.benchInfo.loaded}</b>/{screen.benchInfo.wanted} icônes de référence chargées ·
                        lus :{' '}
                        {screen.benchReads.length
                          ? screen.benchReads
                              .map(
                                (r) =>
                                  `${r.accepted ? '✓' : '✗'} ${set.items[r.id]?.name ?? r.id} (${r.distance.toFixed(3)} / ${r.runnerUp.toFixed(3)})`,
                              )
                              .join(' · ')
                          : '—'}
                      </p>
                      <button onClick={() => requestSnapshot()}>Enregistrer une image maintenant</button>
                      <p className="readout">
                        Images enregistrées dans la galerie (album CoopTFT) : <b>{shots.saved}</b>
                        {shots.failed > 0 && ` · ${shots.failed} échec(s)`}
                      </p>
                      <button onClick={copyDiagnostic} disabled={!frame}>
                        {copied ? 'Copié ✓' : 'Copier le diagnostic'}
                      </button>
                      <h3>Boutique lue</h3>
                      {shop.length ? (
                        <div className="ideas">
                          {shop.map((c, k) => (
                            <div
                              key={k}
                              className={`idea shopcard ${planIds.has(c.id) ? 'plan' : ideaIds.has(c.id) ? 'fit' : ''}`}
                            >
                              <Icon c={c} />
                              <span>
                                <b>{c.name}</b>
                                <small>
                                  {planIds.has(c.id)
                                    ? 'dans ta compo'
                                    : ideaIds.has(c.id)
                                      ? 'complète une synergie'
                                      : 'hors compo'}
                                </small>
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">Aucune boutique repérée pour l'instant.</p>
                      )}
                      <h3>
                        Texte brut <small>({frame ? `${frame.lines.length} lignes, image ${frame.width}×${frame.height}` : 'en attente de la première image'})</small>
                      </h3>
                      <p className="rawtext">
                        {frame?.lines
                          .slice(0, 60)
                          .map((l) => l.text)
                          .join(' · ')}
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'comps' && (
            <div className="panel">
              <h3>Bilan de tes parties</h3>
              {summary.games ? (
                <>
                  <p className="readout">
                    <b>{summary.games}</b> parties · place moyenne <b>{summary.avgPlacement.toFixed(2)}</b> · top 4{' '}
                    <b>{Math.round(summary.top4Rate * 100)} %</b> · victoires <b>{Math.round(summary.winRate * 100)} %</b>
                    {summary.trend &&
                      ` · tendance ${summary.trend.delta > 0 ? '↗ en progrès' : summary.trend.delta < 0 ? '↘ en baisse' : '→ stable'}`}
                  </p>
                  <ul className="tips">
                    {summary.comps.slice(0, 6).map((c) => (
                      <li key={c.key} className={c.avgPlacement <= 4 ? 'ok' : c.avgPlacement > 5 ? 'warn' : ''}>
                        {c.traits.map((t) => traitName.get(canon(t)) ?? prettyId(t)).join(' + ')} : {c.games} partie
                        {c.games > 1 ? 's' : ''}, place moyenne {c.avgPlacement.toFixed(1)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="muted">
                  Tes classements s'enregistrent tout seuls quand la lecture d'écran est active à la fin d'une partie.
                </p>
              )}
              <h3>Tes compos</h3>
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
