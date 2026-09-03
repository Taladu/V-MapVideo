// V-MAPVIDEO — GPS VIDEO LIBRARY 1.3 SAFE PRIORITY
// YouTube keeps the heavy video files. V-MapVideo only keeps lightweight GPS/time metadata.
// Merges many GPS-video JSON sources into the legacy route-videos.json shape so the existing engine stays unchanged.
(function () {
  'use strict';

  if (window.__vMapGpsVideoLibraryInstalled) return;
  window.__vMapGpsVideoLibraryInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const MANIFEST_URL = 'route-video-library.json';
  const LEGACY_URL = 'route-videos.json';
  const TEST_MODE = new URLSearchParams(window.location.search).get('gpsLibraryTest') === '1';

  function safePathname(input) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      return new URL(raw, window.location.href).pathname;
    } catch (_) {
      return '';
    }
  }

  function normalizeRoutes(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.routes)) return data.routes;
    if (Array.isArray(data?.videos)) return data.videos;
    return [];
  }

  function compactPointToObject(point) {
    // Compact format: [lng, lat, tRaw] or [lng, lat, tRaw, tVideo]
    if (!Array.isArray(point)) return point;
    return {
      lng: Number(point[0]),
      lat: Number(point[1]),
      tRaw: Number(point[2] ?? 0),
      ...(point.length > 3 ? { tVideo: Number(point[3]) } : {})
    };
  }

  function validPoint(point) {
    const p = compactPointToObject(point);
    const lng = Number(Array.isArray(p?.coords) ? p.coords[0] : p?.lng);
    const lat = Number(Array.isArray(p?.coords) ? p.coords[1] : p?.lat);
    return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
  }

  function normalizePoint(point) {
    const p = compactPointToObject(point);
    if (!validPoint(p)) return null;
    const lng = Number(Array.isArray(p?.coords) ? p.coords[0] : p?.lng);
    const lat = Number(Array.isArray(p?.coords) ? p.coords[1] : p?.lat);
    const out = { ...p, lng, lat };
    delete out.coords;
    if (!Number.isFinite(Number(out.tRaw))) out.tRaw = 0;
    return out;
  }

  function normalizeRoute(route, source, index) {
    if (!route || typeof route !== 'object' || route.enabled === false) return null;
    const points = Array.isArray(route.points)
      ? route.points.map(normalizePoint).filter(Boolean)
      : [];
    if (points.length < 2) return null;

    const sourcePriority = Number(source?.priority) || 0;
    const routePriority = Number(route.priority) || 0;
    const fallbackId = `${String(source?.id || 'source')}-${index + 1}`;

    return {
      ...route,
      id: String(route.id || fallbackId),
      name: String(route.name || source?.name || fallbackId),
      youtube: route.youtube || route.videoId || route.video || source?.youtube || source?.videoId || '',
      destinationName: route.destinationName || source?.destinationName || '',
      direction: route.direction || source?.direction || '',
      matchRadiusMeters: Number(route.matchRadiusMeters || source?.matchRadiusMeters || 80),
      points,
      priority: sourcePriority + routePriority,
      librarySource: String(source?.file || LEGACY_URL),
      librarySourceId: String(source?.id || ''),
      libraryOrder: index
    };
  }

  async function fetchJson(url) {
    const response = await nativeFetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return response.json();
  }

  async function loadManifest() {
    try {
      const data = await fetchJson(MANIFEST_URL);
      const normalSources = Array.isArray(data?.sources) ? data.sources : [];
      const testSources = TEST_MODE && Array.isArray(data?.testSources) ? data.testSources : [];
      const sources = [...normalSources, ...testSources];
      const enabled = sources.filter((source) => source && source.enabled !== false && source.file);
      if (enabled.length) return { ...data, sources: enabled };
    } catch (error) {
      console.warn('V-MapVideo GPS Library: chưa đọc được manifest, dùng route-videos.json cũ.', error);
    }
    return {
      version: 'legacy',
      sources: [{ id: 'legacy', file: LEGACY_URL, enabled: true, priority: 0 }]
    };
  }

  async function loadLibrary() {
    const manifest = await loadManifest();
    const merged = [];
    const seenIds = new Set();
    const sourceStats = [];

    const orderedSources = manifest.sources.slice().sort((a, b) => (Number(b?.priority) || 0) - (Number(a?.priority) || 0));
    for (const source of orderedSources) {
      try {
        const data = await fetchJson(source.file);
        const routes = normalizeRoutes(data);
        let accepted = 0;
        let pointCount = 0;

        routes.forEach((route, index) => {
          const normalized = normalizeRoute(route, source, index);
          if (!normalized) return;
          if (seenIds.has(normalized.id)) {
            console.warn(`V-MapVideo GPS Library: bỏ ID trùng "${normalized.id}" từ ${source.file}.`);
            return;
          }
          seenIds.add(normalized.id);
          merged.push(normalized);
          accepted += 1;
          pointCount += normalized.points.length;
        });

        sourceStats.push({ id: source.id || '', file: source.file, accepted, total: routes.length, pointCount });
      } catch (error) {
        console.warn(`V-MapVideo GPS Library: bỏ nguồn ${source.file} vì không tải được.`, error);
        sourceStats.push({ id: source.id || '', file: source.file, accepted: 0, total: 0, pointCount: 0, error: true });
      }
    }

    merged.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));

    window.vMapGpsVideoLibrary = {
      version: manifest.version || '1.2',
      testMode: TEST_MODE,
      count: merged.length,
      pointCount: merged.reduce((sum, route) => sum + route.points.length, 0),
      sources: sourceStats,
      routes: merged
    };

    console.log(
      `V-MapVideo GPS Library: đã nạp ${merged.length} video GPS, ${window.vMapGpsVideoLibrary.pointCount} điểm GPS từ ${sourceStats.length} nguồn. Video vẫn phát từ YouTube.${TEST_MODE ? ' [TEST MODE]' : ''}`
    );

    return {
      version: manifest.version || '1.2',
      timeUnit: 'seconds',
      library: true,
      testMode: TEST_MODE,
      storageMode: 'youtube-video-plus-lightweight-gps-metadata',
      routes: merged
    };
  }

  let cachedLibraryPromise = null;

  window.fetch = async function (input, init) {
    const pathname = safePathname(input);
    if (!pathname.endsWith('/route-videos.json')) {
      return nativeFetch(input, init);
    }

    try {
      if (!cachedLibraryPromise) cachedLibraryPromise = loadLibrary();
      const libraryData = await cachedLibraryPromise;
      return new Response(JSON.stringify(libraryData), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    } catch (error) {
      cachedLibraryPromise = null;
      console.warn('V-MapVideo GPS Library: lỗi tổng hợp, trả route-videos.json gốc.', error);
      return nativeFetch(input, init);
    }
  };

  window.vMapReloadGpsVideoLibrary = function () {
    cachedLibraryPromise = null;
    return loadLibrary();
  };
})();
