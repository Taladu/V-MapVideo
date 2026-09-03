// V-MapVideo Single Resolver v3
// Local branch-aware matcher: active Directions route is the authority.
// Designed to avoid both false positives at junctions and false NO_VIDEO from GPS lane drift.
(function () {
  'use strict';

  if (window.__vMapSingleResolverV3Installed) return;
  window.__vMapSingleResolverV3Installed = true;

  const CFG = Object.freeze({
    clickVideoMeters: 45,
    videoToRouteMeters: 45,
    clickRouteMeters: 50,
    routeProgressTolerance: 65,
    routeWindowBehindMeters: 100,
    routeWindowAheadMeters: 150,
    forwardCheckMeters: 80,
    minForwardEvidenceMeters: 22,
    maxVideoSegmentsToScan: 1200
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
    return { t, distance: Math.hypot(px - qx, py - qy), coord: [qx / kx, qy / ky] };
  }

  function projectToRoute(p, minMeters = -Infinity, maxMeters = Infinity) {
    if (activeRoute.length < 2) return null;
    let best = null;
    for (let i = 0; i < activeRoute.length - 1; i++) {
      const segStart = activeCum[i];
      const segEnd = activeCum[i + 1];
      if (segEnd < minMeters || segStart > maxMeters) continue;
      const pr = projectToSegment(p, activeRoute[i], activeRoute[i + 1]);
      if (!best || pr.distance < best.distance) {
        best = {
          distance: pr.distance,
          routeMeters: segStart + (segEnd - segStart) * pr.t,
          segmentIndex: i,
          coord: pr.coord
        };
      }
    }
    return best;
  }

  function rawTime(point) {
    const v = Number(point?.tRaw ?? point?.rawTime ?? point?.sourceTime ?? point?.t ?? point?.time ?? 0);
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  }

  function edits(route) {
    if (!Array.isArray(route?.timelineEdits)) return [];
    return route.timelineEdits.map(x => ({
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
    for (const x of edits(route)) {
      const dur = x.end - x.start;
      const cut = dur - x.keep;
      if (t >= x.end) { removed += cut; continue; }
      if (t > x.start) return Math.max(0, x.start - removed + ((t - x.start) / dur) * x.keep);
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
      .catch(err => {
        library = [];
        console.warn('🧭 Single Resolver v3 library load failed:', err);
        return library;
      });
    return libraryPromise;
  }

  function validateForward(route, segmentIndex, clickRouteMeters) {
    const points = route.points || [];
    const base = coord(points[Math.min(segmentIndex + 1, points.length - 1)]);
    if (!base) return { ok: false, evidence: 0, reason: 'no_base' };

    let travelled = 0;
    let bestAhead = 0;
    let validSamples = 0;
    let previous = base;
    const minRoute = Math.max(0, clickRouteMeters - 15);
    const maxRoute = clickRouteMeters + CFG.routeWindowAheadMeters;

    for (let i = segmentIndex + 2; i < points.length; i++) {
      const c = coord(points[i]);
      if (!c) continue;
      travelled += hav(previous, c);
      previous = c;

      const pr = projectToRoute(c, minRoute, maxRoute);
      if (pr && pr.distance <= CFG.videoToRouteMeters && pr.routeMeters >= clickRouteMeters - 8) {
        validSamples++;
        bestAhead = Math.max(bestAhead, pr.routeMeters - clickRouteMeters);
      }

      if (travelled >= CFG.forwardCheckMeters) break;
    }

    // Near the physical end of a recorded clip there may be no 80m look-ahead.
    if (travelled < CFG.minForwardEvidenceMeters) {
      return { ok: true, evidence: bestAhead, validSamples, nearVideoEnd: true };
    }

    return {
      ok: validSamples >= 2 && bestAhead >= CFG.minForwardEvidenceMeters,
      evidence: bestAhead,
      validSamples,
      travelled
    };
  }

  function resolve(click) {
    if (activeRoute.length < 2 || !library.length) return { match: null, diagnostics: { reason: 'route_or_library_missing' } };
    const clickCoord = [Number(click.lng), Number(click.lat)];
    if (!Number.isFinite(clickCoord[0]) || !Number.isFinite(clickCoord[1])) return { match: null, diagnostics: { reason: 'bad_click' } };

    const clickRoute = projectToRoute(clickCoord);
    if (!clickRoute || clickRoute.distance > CFG.clickRouteMeters) {
      return { match: null, diagnostics: { reason: 'click_not_on_active_route', routeDistance: clickRoute?.distance } };
    }

    const candidates = [];
    const rejected = { noYoutube: 0, tooFarVideo: 0, routeMismatch: 0, wrongDirection: 0, progressMismatch: 0, branchMismatch: 0 };

    for (const route of library) {
      const id = youtubeId(route.youtube || route.videoId || route.video);
      if (!id) { rejected.noYoutube++; continue; }
      const points = route.points || [];
      const limit = Math.min(points.length - 1, CFG.maxVideoSegmentsToScan);

      for (let i = 0; i < limit; i++) {
        const a = coord(points[i]), b = coord(points[i + 1]);
        if (!a || !b) continue;
        const clickOnVideo = projectToSegment(clickCoord, a, b);
        if (clickOnVideo.distance > CFG.clickVideoMeters) { rejected.tooFarVideo++; continue; }

        const minRoute = Math.max(0, clickRoute.routeMeters - CFG.routeWindowBehindMeters);
        const maxRoute = clickRoute.routeMeters + CFG.routeWindowAheadMeters;
        const pa = projectToRoute(a, minRoute, maxRoute);
        const pb = projectToRoute(b, minRoute, maxRoute);
        if (!pa || !pb || pa.distance > CFG.videoToRouteMeters || pb.distance > CFG.videoToRouteMeters) {
          rejected.routeMismatch++;
          continue;
        }

        const delta = pb.routeMeters - pa.routeMeters;
        if (delta < -8) { rejected.wrongDirection++; continue; }

        const interpolatedRouteMeters = pa.routeMeters + delta * clickOnVideo.t;
        const progressError = Math.abs(interpolatedRouteMeters - clickRoute.routeMeters);
        if (progressError > CFG.routeProgressTolerance) { rejected.progressMismatch++; continue; }

        const forward = validateForward(route, i, clickRoute.routeMeters);
        if (!forward.ok) { rejected.branchMismatch++; continue; }

        const ta = videoTime(points[i], route);
        const tb = videoTime(points[i + 1], route);
        const interpolatedVideoTime = ta + (tb - ta) * clickOnVideo.t;
        const priority = Number(route.priority) || 0;
        const score = priority * 100
          - clickOnVideo.distance * 4
          - progressError * 1.2
          - (pa.distance + pb.distance) * 0.6
          + Math.min(80, forward.evidence) * 0.2;

        candidates.push({
          route, id, segmentIndex: i,
          videoTime: Math.max(0, interpolatedVideoTime),
          clickDistance: clickOnVideo.distance,
          progressError,
          routeDistance: (pa.distance + pb.distance) / 2,
          forward,
          score
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score || a.clickDistance - b.clickDistance || a.progressError - b.progressError);
    return { match: candidates[0] || null, diagnostics: { clickRouteDistance: clickRoute.distance, candidateCount: candidates.length, rejected } };
  }

  function removePopup() {
    if (popup) { try { popup.remove(); } catch (_) {} popup = null; }
  }

  function showNoVideo(map, lngLat, diagnostics) {
    removePopup();
    popup = new mapboxgl.Popup({ maxWidth: '360px', closeButton: true, closeOnClick: false })
      .setLngLat(lngLat)
      .setHTML('<div class="route-video-popup"><div class="route-video-title">🎬 Đoạn này chưa có video</div><div class="route-video-meta">Không tìm thấy GPS-video trùng đúng nhánh đường và đúng chiều tại vị trí này.</div></div>')
      .addTo(map);
    window.VMAP_SINGLE_RESOLVER_LAST = { status: 'NO_VIDEO', version: 3, diagnostics };
  }

  async function handleRouteClick(e) {
    const map = e?.target;
    if (!map || !e?.lngLat) return;
    await loadLibrary();
    const result = resolve(e.lngLat);
    const match = result.match;
    if (!match) {
      console.log('🧭 Resolver v3 NO_VIDEO diagnostics:', result.diagnostics);
      showNoVideo(map, e.lngLat, result.diagnostics);
      return;
    }

    const start = Math.max(0, Math.floor(match.videoTime));
    const name = String(match.route.name || match.route.id || 'Video hướng dẫn').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
    const embed = `https://www.youtube.com/embed/${encodeURIComponent(match.id)}?start=${start}&autoplay=1&playsinline=1&rel=0`;
    const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(match.id)}&t=${start}s`;
    removePopup();
    popup = new mapboxgl.Popup({ maxWidth: '360px', closeButton: true, closeOnClick: false })
      .setLngLat(e.lngLat)
      .setHTML(`<div class="route-video-popup"><div class="route-video-title">🎬 Xem đúng đoạn tuyến</div><div class="route-video-meta">${name}<br>GPS-polyline ~${Math.round(match.clickDistance)} m • sai số tuyến ~${Math.round(match.progressError)} m</div><iframe src="${embed}" title="${name}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe><a class="route-video-youtube-link" href="${watch}" target="_blank" rel="noopener noreferrer">Mở đúng đoạn này trên YouTube ↗</a></div>`)
      .addTo(map);

    window.VMAP_SINGLE_RESOLVER_LAST = {
      status: 'MATCH', version: 3,
      route: match.route.name || match.route.id,
      clickDistance: match.clickDistance,
      routeProgressError: match.progressError,
      videoTime: match.videoTime,
      diagnostics: result.diagnostics
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
      return ids.length > 0 && map.queryRenderedFeatures(point, { layers: ids }).length > 0;
    } catch (_) { return false; }
  }

  const DirectionsProto = window.MapboxDirections?.prototype;
  if (DirectionsProto && typeof DirectionsProto.on === 'function' && !DirectionsProto.__vmapSingleResolverV3Patched) {
    const nativeOn = DirectionsProto.on;
    DirectionsProto.on = function(type, listener) {
      if (type === 'route' && typeof listener === 'function') {
        const wrapped = function(e) {
          const coords = extractRouteCoords(e);
          if (coords && coords.length > 1) {
            activeRoute = coords;
            activeCum = cumulative(coords);
            window.VMAP_SINGLE_RESOLVER_ROUTE = { version: 3, coords, lengthMeters: activeCum[activeCum.length - 1] || 0 };
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
    DirectionsProto.__vmapSingleResolverV3Patched = true;
  }

  const MapProto = window.mapboxgl?.Map?.prototype;
  if (MapProto && typeof MapProto.on === 'function' && !MapProto.__vmapSingleResolverV3Patched) {
    const nativeMapOn = MapProto.on;
    MapProto.on = function(type, layerOrListener, maybeListener) {
      if (type === 'click' && typeof layerOrListener === 'function' && maybeListener === undefined) {
        const source = Function.prototype.toString.call(layerOrListener);
        if (source.includes('openRouteVideoAtClick') && source.includes('isRouteFeatureAtPoint')) {
          console.log('🧭 Single Resolver v3 replaced legacy nearest-video route click handler.');
          return nativeMapOn.call(this, type, function(e) {
            if (!isDirectionsRouteAtPoint(this, e.point)) return;
            handleRouteClick(e).catch(err => {
              console.warn('🧭 Resolver v3 click failed:', err);
              showNoVideo(e.target, e.lngLat, { reason: 'resolver_exception', message: String(err?.message || err) });
            });
          });
        }
      }
      return nativeMapOn.apply(this, arguments);
    };
    MapProto.__vmapSingleResolverV3Patched = true;
  }

  loadLibrary();
  console.log('🧭 V-MapVideo Single Resolver v3 active — local route window + video polyline + forward branch validation.');
})();