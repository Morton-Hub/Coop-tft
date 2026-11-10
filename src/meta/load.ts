import type { MetaData } from './aggregate';

/** Fichier publié par le workflow « Meta » sur la branche « meta » du repo. */
export const META_URL = 'https://raw.githubusercontent.com/Morton-Hub/Coop-tft/meta/meta.json';
const CACHE_KEY = 'coop-tft:meta:v1';
const CACHE_TTL = 20 * 60 * 1000;

export interface MetaResult {
  meta: MetaData;
  /** Vrai si le réseau a échoué et qu'on affiche la dernière copie connue. */
  stale: boolean;
}

export async function loadMeta(force = false): Promise<MetaResult> {
  let cached: { at: number; meta: MetaData } | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
  } catch {
    /* cache illisible */
  }
  if (!force && cached && Date.now() - cached.at < CACHE_TTL) return { meta: cached.meta, stale: false };
  try {
    const res = await fetch(`${META_URL}?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const meta = (await res.json()) as MetaData;
    if (!Array.isArray(meta.comps)) throw new Error('format inattendu');
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), meta }));
    } catch {
      /* pas de cache */
    }
    return { meta, stale: false };
  } catch (e) {
    if (cached) return { meta: cached.meta, stale: true };
    throw e;
  }
}

export function ago(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 60) return `il y a ${min} min`;
  if (min < 48 * 60) return `il y a ${Math.round(min / 60)} h`;
  return `il y a ${Math.round(min / 1440)} j`;
}
