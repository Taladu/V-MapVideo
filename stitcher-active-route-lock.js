// V-MapVideo DEMO — Active Route Lock v2
// Enforces: Active Route -> Active Segment -> Direction -> GPS point -> timestamp -> video.
// Also hard-rejects candidates whose actual GPS point is too far from the clicked route location.
(function () {
  'use strict';

  if (window.__vMapActiveRouteLockInstalled) return;
  window.__vMapActiveRouteLockInstalled = true;

  const WAIT_MS = 100;
  const TIMEOUT_MS = 15000;
  const STRICT_VIDEO_CLICK_METERS = 25;
  const started = Date.now();

  function install() {
    const api = window.VMAP_STITCHER_DEMO;
    if (!api || typeof api.resolveClick !== 'function') return false;
    if (api.__activeRouteLockInstalled) return true;

    const nativeResolveClick = api.resolveClick.bind(api);

    function strictResolve(lng, lat, options = {}) {
      const result = nativeResolveClick(lng, lat, options);
      if (!result) return null;

      // IMPORTANT: matchRadiusMeters is for route analysis, not for accepting a click.
      // A video 50–100m away may still belong to the same broad corridor, but it must
      // never be offered for a branch/junction click. Use a separate hard click limit.
      const distance = Number(result.distanceMeters);
      if (!Number.isFinite(distance) || distance > STRICT_VIDEO_CLICK_METERS) {
        console.log(`🔒 Active Route Lock v2 rejected ${result.id || result.name || 'video'}: GPS click distance ${Number.isFinite(distance) ? distance.toFixed(1) : '?'}m > ${STRICT_VIDEO_CLICK_METERS}m.`);
        return null;
      }
      return result;
    }

    api.resolveClickUnlocked = nativeResolveClick;
    api.resolveClick = function resolveClickLocked(lng, lat, options = {}) {
      const last = typeof api.getLastResult === 'function' ? api.getLastResult() : window.VMAP_STITCHER_DEMO_LAST;
      const activeVideos = (last?.chain || []).filter(x => x?.type === 'video');
      const hasActiveRoute = Array.isArray(last?.routeCoords) && last.routeCoords.length > 1;

      // Hard lock whenever a Directions route + stitched video chain exists.
      // This prevents a nearby video from another route or the reverse direction being selected.
      if (hasActiveRoute && activeVideos.length) {
        return strictResolve(lng, lat, { ...options, activeRouteOnly: true });
      }

      // With no active Directions route, preserve free-map lookup but still keep the
      // strict GPS click threshold so a distant video is never presented as a match.
      return strictResolve(lng, lat, { ...options, activeRouteOnly: false });
    };

    api.resolveClickActiveRoute = function (lng, lat) {
      return strictResolve(lng, lat, { activeRouteOnly: true });
    };

    api.__activeRouteLockInstalled = true;
    api.activeRouteLockVersion = 2;
    api.strictVideoClickMeters = STRICT_VIDEO_CLICK_METERS;
    console.log(`🔒 V-MapVideo Active Route Lock v2 active — route → segment → direction → GPS ≤ ${STRICT_VIDEO_CLICK_METERS}m → timestamp → video.`);
    return true;
  }

  if (install()) return;

  const timer = setInterval(() => {
    if (install() || Date.now() - started > TIMEOUT_MS) {
      clearInterval(timer);
      if (!window.VMAP_STITCHER_DEMO?.__activeRouteLockInstalled) {
        console.warn('🔒 V-MapVideo Active Route Lock v2: Stitcher API not found; lock was not installed.');
      }
    }
  }, WAIT_MS);
})();