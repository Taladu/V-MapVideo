// V-MapVideo Single Resolver v4
// One authority for route-click -> GPS-video selection while Mapbox Directions is active.
// v4 replaces hard 25/45m rejection with broad search + local offset correction + shape/progress/direction/branch scoring.
(function () {
  'use strict';

  if (window.__vMapSingleResolverV4Installed) return;
  window.__vMapSingleResolverV4Installed = true;

  const CFG = Object.freeze({
    // Broad discovery only. A candidate this far away is NOT trusted until shape validation passes.
    broadClickMeters: 120,
    clickRouteMeters: 60,
    maxAnchorsPerRoute: 12,

    // Local comparison window around the click.
    videoBehindMeters: 120,
    videoAheadMeters: 190,
    routeBehindMeters: 170,
    routeAheadMeters: 240,
    forwardInspectMeters: 110,

    // Shape validation after estimating a constant local GPS offset.
    strongCorrectedDistanceMeters: 24,
    softCorrectedDistanceMeters: 42,
    hardCorrectedP80Meters: 58,
    hardMedianHeadingErrorDeg: 58,
    maxBacktrackStepMeters: 15,
    minProjectedSamples: 6,
    minMonotonicRatio: 0.60,
    minFitRatio: 0.56,
    minForwardProgressMeters: 24,
    minAheadFitRatio: 0.55,
    minConfidence: 0.64,

    // Long raw offsets are allowed only if they behave like a stable GPS bias and local shape is excellent.
    largeOffsetMeters: 55,
    veryLargeOffsetMeters: 95,
    maxOffsetVectorStdMeters: 24,

    maxVideoSegmentsToScan: 1800,
    diagnosticsLimit: 8
  });

  let activeRoute = [];
  let activeCum = [];
  let library = [];
  let libraryPromise = null;
  let popup = null;

  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;
  const clamp01 = x => Math.max(0, Math.min(1, x));

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

  function metricFrame(latDeg) {
    return { kx: 111320 * Math.cos(rad(latDeg)), ky: 110540 };
  }

  function deltaMeters(from, to) {
    const f = metricFrame((from[1] + to[1]) / 2);
    return { dx: (to[0] - from[0]) * f.kx, dy: (to[1] - from[1]) * f.ky };
  }

  function shiftCoord(c, dx, dy) {
    const f = metricFrame(c[1]);
    return [c[0] + dx / f.kx, c[1] + dy / f.ky];
  }

  function projectToSegment(p, a, b) {
    const lat0 = (p[1] + a[1] + b[1]) / 3;
    const { kx, ky } = metricFrame(lat0);
    const px = p[0] * kx, py = p[1] * ky;
    const ax = a[0] * kx, ay = a[1] * ky;
    const bx = b[0] * kx, by = b[1] * ky;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    const qx = ax + t * dx, qy = ay + t * dy;
    return { t, distance: Math.hypot(px - qx, py - qy), coord: [qx / kx, qy / ky] };
  }

  function bearing(a, b) {
    const la1 = rad(a[1]), la2 = rad(b[1]);
    const dLng = rad(b[0] - a[0]);
    const y = Math.sin(dLng) * Math.cos(la2);
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  function angleDiff(a, b) {
    let d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function median(values) {
    const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!v.length) return Infinity;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  function percentile(values, q) {
    const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!v.length) return Infinity;
    const idx = Math.max(0, Math.min(v.length - 1, Math.floor((v.length - 1) * q)));
    return v[idx];
  }

  function std(values) {
    const v = values.filter(Number.isFinite);
    if (v.length < 2) return 0;
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
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
          t: pr.t,
          coord: pr.coord
        };
      }
    }
    return best;
  }

  function routeBearingAtProjection(pr) {
    if (!pr || pr.segmentIndex < 0 || pr.segmentIndex >= activeRoute.length - 1) return null;
    return bearing(activeRoute[pr.segmentIndex], activeRoute[pr.segmentIndex + 1]);
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
        console.warn('🧭 Single Resolver v4 library load failed:', err);
        return library;
      });
    return libraryPromise;
  }

  function collectAnchors(route, clickCoord) {
    const points = route.points || [];
    const limit = Math.min(points.length - 1, CFG.maxVideoSegmentsToScan);
    const anchors = [];
    for (let i = 0; i < limit; i++) {
      const a = coord(points[i]), b = coord(points[i + 1]);
      if (!a || !b) continue;
      const pr = projectToSegment(clickCoord, a, b);
      if (pr.distance > CFG.broadClickMeters) continue;
      anchors.push({ segmentIndex: i, rawClickDistance: pr.distance, t: pr.t, videoCoord: pr.coord });
    }
    anchors.sort((a, b) => a.rawClickDistance - b.rawClickDistance);
    return anchors.slice(0, CFG.maxAnchorsPerRoute);
  }

  function collectWindow(route, segmentIndex) {
    const points = route.points || [];
    const out = [];
    const anchorIndex = Math.min(points.length - 1, segmentIndex + 1);

    let travelled = 0;
    let prev = coord(points[anchorIndex]);
    let first = anchorIndex;
    for (let i = anchorIndex - 1; i >= 0 && prev; i--) {
      const c = coord(points[i]);
      if (!c) continue;
      travelled += hav(c, prev);
      prev = c;
      first = i;
      if (travelled >= CFG.videoBehindMeters) break;
    }

    travelled = 0;
    prev = coord(points[anchorIndex]);
    let last = anchorIndex;
    for (let i = anchorIndex + 1; i < points.length && prev; i++) {
      const c = coord(points[i]);
      if (!c) continue;
      travelled += hav(prev, c);
      prev = c;
      last = i;
      if (travelled >= CFG.videoAheadMeters) break;
    }

    for (let i = first; i <= last; i++) {
      const c = coord(points[i]);
      if (c) out.push({ index: i, point: points[i], coord: c });
    }
    return { samples: out, first, last, anchorIndex };
  }

  function estimateOffsetConsistency(windowSamples, clickRoute, anchor) {
    // Anchor-derived correction aligns the clicked point on the video trace to the clicked point on the active route.
    const anchorDelta = deltaMeters(anchor.videoCoord, clickRoute.coord);
    const dx = anchorDelta.dx, dy = anchorDelta.dy;

    // Independently inspect raw video->route offset vectors around the anchor.
    // Stable vectors suggest a systematic GPS bias; unstable vectors suggest a wrong nearby branch.
    const rawDx = [], rawDy = [];
    const minRoute = Math.max(0, clickRoute.routeMeters - CFG.routeBehindMeters);
    const maxRoute = clickRoute.routeMeters + CFG.routeAheadMeters;
    for (const s of windowSamples) {
      const pr = projectToRoute(s.coord, minRoute, maxRoute);
      if (!pr || pr.distance > CFG.broadClickMeters + 30) continue;
      const d = deltaMeters(s.coord, pr.coord);
      rawDx.push(d.dx); rawDy.push(d.dy);
    }

    const vectorStd = Math.hypot(std(rawDx), std(rawDy));
    return { dx, dy, magnitude: Math.hypot(dx, dy), vectorStd, rawVectorSamples: Math.min(rawDx.length, rawDy.length) };
  }

  function evaluateAnchor(route, id, anchor, clickCoord, clickRoute) {
    const window = collectWindow(route, anchor.segmentIndex);
    if (window.samples.length < CFG.minProjectedSamples) {
      return { ok: false, reason: 'too_few_window_samples', anchor };
    }

    const offset = estimateOffsetConsistency(window.samples, clickRoute, anchor);
    const minRoute = Math.max(0, clickRoute.routeMeters - CFG.routeBehindMeters);
    const maxRoute = clickRoute.routeMeters + CFG.routeAheadMeters;
    const projected = [];

    for (const s of window.samples) {
      const corrected = shiftCoord(s.coord, offset.dx, offset.dy);
      const pr = projectToRoute(corrected, minRoute, maxRoute);
      if (!pr) continue;
      projected.push({ ...s, corrected, pr });
    }

    if (projected.length < CFG.minProjectedSamples) {
      return { ok: false, reason: 'too_few_projected_samples', anchor, offset };
    }

    const distances = projected.map(x => x.pr.distance);
    const medianDistance = median(distances);
    const p80Distance = percentile(distances, 0.80);
    const fitRatio = projected.filter(x => x.pr.distance <= CFG.softCorrectedDistanceMeters).length / projected.length;
    const strongFitRatio = projected.filter(x => x.pr.distance <= CFG.strongCorrectedDistanceMeters).length / projected.length;

    let forwardSteps = 0, backwardSteps = 0, neutralSteps = 0;
    const headingErrors = [];
    for (let i = 1; i < projected.length; i++) {
      const prev = projected[i - 1], cur = projected[i];
      const dr = cur.pr.routeMeters - prev.pr.routeMeters;
      if (dr >= -CFG.maxBacktrackStepMeters && dr > 1) forwardSteps++;
      else if (dr < -CFG.maxBacktrackStepMeters) backwardSteps++;
      else neutralSteps++;

      if (hav(prev.corrected, cur.corrected) >= 3) {
        const vb = bearing(prev.corrected, cur.corrected);
        const rb = routeBearingAtProjection(cur.pr);
        if (Number.isFinite(rb)) headingErrors.push(angleDiff(vb, rb));
      }
    }

    const directionalSteps = forwardSteps + backwardSteps;
    const monotonicRatio = directionalSteps ? forwardSteps / directionalSteps : 0;
    const medianHeadingError = median(headingErrors);
    const p80HeadingError = percentile(headingErrors, 0.80);

    // Find projected sample nearest the click in route progress, then inspect only future video samples.
    let clickSamplePos = 0;
    let bestProgressError = Infinity;
    for (let i = 0; i < projected.length; i++) {
      const e = Math.abs(projected[i].pr.routeMeters - clickRoute.routeMeters);
      if (e < bestProgressError) { bestProgressError = e; clickSamplePos = i; }
    }

    let videoForwardTravel = 0;
    let lastCoord = projected[clickSamplePos]?.coord || anchor.videoCoord;
    let maxForwardProgress = 0;
    let aheadValid = 0, aheadTotal = 0;
    const aheadHeadingErrors = [];
    for (let i = clickSamplePos + 1; i < projected.length; i++) {
      const s = projected[i];
      videoForwardTravel += hav(lastCoord, s.coord);
      lastCoord = s.coord;
      if (videoForwardTravel > CFG.forwardInspectMeters) break;
      aheadTotal++;
      const progress = s.pr.routeMeters - clickRoute.routeMeters;
      if (s.pr.distance <= CFG.softCorrectedDistanceMeters && progress >= -8) aheadValid++;
      maxForwardProgress = Math.max(maxForwardProgress, progress);
      if (i > clickSamplePos + 1) {
        const prev = projected[i - 1];
        if (hav(prev.corrected, s.corrected) >= 3) {
          const vb = bearing(prev.corrected, s.corrected);
          const rb = routeBearingAtProjection(s.pr);
          if (Number.isFinite(rb)) aheadHeadingErrors.push(angleDiff(vb, rb));
        }
      }
    }
    const aheadFitRatio = aheadTotal ? aheadValid / aheadTotal : 1;
    const aheadMedianHeadingError = aheadHeadingErrors.length ? median(aheadHeadingErrors) : medianHeadingError;
    const nearVideoEnd = videoForwardTravel < CFG.minForwardProgressMeters;

    // Interpolate time at the original anchor segment. Constant offset does not alter t along that video segment.
    const pA = route.points[anchor.segmentIndex];
    const pB = route.points[anchor.segmentIndex + 1];
    const ta = videoTime(pA, route), tb = videoTime(pB, route);
    const interpolatedVideoTime = ta + (tb - ta) * anchor.t;

    const distanceScore = clamp01(1 - medianDistance / 55) * 0.65 + clamp01(1 - p80Distance / 75) * 0.35;
    const fitScore = clamp01(fitRatio * 0.65 + strongFitRatio * 0.35);
    const headingScore = clamp01(1 - medianHeadingError / 80) * 0.7 + clamp01(1 - p80HeadingError / 105) * 0.3;
    const monotonicScore = clamp01(monotonicRatio);
    const forwardProgressScore = nearVideoEnd ? 0.85 : clamp01(maxForwardProgress / 75);
    const aheadShapeScore = clamp01(aheadFitRatio * 0.65 + clamp01(1 - aheadMedianHeadingError / 80) * 0.35);
    const offsetStabilityScore = offset.rawVectorSamples < 4 ? 0.65 : clamp01(1 - offset.vectorStd / 45);

    let confidence =
      fitScore * 0.22 +
      distanceScore * 0.17 +
      headingScore * 0.18 +
      monotonicScore * 0.13 +
      forwardProgressScore * 0.13 +
      aheadShapeScore * 0.12 +
      offsetStabilityScore * 0.05;

    // Mild penalty for huge raw offsets, never a hard rejection by itself.
    if (offset.magnitude > CFG.largeOffsetMeters) confidence -= Math.min(0.08, (offset.magnitude - CFG.largeOffsetMeters) / 500);
    if (offset.magnitude > CFG.veryLargeOffsetMeters) confidence -= 0.04;
    confidence = clamp01(confidence);

    let reason = null;
    if (p80Distance > CFG.hardCorrectedP80Meters) reason = 'shape_distance_bad';
    else if (fitRatio < CFG.minFitRatio) reason = 'shape_fit_low';
    else if (monotonicRatio < CFG.minMonotonicRatio) reason = 'wrong_direction_or_backtrack';
    else if (medianHeadingError > CFG.hardMedianHeadingErrorDeg) reason = 'heading_mismatch';
    else if (!nearVideoEnd && maxForwardProgress < CFG.minForwardProgressMeters) reason = 'insufficient_forward_progress';
    else if (!nearVideoEnd && aheadFitRatio < CFG.minAheadFitRatio) reason = 'branch_diverged';
    else if (offset.magnitude > CFG.largeOffsetMeters && offset.rawVectorSamples >= 5 && offset.vectorStd > CFG.maxOffsetVectorStdMeters && confidence < 0.78) reason = 'unstable_large_offset';
    else if (confidence < CFG.minConfidence) reason = 'confidence_low';

    return {
      ok: !reason,
      reason,
      route,
      id,
      anchor,
      videoTime: Math.max(0, interpolatedVideoTime),
      confidence,
      metrics: {
        rawClickDistance: anchor.rawClickDistance,
        offsetMeters: offset.magnitude,
        offsetVectorStdMeters: offset.vectorStd,
        correctedMedianMeters: medianDistance,
        correctedP80Meters: p80Distance,
        fitRatio,
        strongFitRatio,
        monotonicRatio,
        medianHeadingErrorDeg: medianHeadingError,
        p80HeadingErrorDeg: p80HeadingError,
        forwardProgressMeters: maxForwardProgress,
        aheadFitRatio,
        aheadMedianHeadingErrorDeg: aheadMedianHeadingError,
        nearVideoEnd,
        progressErrorMeters: bestProgressError,
        projectedSamples: projected.length
      }
    };
  }

  function resolve(click) {
    if (activeRoute.length < 2 || !library.length) {
      return { match: null, diagnostics: { reason: 'route_or_library_missing', activeRoutePoints: activeRoute.length, libraryCount: library.length } };
    }

    const clickCoord = [Number(click.lng), Number(click.lat)];
    if (!Number.isFinite(clickCoord[0]) || !Number.isFinite(clickCoord[1])) {
      return { match: null, diagnostics: { reason: 'bad_click' } };
    }

    const clickRoute = projectToRoute(clickCoord);
    if (!clickRoute || clickRoute.distance > CFG.clickRouteMeters) {
      return { match: null, diagnostics: { reason: 'click_not_on_active_route', routeDistance: clickRoute?.distance } };
    }

    const accepted = [];
    const rejected = [];
    const summary = { noYoutube: 0, noAnchor: 0, evaluated: 0 };

    for (const route of library) {
      const id = youtubeId(route.youtube || route.videoId || route.video);
      if (!id) { summary.noYoutube++; continue; }
      const anchors = collectAnchors(route, clickCoord);
      if (!anchors.length) { summary.noAnchor++; continue; }

      for (const anchor of anchors) {
        summary.evaluated++;
        const result = evaluateAnchor(route, id, anchor, clickCoord, clickRoute);
        if (result.ok) accepted.push(result);
        else rejected.push(result);
      }
    }

    accepted.sort((a, b) => {
      const pa = Number(a.route.priority) || 0;
      const pb = Number(b.route.priority) || 0;
      return (pb - pa) || (b.confidence - a.confidence) || (a.metrics.rawClickDistance - b.metrics.rawClickDistance);
    });

    rejected.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const topRejected = rejected.slice(0, CFG.diagnosticsLimit).map(x => ({
      route: x.route?.name || x.route?.id,
      reason: x.reason,
      confidence: Number((x.confidence || 0).toFixed(3)),
      metrics: x.metrics
    }));

    return {
      match: accepted[0] || null,
      diagnostics: {
        version: 4,
        clickRouteDistance: clickRoute.distance,
        acceptedCount: accepted.length,
        rejectedCount: rejected.length,
        summary,
        topRejected
      }
    };
  }

  function removePopup() {
    if (popup) { try { popup.remove(); } catch (_) {} popup = null; }
  }

  function showNoVideo(map, lngLat, diagnostics) {
    removePopup();
    popup = new mapboxgl.Popup({ maxWidth: '380px', closeButton: true, closeOnClick: false })
      .setLngLat(lngLat)
      .setHTML('<div class="route-video-popup"><div class="route-video-title">🎬 Đoạn này chưa có video</div><div class="route-video-meta">Không tìm thấy GPS-video đủ độ tin cậy trên đúng nhánh và đúng chiều tại vị trí này.</div></div>')
      .addTo(map);
    window.VMAP_SINGLE_RESOLVER_LAST = { status: 'NO_VIDEO', version: 4, diagnostics };
  }

  async function handleRouteClick(e) {
    const map = e?.target;
    if (!map || !e?.lngLat) return;
    await loadLibrary();
    const result = resolve(e.lngLat);
    const match = result.match;

    if (!match) {
      console.log('🧭 Resolver v4 NO_VIDEO diagnostics:', result.diagnostics);
      showNoVideo(map, e.lngLat, result.diagnostics);
      return;
    }

    const start = Math.max(0, Math.floor(match.videoTime));
    const name = String(match.route.name || match.route.id || 'Video hướng dẫn').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
    const embed = `https://www.youtube.com/embed/${encodeURIComponent(match.id)}?start=${start}&autoplay=1&playsinline=1&rel=0`;
    const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(match.id)}&t=${start}s`;
    const m = match.metrics;

    removePopup();
    popup = new mapboxgl.Popup({ maxWidth: '380px', closeButton: true, closeOnClick: false })
      .setLngLat(e.lngLat)
      .setHTML(`<div class="route-video-popup"><div class="route-video-title">🎬 Xem đúng đoạn tuyến</div><div class="route-video-meta">${name}<br>độ tin cậy ${Math.round(match.confidence * 100)}% • GPS offset ~${Math.round(m.offsetMeters)} m • sai số sau hiệu chỉnh ~${Math.round(m.correctedMedianMeters)} m</div><iframe src="${embed}" title="${name}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe><a class="route-video-youtube-link" href="${watch}" target="_blank" rel="noopener noreferrer">Mở đúng đoạn này trên YouTube ↗</a></div>`)
      .addTo(map);

    window.VMAP_SINGLE_RESOLVER_LAST = {
      status: 'MATCH',
      version: 4,
      route: match.route.name || match.route.id,
      confidence: match.confidence,
      videoTime: match.videoTime,
      metrics: match.metrics,
      diagnostics: result.diagnostics
    };
    console.log('🧭 Resolver v4 MATCH:', window.VMAP_SINGLE_RESOLVER_LAST);
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

  // Capture active Directions geometry before script.js registers its route handlers.
  const DirectionsProto = window.MapboxDirections?.prototype;
  if (DirectionsProto && typeof DirectionsProto.on === 'function' && !DirectionsProto.__vmapSingleResolverV4Patched) {
    const nativeOn = DirectionsProto.on;
    DirectionsProto.on = function(type, listener) {
      if (type === 'route' && typeof listener === 'function') {
        const wrapped = function(e) {
          const coords = extractRouteCoords(e);
          if (coords && coords.length > 1) {
            activeRoute = coords;
            activeCum = cumulative(coords);
            window.VMAP_SINGLE_RESOLVER_ROUTE = { version: 4, coords, lengthMeters: activeCum[activeCum.length - 1] || 0 };
            console.log('🧭 Resolver v4 captured active route:', window.VMAP_SINGLE_RESOLVER_ROUTE.lengthMeters, 'm');
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
    DirectionsProto.__vmapSingleResolverV4Patched = true;
  }

  // Replace only the legacy generic route-click handler from script.js.
  const MapProto = window.mapboxgl?.Map?.prototype;
  if (MapProto && typeof MapProto.on === 'function' && !MapProto.__vmapSingleResolverV4Patched) {
    const nativeMapOn = MapProto.on;
    MapProto.on = function(type, layerOrListener, maybeListener) {
      if (type === 'click' && typeof layerOrListener === 'function' && maybeListener === undefined) {
        const source = Function.prototype.toString.call(layerOrListener);
        if (source.includes('openRouteVideoAtClick') && source.includes('isRouteFeatureAtPoint')) {
          console.log('🧭 Single Resolver v4 replaced legacy nearest-video route click handler.');
          return nativeMapOn.call(this, type, function(e) {
            if (!isDirectionsRouteAtPoint(this, e.point)) return;
            handleRouteClick(e).catch(err => {
              console.warn('🧭 Resolver v4 click failed:', err);
              showNoVideo(e.target, e.lngLat, { reason: 'resolver_exception', message: String(err?.message || err) });
            });
          });
        }
      }
      return nativeMapOn.apply(this, arguments);
    };
    MapProto.__vmapSingleResolverV4Patched = true;
  }

  // Small debug surface for field testing without exposing implementation internals in normal UI.
  window.VMAP_SINGLE_RESOLVER_DEBUG = {
    version: 4,
    config: CFG,
    resolveAt(lng, lat) {
      return loadLibrary().then(() => resolve({ lng: Number(lng), lat: Number(lat) }));
    },
    getRoute() { return window.VMAP_SINGLE_RESOLVER_ROUTE || null; },
    getLast() { return window.VMAP_SINGLE_RESOLVER_LAST || null; }
  };

  loadLibrary();
  console.log('🧭 V-MapVideo Single Resolver v4 active — broad search + local GPS offset + shape/progress/direction/branch confidence.');
})();