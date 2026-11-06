// TV app versions: the newest one published with the dashboard, and which TVs are behind it.

let latestPromise = null;

/** Newest TV app version ("2.8"), from tv-version.json written by the deploy workflow. Fetched once per visit. */
export const latestApp = () =>
  (latestPromise ||= fetch('tv-version.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null)).then((j) => j?.versionName || null).catch(() => null));

const num = (v) => String(v || '').split('.').map((n) => parseInt(n, 10) || 0);

/** True if version a is newer than b. */
export function newer(a, b) {
  const x = num(a), y = num(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

/** The app version installed on a TV ("2.7"), or null for TVs not running the Android app. */
export const installedApp = (screen) => {
  const app = screen?.device_info?.app || '';
  return /^Android/.test(app) ? app.replace(/^Android\s*/, '') : null;
};

/** Best known newest version for this TV: the published one, or what the TV itself reported. */
export function newestFor(screen, latest) {
  const installed = installedApp(screen);
  if (!installed) return null;
  return [latest, screen.device_info?.app_update].filter(Boolean).reduce((m, v) => (newer(v, m) ? v : m), installed);
}

/** True if this TV runs the Android app and a newer version is out. */
export const appBehind = (screen, latest) => {
  const installed = installedApp(screen);
  return !!installed && newer(newestFor(screen, latest), installed);
};
