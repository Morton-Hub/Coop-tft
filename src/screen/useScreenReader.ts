import { useCallback, useEffect, useRef, useState } from 'react';
import type { Champion } from '../data/types';
import { adjust, createInventory, observe } from '../engine/inventory';
import { readEndScreen } from './endgame';
import { useStored } from '../storage';
import {
  detectGame,
  EMPTY_VIEW,
  guessPlayerName,
  readHud,
  readShop,
  stableHud,
  viewKey,
  type FrameView,
  type Hud,
  type ScreenFrame,
} from './match';
import { requestSnapshot, setReaderInterval, startScreenReader } from './reader';

export interface Sample {
  t: number;
  f: ScreenFrame;
  lu: Hud;
}

/** Cadence de lecture : rapide en partie, ralentie quand TFT n'est pas à l'écran pour épargner la batterie. */
const FAST_MS = 1500;
const IDLE_MS = 4000;

/**
 * Lecture de l'écran. Les images arrivent toutes les 1,5 s, mais l'interface n'est redessinée que
 * lorsque ce qu'on en tire change (boutique, manche, or…) : l'image brute reste dans une référence.
 */
export function useScreenReader(champions: Champion[]) {
  const [reading, setReading] = useState<'off' | 'starting' | 'on'>('off');
  const [error, setError] = useState('');
  const [view, setView] = useState<FrameView>(EMPTY_VIEW);
  const [shots, setShots] = useState({ saved: 0, failed: 0 });
  const [, setRawTick] = useState(0);
  /** Exemplaires achetés, déduits des cartes qui disparaissent de la boutique. */
  const [owned, setOwned] = useState<Record<string, number>>({});
  /** Dernier écran de fin de partie reconnu. */
  const [ended, setEnded] = useState<{ placement: number; at: number } | null>(null);
  const inventory = useRef(createInventory());
  const [player, setPlayer] = useStored('coop-tft:pseudo', '');
  const [samples, setSamples] = useStored<Sample[]>('coop-tft:samples', []);

  const frame = useRef<ScreenFrame | null>(null);
  const live = useRef({ champions, player });
  live.current = { champions, player };
  const state = useRef({
    key: viewKey(EMPTY_VIEW),
    lastHud: {} as Hud,
    votes: {} as Record<string, number>,
    lastSample: 0,
    lastShot: 0,
    autoShots: 0,
    idleFrames: 0,
    interval: FAST_MS,
    watchRaw: false,
    endPlacement: 0,
    endAt: 0,
  });
  const stop = useRef<(() => Promise<void>) | null>(null);

  const onFrame = useCallback((f: ScreenFrame) => {
    const st = state.current;
    const { champions: champs, player: name } = live.current;
    frame.current = f;

    const shopRead = readShop(f, champs);
    const hud = readHud(f, name);
    const next: FrameView = { shop: shopRead.shop, gameState: detectGame(f, champs), hud: stableHud(hud, st.lastHud) };
    st.lastHud = hud;
    const key = viewKey(next);
    if (key !== st.key) {
      st.key = key;
      setView(next);
    }
    if (st.watchRaw) setRawTick((n) => n + 1);

    // Inventaire : chaque lecture de boutique est confrontée à la précédente (valeurs brutes, le module
    // d'inventaire fait sa propre confirmation).
    const inv = observe(inventory.current, { shop: shopRead.shop, gold: hud.gold, stage: hud.stage, level: hud.level, at: Date.now() });
    if (inv.owned !== inventory.current.owned) setOwned(inv.owned);
    inventory.current = inv;

    // Fin de partie : le classement est noté une fois par écran de résultats.
    if (name) {
      const end = readEndScreen(f, name);
      if (end && (st.endPlacement !== end.placement || Date.now() - st.endAt > 600000)) {
        st.endPlacement = end.placement;
        st.endAt = Date.now();
        setEnded({ placement: end.placement, at: st.endAt });
      }
    }

    // Pseudo : retenu quand le même nom est vu trois fois à la fois dans la liste des joueurs et sur le plateau.
    if (!name) {
      const guess = guessPlayerName(f);
      if (guess && (st.votes[guess] = (st.votes[guess] ?? 0) + 1) >= 3) setPlayer(guess);
    }

    const now = Date.now();
    const playing = next.gameState === 'game';
    // Relevés et images de réglage : un par minute en partie, pour ajuster la lecture après coup.
    if (playing && now - st.lastSample > 60000) {
      st.lastSample = now;
      setSamples((prev) => [...prev.slice(-5), { t: now, f, lu: hud }]);
    }
    if (playing && st.autoShots < 15 && now - st.lastShot > 60000) {
      st.lastShot = now;
      st.autoShots++;
      requestSnapshot();
    }

    st.idleFrames = next.gameState === 'none' ? st.idleFrames + 1 : 0;
    const wanted = st.idleFrames >= 3 ? IDLE_MS : FAST_MS;
    if (wanted !== st.interval) {
      st.interval = wanted;
      setReaderInterval(wanted);
    }
  }, [setPlayer, setSamples]);

  const toggle = useCallback(async () => {
    setError('');
    if (stop.current) {
      await stop.current().catch(() => {});
      stop.current = null;
      frame.current = null;
      state.current.key = viewKey(EMPTY_VIEW);
      setView(EMPTY_VIEW);
      setReading('off');
      return;
    }
    setReading('starting');
    try {
      Object.assign(state.current, { autoShots: 0, idleFrames: 0, interval: FAST_MS, lastHud: {} });
      setShots({ saved: 0, failed: 0 });
      stop.current = await startScreenReader(
        onFrame,
        (reason) => {
          stop.current = null;
          setReading('off');
          setError(reason);
        },
        (saved) => setShots((x) => (saved ? { ...x, saved: x.saved + 1 } : { ...x, failed: x.failed + 1 })),
      );
      setReading('on');
    } catch (e) {
      setReading('off');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [onFrame]);

  useEffect(() => () => void stop.current?.(), []);

  return {
    reading,
    error,
    toggle,
    ...view,
    shots,
    samples,
    owned,
    ended,
    /** Correction manuelle de l'inventaire (une vente, par exemple). */
    adjustOwned: (id: string, delta: number) => {
      inventory.current = adjust(inventory.current, id, delta);
      setOwned(inventory.current.owned);
    },
    player,
    setPlayer,
    /** Dernière image lue (texte brut), pour l'onglet de diagnostic. */
    frame: frame.current,
    /** À activer seulement quand le texte brut est affiché : il change à chaque image. */
    watchRaw: (on: boolean) => {
      state.current.watchRaw = on;
    },
  };
}
