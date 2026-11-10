// Récupère les parties récentes des meilleurs joueurs (API Riot) et écrit le fichier méta.
// Usage : RIOT_API_KEY=... node scripts/fetch-meta.mjs meta.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { aggregate } from '../src/meta/aggregate.ts';

const KEY = (process.env.RIOT_API_KEY || '').trim();
const PLATFORM = process.env.RIOT_PLATFORM || 'euw1';
const REGION = process.env.RIOT_REGION || 'europe';
const PLAYERS = Number(process.env.META_PLAYERS || 45);
const MATCHES = Number(process.env.META_MATCHES || 220);
const out = process.argv[2] || 'meta.json';

if (!KEY) {
  console.log('::warning::Secret RIOT_API_KEY absent : méta non générée.');
  process.exit(0);
}

// Diagnostic sans divulguer la clé : une clé Riot fait 42 caractères, « RGAPI- » suivi d'un UUID.
const wellFormed = /^RGAPI-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(KEY);
console.log(`Clé : ${KEY.length} caractères, format ${wellFormed ? 'correct' : 'INATTENDU'}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function riot(host, path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    // Limite d'une clé personnelle : 100 requêtes / 2 min.
    await sleep(Math.max(0, last + 1250 - Date.now()));
    last = Date.now();
    let res;
    try {
      res = await fetch(`https://${host}.api.riotgames.com${path}`, { headers: { 'X-Riot-Token': KEY } });
    } catch (e) {
      console.log(`réseau : ${e.message}, nouvel essai`);
      await sleep(3000);
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      const body = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`Clé Riot refusée (HTTP ${res.status}) sur ${path} : ${body}`);
    }
    const wait = Number(res.headers.get('retry-after')) || 10;
    console.log(`HTTP ${res.status} sur ${path}, attente ${wait}s`);
    await sleep(wait * 1000);
  }
  throw new Error(`Échec répété sur ${path}`);
}

let entries = [];
for (const league of ['challenger', 'grandmaster', 'master']) {
  const data = await riot(PLATFORM, `/tft/league/v1/${league}?queue=RANKED_TFT`);
  entries = (data?.entries ?? []).filter((e) => e.puuid);
  if (entries.length >= 10) {
    console.log(`${entries.length} joueurs ${league} sur ${PLATFORM}`);
    break;
  }
}
if (!entries.length) throw new Error('Aucun joueur classé trouvé.');
entries.sort((a, b) => b.leaguePoints - a.leaguePoints);

const ids = new Set();
for (const e of entries.slice(0, PLAYERS)) {
  const list = await riot(REGION, `/tft/match/v1/matches/by-puuid/${e.puuid}/ids?start=0&count=6`);
  for (const id of list ?? []) ids.add(id);
  if (ids.size >= MATCHES) break;
}
console.log(`${ids.size} parties à lire`);

const matches = [];
for (const id of [...ids].slice(0, MATCHES)) {
  const m = await riot(REGION, `/tft/match/v1/matches/${id}`);
  if (m?.info) matches.push(m);
}

const meta = aggregate(matches, { region: PLATFORM });
if (!meta.comps.length) throw new Error(`Aucune compo exploitable (${matches.length} parties lues).`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(meta));
console.log(`Set ${meta.set}, patch ${meta.patch} : ${meta.comps.length} compos sur ${meta.boards} plateaux -> ${out}`);
