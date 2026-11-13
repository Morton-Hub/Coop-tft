declare const __BUILD_SHA__: string;

const RELEASE = 'https://github.com/Morton-Hub/Coop-tft/releases/latest/download';
export const APK_URL = `${RELEASE}/coop-tft.apk`;
/** Petit fichier publié avec l'APK : le commit dont il est issu. Pas de quota, contrairement à l'API GitHub. */
const VERSION_URL = `${RELEASE}/version.txt`;

/** Vrai si la version publiée ne correspond pas au commit de ce build. */
export function isNewer(buildSha: string, published: string): boolean {
  const sha = published.trim();
  return !!buildSha && /^[0-9a-f]{40}$/.test(sha) && sha !== buildSha;
}

export async function updateAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    return isNewer(__BUILD_SHA__, await res.text());
  } catch {
    return false;
  }
}
