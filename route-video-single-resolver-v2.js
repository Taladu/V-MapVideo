// V-MapVideo Single Resolver v2
// Single authority for legacy route clicks while a Mapbox Directions route is active.
// Key fix: match the click to the VIDEO POLYLINE (segment projection), not only to a discrete GPS sample.
// This avoids false NO_VIDEO results when GPS samples are sparse, while still rejecting nearby wrong branches.
(function () {
  'use strict';

  if (window.__vMapSingleResolverV2Installed) return;
  window.__vMapSingleResolverV2Installed = true;

  const CFG = Object.freeze({
    routeCorridorMeters: 35,          // GPS-video point -> active Directions route
    maxRouteCorridorMeters: 40,       // never trust broad 80/180m metadata for route eligibility
    preferredCorridorMeters: 18,
    clickVideoPolylineMeters: 28,     // click -> matched video polyline, NOT click -> raw GPS point
    clickRouteProgressTolerance: 38,  // click progress vs interpolated video progress on active route
    minCoverageMeters: 30,
    edgeToleranceMeters: 14,
    toleratedMisses: 2,
    maxBacktrackMeters: 22,
    minForwardSpanMeters: 18,
    branchLookaheadMeters: 45,
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
    const qx = ax + t * dx, qy = ay + t * dy;
    return {
      t,
      distance: Math.hypot(px - qx, py - qy),
      coord: [qx / kx, qy / ky]
    };
  }

  function projectToActiveRoute(p) {
    if (activeRoute.length < 2) return null;
    const stride = Math.max(1, CFG.routeProjectionStride);
    let bestVertex = 0, bestVD = Infinity;
    for (let i = 0; i < activeRoute.length; i += stride) {
      const d = hav(activeRoute[i], p);
      if (d < bestVD) { bestVD = d; bestVertex = i; }
    }
    const lo = Math.max(0, bestVertex - stride - 4);
    const hi = Math.min(activeRoute.length - 2, bestVertex + stride + 4);
    let best = null;
    for (let i = lo; i <= hi; i++) {
      const pr = projectToSegment(p, activeRoute[i], activeRoute[i + 1]);
      if (!best || pr.distance < best.distance) {
        const segMeters = hav(activeRoute[i], activeRoute[i + 1]);
        best = {
          distance: pr.distance,
          routeMeters: activeCum[i] + segMeters * pr.t,
          segmentIndex: i,
          t: pr.t
        };
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

  function pointVideoTime(point, route) {
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

  function routeCorridor(route) {
    const declared = Number(route?.routeCorridorMeters ?? route?.corridorMeters ?? route?.matchRadiusMeters);
    if (!Number.isFinite(declared) || declared <= 0) return CFG.routeCorridorMeters;
    return Math.min(CFG.maxRouteCorridorMeters, Math.max(20, declared));
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
      .catch(err => { library = []; console.warn('🧭 Single Resolver v2 library load failed:', err); return library; });
    return libraryPromise;
  }

  function buildRuns(route) {
    const corridor = routeCorridor(route);
    const samples = [];
    for (let i = 0; i < route.points.length; i++) {
      const c = coord(route.points[i]);
      if (!c) continue;
      const projection = projectToActiveRoute(c);
      samples.push({
        point: route.points[i],
        pointIndex: i,
        coord: c,
        projection,
        matched: Boolean(projection && projection.distance <= corridor)
      });
    }

    const runs = [];
    let run = [], misses = [];

    const flush = () => {
      const matched = run.filter(x => x.matched && x.projection);
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
        if (delta > 0 && span >= CFG.minCoverageMeters && backtrack <= CFG.maxBacktrackMeters) {
          runs.push({
            items: matched,
            start: first.projection.routeMeters,
            end: last.projection.routeMeters,
            span,
            backtrack,
            corridor,
            avgDistance: matched.reduce((s, x) => s + x.projection.distance, 0) / matched.length
          });
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

  function matchClickToRun(clickCoord, clickRouteMeters, route, run) {
    let best = null;
    const items = run.items;

    // Project the click onto each VIDEO segment. This is the main v2 fix.
    // Sparse GPS points no longer create a false negative between samples.
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1], b = items[i];
      if (!a?.coord || !b?.coord || !a.projection || !b.projection) continue;
      const pr = projectToSegment(clickCoord, a.coord, b.coord);
      const interpolatedRouteMeters = a.projection.routeMeters + (b.projection.routeMeters - a.projection.routeMeters) * pr.t;
      const progressError = Math.abs(interpolatedRouteMeters - clickRouteMeters);
      if (pr.distance > CFG.clickVideoPolylineMeters || progressError > CFG.clickRouteProgressTolerance) continue;

      const ta = pointVideoTime(a.point, route);
      const tb = pointVideoTime(b.point, route);
      const interpolatedVideoTime = ta + (tb - ta) * pr.t;
      const candidate = {
        distance: pr.distance,
        progressError,
        routeMeters: interpolatedRouteMeters,
        videoTime: Math.max(0, interpolatedVideoTime),
        coord: pr.coord,
        segmentIndex: i - 1
      };
      if (!best || candidate.distance < best.distance || (candidate.distance === best.distance && candidate.progressError < best.progressError)) best = candidate;
    }

    return best;
  }

  function resolve(click) {
    if (activeRoute.length < 2 || !library.length) return null;
    const clickCoord = [Number(click.lng), Number(click.lat)];
    if (!Number.isFinite(clickCoord[0]) || !Number.isFinite(clickCoord[1])) return null;
    const clickProjection = projectToActiveRoute(clickCoord);
    if (!clickProjection || clickProjection.distance > 45) return null;

    const candidates = [];
    for (const route of library) {
      const source = route.youtube || route.videoId || route.video;
      const id = youtubeId(source);
      if (!id) continue;

      for (const run of buildRuns(route)) {
        if (run.span < CFG.minForwardSpanMeters) continue;
        if (clickProjection.routeMeters < run.start - CFG.edgeToleranceMeters || clickProjection.routeMeters > run.end + CFG.edgeToleranceMeters) continue;

        const clickMatch = matchClickToRun(clickCoord, clickProjection.routeMeters, route, run);
        if (!clickMatch) continue;

        // Junction guard by route progress: after a real branch, a wrong straight-ahead video
        // stops projecting continuously onto the selected Directions route, so the run ends.
        const remaining = run.end - clickProjection.routeMeters;
        if (remaining > CFG.edgeToleranceMeters) {
          const requiredAhead = Math.min(CFG.branchLookaheadMeters, remaining);
          if (requiredAhead >= 20) {
            const target = clickProjection.routeMeters + requiredAhead;
            const hasAhead = run.items.some(x => x.projection.routeMeters >= target - CFG.edgeToleranceMeters);
            if (!hasAhead) continue;
          }
        }

        const priority = Number(route.priority) || 0;
        const score = priority * 100
          - clickMatch.distance * 4
          - clickMatch.progressError * 1.5
          - run.avgDistance
          + Math.max(0, CFG.preferredCorridorMeters - run.avgDistance) * 0.25;

        candidates.push({ route, run, clickMatch, id, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score || a.clickMatch.distance - b.clickMatch.distance || a.clickMatch.progressError - b.clickMatch.progressError);
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
      showNoVideo(map, e.lngLat, 'Không dùng fallback video gần đó.');
      window.VMAP_SINGLE_RESOLVER_LAST = { status: 'NO_VIDEO', click: [e.lngLat.lng, e.lngLat.lat], version: 2 };
      return;
    }

    const start = Math.max(0, Math.floor(match.clickMatch.videoTime));
    const name = String(match.route.name || match.route.id || 'Video hướng dẫn').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
    const embed = `https://www.youtube.com/embed/${encodeURIComponent(match.id)}?start=${start}&autoplay=1&playsinline=1&rel=0`;
    const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(match.id)}&t=${start}s`;
    removePopup();
    popup = new mapboxgl.Popup({ maxWidth: '360px', closeButton: true, closeOnClick: false })
      .setLngLat(e.lngLat)
      .setHTML(`<div class="route-video-popup"><div class="route-video-title">🎬 Xem đúng đoạn tuyến</div><div class="route-video-meta">${name}<br>GPS-polyline ~${Math.round(match.clickMatch.distance)} m • sai số tiến trình ~${Math.round(match.clickMatch.progressError)} m • coverage ${Math.round(match.run.start)}–${Math.round(match.run.end)} m</div><iframe src="${embed}" title="${name}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe><a class="route-video-youtube-link" href="${watch}" target="_blank" rel="noopener noreferrer">Mở đúng đoạn này trên YouTube ↗</a></div>`)
      .addTo(map);

    window.VMAP_SINGLE_RESOLVER_LAST = {
      status: 'MATCH', version: 2,
      route: match.route.name || match.route.id,
      gpsPolylineDistance: match.clickMatch.distance,
      routeProgressError: match.clickMatch.progressError,
      coverageStart: match.run.start,
      coverageEnd: match.run.end,
      videoTime: match.clickMatch.videoTime
    };
  }

  function extractRouteCoords(e) {
    const geometry = (e?.route?.[0] || e?.route || e?.routes?.[0])?.geometry;
    return geometry?.type === 'LineString' && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
  }

  function isDirectionsRouteAtPoint(map, point) {
    try {
      const style = map.getStyle();
      if (!style || !Array.isArray(style.layers)) return false;
      const ids = style.layers.map(l => l.id).filter(id => typeof id === 'string' && id.startsWith('directions-route'));
      if (!ids.length) return false;
      return map.queryRenderedFeatures(point, { layers: ids }).length > 0;
    } catch (_) { return false; }
  }

  // Observe Directions events before script.js registers its handlers.
  const DirectionsProto = window.MapboxDirections?.prototype;
  if (DirectionsProto && typeof DirectionsProto.on === 'function' && !DirectionsProto.__vmapSingleResolverV2Patched) {
    const nativeOn = DirectionsProto.on;
    DirectionsProto.on = function(type, listener) {
      if (type === 'route' && typeof listener === 'function') {
        const wrapped = function(e) {
          const coords = extractRouteCoords(e);
          if (coords && coords.length > 1) {
            activeRoute = coords;
            activeCum = cumulative(coords);
            window.VMAP_SINGLE_RESOLVER_ROUTE = { version: 2, coords, lengthMeters: activeCum[activeCum.length - 1] || 0 };
          }
          return listener.apply(this, arguments);
        };
        return nativeOn.call(this, type, wrapped);
      }
      if (type === 'clear' && typeof listener === 'function') {
        const wrapped = function() {
          activeRoute = []; activeCum = []; removePopup();
          window.VMAP_SINGLE_RESOLVER_ROUTE = null;
          return listener.apply(this, arguments);
        };
        return nativeOn.call(this, type, wrapped);
      }
      return nativeOn.apply(this, arguments);
    };
    DirectionsProto.__vmapSingleResolverV2Patched = true;
  }

  // Replace the legacy generic route-click handler in script.js only.
  const MapProto = window.mapboxgl?.Map?.prototype;
  if (MapProto && typeof MapProto.on === 'function' && !MapProto.__vmapSingleResolverV2Patched) {
    const nativeMapOn = MapProto.on;
    MapProto.on = function(type, layerOrListener, maybeListener) {
      if (type === 'click' && typeof layerOrListener === 'function' && maybeListener === undefined) {
        const source = Function.prototype.toString.call(layerOrListener);
        if (source.includes('openRouteVideoAtClick') && source.includes('isRouteFeatureAtPoint')) {
          console.log('🧭 Single Resolver v2 replaced legacy nearest-video route click handler.');
          return nativeMapOn.call(this, type, function(e) {
            if (!isDirectionsRouteAtPoint(this, e.point)) return;
            handleRouteClick(e).catch(err => {
              console.warn('🧭 Single Resolver v2 click failed:', err);
              showNoVideo(e.target, e.lngLat, 'Lỗi kiểm tra GPS-video.');
            });
          });
        }
      }
      return nativeMapOn.apply(this, arguments);
    };
    MapProto.__vmapSingleResolverV2Patched = true;
  }

  loadLibrary();
  console.log('🧭 V-MapVideo Single Resolver v2 active — click->video polyline projection + route progress + branch fail-closed.');
})();
