// V-MAPVIDEO CLEAN 1.3.2 — security/data guard
// Loaded before script.js. Keeps the existing app logic unchanged while sanitizing local JSON data.
(function () {
  'use strict';

  const nativeFetch = window.fetch.bind(window);

  // Capture the Mapbox map instance without changing script.js internals.
  if (window.mapboxgl && window.mapboxgl.Map && !window.__vMapMapCaptureInstalled) {
    const NativeMap = window.mapboxgl.Map;
    class VMapCapturedMap extends NativeMap {
      constructor(options) {
        super(options);
        window.vMapMap = this;
      }
    }
    window.mapboxgl.Map = VMapCapturedMap;
    window.__vMapMapCaptureInstalled = true;
  }

  // Capture the Directions instance too, so Smart GPS Route can react to route/clear events.
  if (window.MapboxDirections && !window.__vMapDirectionsCaptureInstalled) {
    const NativeDirections = window.MapboxDirections;
    function VMapCapturedDirections(options) {
      const instance = new NativeDirections(options);
      window.vMapDirections = instance;
      return instance;
    }
    VMapCapturedDirections.prototype = NativeDirections.prototype;
    Object.setPrototypeOf(VMapCapturedDirections, NativeDirections);
    window.MapboxDirections = VMapCapturedDirections;
    window.__vMapDirectionsCaptureInstalled = true;
  }

  function safeText(value) {
    return String(value ?? '').replace(/[<>]/g, '');
  }

  function safeCoords(coords) {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
    return [lng, lat];
  }

  function youtubeId(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
    try {
      const u = new URL(raw, window.location.href);
      const host = u.hostname.toLowerCase().replace(/^www\./, '');
      let id = null;
      if (host === 'youtu.be') id = u.pathname.split('/').filter(Boolean)[0];
      if (host === 'youtube.com' || host === 'm.youtube.com') {
        if (u.pathname === '/watch') id = u.searchParams.get('v');
        else if (/^\/(embed|shorts)\//.test(u.pathname)) id = u.pathname.split('/')[2];
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
    } catch (_) {
      return null;
    }
  }

  function safeEmbed(value) {
    const id = youtubeId(value);
    return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : '';
  }

  function configuredYoutubeId(routeId) {
    const registry = window.VMAP_ROUTE_VIDEO_CONFIG;
    if (!registry || !routeId) return null;
    return youtubeId(registry[routeId]?.youtube);
  }

  function sanitizePlaces(data) {
    if (!Array.isArray(data)) return [];
    return data.map((place) => {
      if (!place || typeof place !== 'object') return null;
      const coords = safeCoords(place.coords);
      if (!coords) return null;
      return {
        ...place,
        name: safeText(place.name),
        category: safeText(place.category || 'Khác'),
        coords,
        youtube: safeEmbed(place.youtube)
      };
    }).filter(Boolean);
  }

  function patchRoutes(data) {
    const root = Array.isArray(data) ? data : { ...data };
    const routes = Array.isArray(data) ? root : (Array.isArray(root.routes) ? root.routes : []);
    const patched = routes.map((route) => {
      if (!route || typeof route !== 'object') return route;
      const copy = { ...route };
      copy.name = safeText(copy.name);
      copy.destinationName = safeText(copy.destinationName);
      copy.direction = safeText(copy.direction);

      const currentId = youtubeId(copy.youtube || copy.videoId || copy.video);
      const registryId = configuredYoutubeId(copy.id);
      if (registryId) copy.youtube = registryId;
      else if (currentId) copy.youtube = currentId;

      return copy;
    });
    if (Array.isArray(data)) return patched;
    root.routes = patched;
    return root;
  }

  window.fetch = async function (input, init) {
    const response = await nativeFetch(input, init);
    let pathname = '';
    try {
      const requestUrl = typeof input === 'string' ? input : input.url;
      pathname = new URL(requestUrl, window.location.href).pathname;
    } catch (_) {
      return response;
    }

    const isPlaces = pathname.endsWith('/places.json');
    const isRoutes = pathname.endsWith('/route-videos.json');
    if (!isPlaces && !isRoutes) return response;

    try {
      const data = await response.clone().json();
      const guarded = isPlaces ? sanitizePlaces(data) : patchRoutes(data);
      return new Response(JSON.stringify(guarded), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch (error) {
      console.warn('V-MapVideo guard: giữ nguyên response vì không xử lý được JSON.', error);
      return response;
    }
  };
})();
