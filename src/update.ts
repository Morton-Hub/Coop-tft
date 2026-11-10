declare const __BUILD_SHA__: string;

const RELEASE_API = 'https://api.github.com/repos/Morton-Hub/Coop-tft/releases/latest';
export const APK_URL = 'https://github.com/Morton-Hub/Coop-tft/releases/latest/download/coop-tft.apk';

/** Vrai si la dernière version publiée ne correspond pas au commit de ce build. */
export function isNewer(buildSha: string, release: { target_commitish?: string; assets?: unknown[] }): boolean {
  if (!buildSha || !release.target_commitish || !release.assets?.length) return false;
  return release.target_commitish !== buildSha;
}

export async function updateAvailable(): Promise<boolean> {
  try {
    const res = await fetch(RELEASE_API, { cache: 'no-store' });
    if (!res.ok) return false;
    return isNewer(__BUILD_SHA__, await res.json());
  } catch {
    return false;
  }
}
