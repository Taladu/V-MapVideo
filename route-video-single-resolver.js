// V-MapVideo Single Resolver v1
// One authority for clicks on an active Directions route.
// Active route -> contiguous GPS coverage -> direction -> click -> timestamp -> video.
// Fail closed: if coverage is not proven, show NO VIDEO and never fall back to a nearby route.
(function () {
  'use strict';

  if (window.__vMapSingleResolverInstalled) return;
  window.__vMapSingleResolverInstalled = true;

  const CFG = Object.freeze({
    corridorMeters: 25,
    preferredCorridorMeters: 15,
    clickGpsMeters: 25,
    minCoverageMeters: 35,
    edgeToleranceMeters: 10,
    toleratedMisses: 1,
    maxDirectionBacktrackMeters: 18,
    minDirectionSpanMeters: 20,
    branchLookaheadMeters: 55,
    routeProjectionStride: 2
  });

  let activeRoute = [];
  let activeCum = [];
  let library = [];
  let libraryPromise = null;
  let popup = null;

  const rad = d => d * Math.PI / 180;

  function hav(a, b) {
    const R = 6371000;
    const dLat = rad(b[1] - a[1]);
    const dLng = rad(b[0] - a[0]);
    const la = rad(a[1]);
    const lb = rad(b[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function coord(point) {
    const c = Array.isArray(point?.coords)
      ? [Number(point.coords[0]), Number(point.coords[1])]
      : [Number(point?.lng), Number(point?.lat)];
    return Number.isFinite(c[0]) && Number.isFinite(c[1]) ? c : null;
  }

  function cumulative(coords) {
    const out = [0];
    for (let i = 1; i < coords.length; i++) out[i] = out[i - 1] + hav(coords[i - 1], coords[i]);
    return out;
  }

  function projectToSegment(p, a, b) {
    const lat0 = rad((p[1] + a[1] + b[1]) / 3);
    const kx = 111320 * Math.cos(lat0), ky = 110540;
    const px = p[0] * kx, py = p[1] * ky;
    const ax = a[0] * kx, ay = a[1] * ky;
    const bx = b[0] * kx, by = b[1] * ky;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return { t, distance: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) };
  }

  function projectToRoute(p) {
    if (activeRoute.length < 2) return null;
    let bestVertex = 0, bestVD = Infinity;
    const stride = Math.max(1, CFG.routeProjectionStride);
    for (let i = 0; i < activeRoute.length; i += stride) {
      const d = hav(activeRoute[i], p);
      if (d < bestVD) { bestVD = d; bestVertex = i; }
    }
    const lo = Math.max(0, bestVertex - stride - 3);
    const hi = Math.min(activeRoute.length - 2, bestVertex + stride + 3);
    let best = null;
    for (let i = lo; i <= hi; i++) {
      const pr = projectToSegment(p, activeRoute[i], activeRoute[i + 1]);
      if (!best || pr.distance < best.distance) {
        const seg = hav(activeRoute[i], activeRoute[i + 1]);
        best = { distance: pr.distance, routeMeters: activeCum[i] + seg * pr.t, segmentIndex: i };
      }
    }
    return best;
  }

  function rawTime(point) {
    const v = Number(point?.tRaw ?? point?.rawTime ?? point?.sourceTime ?? point?.t ?? point?.time ?? 0);
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  }

  function normalizedEdits(edits) {
    if (!Array.isArray(edits)) return [];
    return edits.map(x => ({
      start: Number(x.start ?? x.from ?? x.startRaw),
      end: Number(x.end ?? x.to ?? x.endRaw),
      keep: Number(x.keepSeconds ?? x.keep ?? 0)
    })).filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && Number.isFinite(x.keep) && x.end > x.start && x.keep >= 0 && x.keep <= x.end - x.start)
      .sort((a, b) => a.start - b.start);
  }

  function videoTime(point, route) {
    const explicit = Number(point?.tVideo ?? point?.videoTime);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
    const t = rawTime(point);
    let removed = 0;
    for (const x of normalizedEdits(route?.timelineEdits)) {
      const duration = x.end - x.start;
      const cut = duration - x.keep;
      if (t >= x.end) { removed += cut; continue; }
      if (t > x.start) return Math.max(0, x.start - removed + ((t - x.start) / duration) * x.keep);
      break;
    }
    return Math.max(0, t - removed);
  }

  function youtubeId(value) {
    if (!value) return null;
    let raw = String(value).trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
    try {
      const u = new URL(raw, location.href);
      if (u.hostname.includes('youtu.be')) raw = u.pathname.split('/').filter(Boolean)[0] || '';
      else if (u.pathname.startsWith('/embed/') || u.pathname.startsWith('/shorts/')) raw = u.pathname.split('/')[2] || '';
      else raw = u.searchParams.get('v') || raw;
    } catch (_) {}
    return /^[A-Za-z0-9_-]{11}$/.test(raw) ? raw : null;
  }

  async function loadLibrary() {
    if (libraryPromise) return libraryPromise;
    libraryPromise = fetch('route-videos.json', { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(`route-videos.json HTTP ${r.status}`); return r.json(); })
      .then(data => {
        const routes = Array.isArray(data) ? data : (Array.isArray(data?.routes) ? data.routes : []);
        library = routes.filter(r => r && r.enabled !== false && Array.isArray(r.points) && r.points.length >= 2);
        return library;
      })
      .catch(err => { library = []; console.warn('🧭 Single Resolver library load failed:', err); return library; });
    return libraryPromise;
  }

  function buildRuns(route) {
    const samples = [];
    for (let i = 0; i < route.points.length; i++) {
      const c = coord(route.points[i]);
      if (!c) continue;
      const p = projectToRoute(c);
      samples.push({ point: route.points[i], pointIndex: i, coord: c, projection: p, matched: Boolean(p && p.distance <= CFG.corridorMeters) });
    }

    const runs = [];
    let run = [], misses = [];
    const flush = () => {
      if (run.length >= 2) {
        const matched = run.filter(x => x.matched);
        if (matched.length >= 2) {
          const first = matched[0], last = matched[matched.length - 1];
          const delta = last.projection.routeMeters - first.projection.routeMeters;
          const span = Math.abs(delta);
          let backtrack = 0;
          for (let i = 1; i < matched.length; i++) {
            const step = matched[i].projection.routeMeters - matched[i - 1].projection.routeMeters;
            if (delta >= 0 && step < 0) backtrack += Math.abs(step);
            if (delta < 0 && step > 0) backtrack += Math.abs(step);
          }
          if (span >= CFG.minCoverageMeters && backtrack <= CFG.maxDirectionBacktrackMeters) {
            runs.push({
              items: matched,
              direction: delta >= 0 ? 1 : -1,
              start: Math.min(first.projection.routeMeters, last.projection.routeMeters),
              end: Math.max(first.projection.routeMeters, last.projection.routeMeters),
              span,
              backtrack,
              avgDistance: matched.reduce((s, x) => s + x.projection.distance, 0) / matched.length
            });
          }
        }
      }
      run = []; misses = [];
    };

    for (const s of samples) {
      if (s.matched) {
        if (run.length && misses.length <= CFG.toleratedMisses) run.push(...misses);
        run.push(s); misses = [];
      } else if (run.length) {
        misses.push(s);
        if (misses.length > CFG.toleratedMisses) flush();
      }
    }
    flush();
    return runs;
  }

  function resolve(click) {
    if (activeRoute.length < 2 || !library.length) return null;
    const clickCoord = [Number(click.lng), Number(click.lat)];
    const clickProjection = projectToRoute(clickCoord);
    if (!clickProjection) return null;
    const candidates = [];

    for (const route of library) {
      for (const run of buildRuns(route)) {
        // Directions route is A -> B. Reject reverse GPS runs here.
        if (run.direction !== 1 || run.span < CFG.minDirectionSpanMeters) continue;
        if (clickProjection.routeMeters < run.start - CFG.edgeToleranceMeters || clickProjection.routeMeters > run.end + CFG.edgeToleranceMeters) continue;

        let nearest = null;
        for (const item of run.items) {
          const d = hav(clickCoord, item.coord);
          if (!nearest || d < nearest.distance) nearest = { ...item, distance: d };
        }
        if (!nearest || nearest.distance > CFG.clickGpsMeters) continue;

        // Branch/junction guard: require proven GPS coverage ahead of the click.
        // A straight video cannot serve a route that turns away immediately after the junction.
        const desiredAhead = Math.min(run.end, clickProjection.routeMeters + CFG.branchLookaheadMeters);
        const hasAhead = run.items.some(x => x.projection.routeMeters >= desiredAhead - CFG.edgeToleranceMeters);
        if (run.end - clickProjection.routeMeters > CFG.edgeToleranceMeters && !hasAhead) continue;

        const source = route.youtube || route.videoId || route.video;
        const id = youtubeId(source);
        if (!id) continue;
        const priority = Number(route.priority) || 0;
        const score = priority * 100 - nearest.distance * 2 - run.avgDistance - Math.max(0, CFG.preferredCorridorMeters - run.avgDistance) * 0.1;
        candidates.push({ route, run, nearest, id, score, videoTime: videoTime(nearest.point, route) });
      }
    }

    candidates.sort((a, b) => b.score - a.score || a.nearest.distance - b.nearest.distance);
    return candidates[0] || null;
  }

  function removePopup() {
    if (popup) { try { popup.remove(); } catch (_) {} popup = null; }
  }

  function showNoVideo(map, lngLat, reason) {
    removePopup();
    popup = new mapboxgl.Popup({ maxWidth: '360px', closeButton: true, closeOnClick: false })
      .setLngLat(lngLat)
      .setHTML(`<div class="route-video-popup"><div class="route-video-title">🎬 Đoạn này chưa có video</div><div class="route-video-meta">Không tìm thấy GPS-video trùng đúng vệt chỉ đường và đúng chiều tại vị trí này.${reason ? `<br><small>${reason}</small>` : ''}</div></div>`)
      .addTo(map);
  }

  async function handleRouteClick(e) {
    const map = e?.target;
    if (!map || !e?.lngLat) return;
    await loadLibrary();
    const match = resolve(e.lngLat);
    if (!match) {
      showNoVideo(map, e.lngLat, 'Hệ thống đã khóa fallback sang video gần đó.');
      window.VMAP_SINGLE_RESOLVER_LAST = { status: 'NO_VIDEO', click: [e.lngLat.lng, e.lngLat.lat] };
      return;
    }

    const start = Math.max(0, Math.floor(match.videoTime));
    const name = String(match.route.name || match.route.id || 'Video hướng dẫn').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
    const embed = `https://www.youtube.com/embed/${encodeURIComponent(match.id)}?start=${start}&autoplay=1&playsinline=1&rel=0`;
    const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(match.id)}&t=${start}s`;
    removePopup();
    popup = new mapboxgl.Popup({ maxWidth: '360px', closeButton: true, closeOnClick: false })
      .setLngLat(e.lngLat)
      .setHTML(`<div class="route-video-popup"><div class="route-video-title">🎬 Xem đúng đoạn tuyến</div><div class="route-video-meta">${name}<br>GPS ~${Math.round(match.nearest.distance)} m • coverage ${Math.round(match.run.start)}–${Math.round(match.run.end)} m</div><iframe src="${embed}" title="${name}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe><a class="route-video-youtube-link" href="${watch}" target="_blank" rel="noopener noreferrer">Mở đúng đoạn này trên YouTube ↗</a></div>`)
      .addTo(map);
    window.VMAP_SINGLE_RESOLVER_LAST = { status: 'MATCH', route: match.route.name || match.route.id, gpsDistance: match.nearest.distance, coverageStart: match.run.start, coverageEnd: match.run.end, videoTime: match.videoTime };
  }

  function extractRouteCoords(e) {
    const geometry = (e?.route?.[0] || e?.route || e?.routes?.[0])?.geometry;
    if (geometry?.type === 'LineString' && Array.isArray(geometry.coordinates)) return geometry.coordinates;
    return null;
  }

  // Observe Directions route events even though the app keeps `directions` in a closure.
  const DirectionsProto = window.MapboxDirections?.prototype;
  if (DirectionsProto && typeof DirectionsProto.on === 'function' && !DirectionsProto.__vmapSingleResolverPatched) {
    const nativeDirectionsOn = DirectionsProto.on;
    DirectionsProto.on = function(type, listener) {
      if (type === 'route' && typeof listener === 'function') {
        const wrapped = function(e) {
          const coords = extractRouteCoords(e);
          if (coords && coords.length > 1) {
            activeRoute = coords;
            activeCum = cumulative(coords);
            window.VMAP_SINGLE_RESOLVER_ROUTE = { coords, lengthMeters: activeCum[activeCum.length - 1] || 0 };
          }
          return listener.apply(this, arguments);
        };
        return nativeDirectionsOn.call(this, type, wrapped);
      }
      if (type === 'clear' && typeof listener === 'function') {
        const wrapped = function() {
          activeRoute = []; activeCum = []; removePopup();
          window.VMAP_SINGLE_RESOLVER_ROUTE = null;
          return listener.apply(this, arguments);
        };
        return nativeDirectionsOn.call(this, type, wrapped);
      }
      return nativeDirectionsOn.apply(this, arguments);
    };
    DirectionsProto.__vmapSingleResolverPatched = true;
  }

  // Replace only the legacy generic route-click callback from script.js.
  // Other map listeners (clusters, places, hover, movement) remain untouched.
  const MapProto = window.mapboxgl?.Map?.prototype;
  if (MapProto && typeof MapProto.on === 'function' && !MapProto.__vmapSingleResolverPatched) {
    const nativeMapOn = MapProto.on;
    MapProto.on = function(type, layerOrListener, maybeListener) {
      if (type === 'click' && typeof layerOrListener === 'function' && maybeListener === undefined) {
        const source = Function.prototype.toString.call(layerOrListener);
        if (source.includes('openRouteVideoAtClick') && source.includes('isRouteFeatureAtPoint')) {
          console.log('🧭 Single Resolver v1 replaced legacy nearest-video route click handler.');
          return nativeMapOn.call(this, type, function(e) { handleRouteClick(e).catch(err => { console.warn('🧭 Single Resolver click failed:', err); showNoVideo(e.target, e.lngLat, 'Lỗi kiểm tra GPS-video.'); }); });
        }
      }
      return nativeMapOn.apply(this, arguments);
    };
    MapProto.__vmapSingleResolverPatched = true;
  }

  window.VMAP_ROUTE_VIDEO_RESOLVER = {
    version: 1,
    config: CFG,
    resolve,
    getActiveRoute: () => window.VMAP_SINGLE_RESOLVER_ROUTE || null,
    getLastResult: () => window.VMAP_SINGLE_RESOLVER_LAST || null,
    reloadLibrary: () => { libraryPromise = null; return loadLibrary(); }
  };

  loadLibrary();
  console.log('🧭 V-MapVideo Single Resolver v1 active — fail-closed active-route coverage matching.');
})();