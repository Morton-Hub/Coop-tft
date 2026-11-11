import { useEffect, useMemo, useRef, useState } from 'react';
import { loadSet } from './data/cdragon';
import { DEMO_SET } from './data/demo';
import { COLS, ROWS, type Board, type Champion, type GameSet } from './data/types';
import { advise, hitChance, interest, type Action, type Situation } from './engine/economy';
import { buildable, componentPriority, resolveItems } from './engine/items';
import { analyze, autoArrange, bestHex, hex, mirror, SCOUTING_CHECKLIST } from './engine/positioning';
import { suggest } from './engine/suggest';
import { boardChampions, traitStates } from './engine/traits';
import { canon, prettyId, type MetaComp } from './meta/aggregate';
import { ago, loadMeta, type MetaResult } from './meta/load';
import { detectGame, guessPlayerName, readHud, readShop, type Hud, type ScreenFrame } from './screen/match';
import { requestSnapshot, screenReaderAvailable, startScreenReader } from './screen/reader';
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

function Bar({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bar">
      <span>{label}</span>
      <div className="track">
        <div className={`fill ${tone ?? ''}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <b>{Math.round(value * 100)} %</b>
    </div>
  );
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
  const [plan, setPlan] = useStored<MetaComp | null>('coop-tft:plan', null);
  const [planLevel, setPlanLevel] = useStored('coop-tft:planlevel', 8);
  const [game, setGame] = useStored('coop-tft:game', { stage: '2-1', gold: 10, hp: 100 });
  const [held, setHeld] = useStored<Record<string, number>>('coop-tft:held', {});
  const [autoFill, setAutoFill] = useStored('coop-tft:autofill', true);
  const [player, setPlayer] = useStored('coop-tft:pseudo', '');
  const nameVotes = useRef<Record<string, number>>({});
  const [samples, setSamples] = useStored<{ t: number; f: ScreenFrame; lu: Hud }[]>('coop-tft:samples', []);
  const lastSample = useRef(0);
  const autoShots = useRef(0);
  const lastShot = useRef(0);
  const [shots, setShots] = useState<{ saved: number; failed: number }>({ saved: 0, failed: 0 });
  const [autoRead, setAutoRead] = useState<Hud>({});
  const lastHud = useRef<Hud>({});
  const [tab, setTab] = useState<Tab>('meta');
  const [selected, setSelected] = useState<number | null>(null);
  const [traitFilter, setTraitFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [costFilter, setCostFilter] = useState<number | null>(null);
  const [frame, setFrame] = useState<(ScreenFrame & { at: number }) | null>(null);
  const [reading, setReading] = useState<'off' | 'starting' | 'on'>('off');
  const [readError, setReadError] = useState('');
  const [update, setUpdate] = useState(false);
  const stopReader = useRef<(() => Promise<void>) | null>(null);

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
    // La mise à jour ne concerne que l'app Android installée.
    if (screenReaderAvailable()) updateAvailable().then(setUpdate);
  }, []);

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
  const situation: Situation = { level, ...game, levelCost };
  const econ = useMemo(
    () => (carry ? advise(
            { level, ...game, levelCost },
            { targets: [carry], carryCost: carry.cost, keyLevel: plan?.level, reroll: plan?.reroll, odds: liveOdds },
            set,
          ) : null),
    [level, game, units, carry, set, plan, liveOdds, levelCost],
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
  const ready = buildable(allNeeds, held);

  const mode: Action | 'idle' = econ?.action ?? 'idle';
  const badHexes = new Set(tips.filter((t) => t.level === 'warn' && t.hex !== undefined).map((t) => t.hex));
  const warnings = tips.filter((t) => t.level === 'warn');
  const hpTone = game.hp <= 30 ? 'red' : game.hp <= 55 ? 'orange' : 'green';

  const shopRead = useMemo(() => (frame ? readShop(frame, set.champions) : null), [frame, set]);
  const gameState = useMemo(() => (frame ? detectGame(frame, set.champions) : 'none'), [frame, set]);
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
  const toBuy = shopRead?.shop.filter((c) => planIds.has(c.id)) ?? [];

  // Remplissage automatique : une valeur n'est retenue que si deux lectures successives concordent.
  useEffect(() => {
    if (!frame || !shopRead) return;
    // Pseudo : retenu quand le même nom est repéré trois fois à la fois dans la liste et sur le plateau.
    const guess = guessPlayerName(frame);
    if (guess && !player) {
      nameVotes.current[guess] = (nameVotes.current[guess] ?? 0) + 1;
      if (nameVotes.current[guess] >= 3) setPlayer(guess);
    }
    const hud = readHud(frame, player);
    const prev = lastHud.current;
    lastHud.current = hud;
    const stable: Hud = {};
    for (const k of ['stage', 'level', 'gold', 'hp'] as const)
      if (hud[k] !== undefined && hud[k] === prev[k]) (stable as Record<string, unknown>)[k] = hud[k];
    if (hud.odds && hud.odds.join() === prev.odds?.join()) stable.odds = hud.odds;
    if (hud.xp && hud.xp.have === prev.xp?.have && hud.xp.total === prev.xp?.total) stable.xp = hud.xp;
    setAutoRead(stable);
    // Relevés automatiques : un par minute en partie (boutique ouverte ou non), les 6 derniers sont gardés
    // pour pouvoir régler la lecture après la partie sans rien faire pendant.
    const playing = shopRead.shop.length > 0 || hud.stage !== undefined || hud.level !== undefined;
    if (playing && Date.now() - lastSample.current > 60000) {
      lastSample.current = Date.now();
      const { at: _at, ...f } = frame;
      setSamples([...samples.slice(-5), { t: Date.now(), f, lu: hud }]);
    }
    // Images pour le réglage : une par minute dès qu'une partie est en cours (achat, combat, carrousel),
    // quinze au plus par session de lecture, enregistrées dans la galerie.
    if (playing && autoShots.current < 15 && Date.now() - lastShot.current > 60000) {
      lastShot.current = Date.now();
      autoShots.current++;
      requestSnapshot();
    }
    if (!autoFill) return;
    if (stable.level !== undefined && stable.level !== level) setLevel(stable.level);
    const next = {
      stage: stable.stage ?? game.stage,
      gold: stable.gold ?? game.gold,
      hp: stable.hp !== undefined && stable.hp >= 1 ? stable.hp : game.hp,
    };
    if (next.stage !== game.stage || next.gold !== game.gold || next.hp !== game.hp) setGame(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);
  const auto = (k: keyof Hud) => reading === 'on' && autoFill && autoRead[k] !== undefined;

  const [copied, setCopied] = useState(false);
  const copyDiagnostic = async () => {
    if (!frame) return;
    const text = JSON.stringify({
      w: frame.width,
      h: frame.height,
      etat: gameState,
      boutique: shopRead?.shop.map((c) => c.name),
      lu: autoRead,
      lignes: frame.lines.map((l) => [l.text, l.x, l.y, l.w, l.h]),
    });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Repli pour les WebView sans accès direct au presse-papiers.
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copySamples = async () => {
    const text = JSON.stringify({
      releves: samples.map((x) => ({
        w: x.f.width,
        h: x.f.height,
        lu: x.lu,
        lignes: x.f.lines.map((l) => [l.text, l.x, l.y, l.w, l.h]),
      })),
    });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleReading = async () => {
    setReadError('');
    if (reading !== 'off') {
      await stopReader.current?.().catch(() => {});
      stopReader.current = null;
      setReading('off');
      setFrame(null);
      return;
    }
    setReading('starting');
    try {
      stopReader.current = await startScreenReader(
        (f) => {
          setFrame({ ...f, at: Date.now() });
          setReading('on');
        },
        (reason) => {
          stopReader.current = null;
          setReading('off');
          setReadError(reason);
        },
        (saved) => setShots((x) => (saved ? { ...x, saved: x.saved + 1 } : { ...x, failed: x.failed + 1 })),
      );
      autoShots.current = 0;
      setShots({ saved: 0, failed: 0 });
      setReading('on');
    } catch (e) {
      setReading('off');
      setReadError(e instanceof Error ? e.message : String(e));
    }
  };

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
                      }`}
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
              🛒 Achète {[...new Set(toBuy.map((c) => c.name))].join(', ')}
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

                  {reading === 'on' && shopRead && shopRead.shop.length > 0 && (
                    <div className={`card ${toBuy.length ? 'gold' : ''}`}>
                      <h4>{toBuy.length ? 'À acheter dans la boutique' : 'Boutique : rien pour ta compo'}</h4>
                      <div className="shoprow">
                        {shopRead.shop.map((c, k) => (
                          <span key={k} className={planIds.has(c.id) ? 'want' : 'skip'}>
                            <Icon c={c} />
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {ready.length > 0 && (
                    <div className="card gold">
                      <h4>Objet faisable maintenant</h4>
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
                  <button onClick={toggleReading} disabled={reading === 'starting'}>
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
                  {readError && <p className="tips"><span className="warn">{readError}</span></p>}
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
                        <b>{autoRead.xp ? `${autoRead.xp.have}/${autoRead.xp.total}` : '—'}</b>
                      </p>
                      <label className="check">
                        Ton pseudo en jeu (pour lire tes PV)
                        <input value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="détecté en partie" />
                      </label>
                      <button onClick={() => requestSnapshot()}>Enregistrer une image maintenant</button>
                      <p className="readout">
                        Images enregistrées dans la galerie (album CoopTFT) : <b>{shots.saved}</b>
                        {shots.failed > 0 && ` · ${shots.failed} échec(s)`}
                      </p>
                      <button onClick={copyDiagnostic} disabled={!frame}>
                        {copied ? 'Copié ✓' : 'Copier le diagnostic'}
                      </button>
                      <h3>Boutique lue</h3>
                      {shopRead?.shop.length ? (
                        <div className="ideas">
                          {shopRead.shop.map((c, k) => (
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
