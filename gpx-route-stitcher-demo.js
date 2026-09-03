// V-MapVideo GPX Route Stitcher DEMO v2
// Read-only analyzer for planned filming axes: validates GPS-video segments,
// matches each segment to the active Mapbox Directions route, resolves click->video timestamp,
// optimizes the best forward video chain, and publishes diagnostics.
// IMPORTANT: analysis only. It does NOT replace gps-route-overlay.js and does NOT control the player.
(function () {
  'use strict';

  if (window.__vMapStitcherDemoV2Installed) return;
  window.__vMapStitcherDemoV2Installed = true;

  const CFG = {
    routeMatchMeters: 45,
    clickMatchMeters: 180,
    maxDirectionDiffDeg: 65,
    minSegmentCoverageMeters: 35,
    routeSampleStep: 3,
    maxSamplesPerSegment: 120,
    toleratedSampleMisses: 2,
    maxCandidatesPerStep: 14,
    beamWidth: 24,
    maxChainSegments: 80,
    gapPenalty: 4.5,
    switchPenalty: 18,
    qualityWeight: 0.08,

    // Validator thresholds
    minPoints: 2,
    maxInvalidPointRatio: 0.10,
    maxGpsJumpMeters: 500,
    maxGpsJumpSpeedMps: 70,
    maxNonMonotonicTimeRatio: 0.05,
    minTimeSpanSeconds: 1,
    warnSparsePointGapMeters: 120
  };

  let libraryRoutes = [];
  let lastValidation = null;
  let lastRouteCoords = [];
  let lastRouteCum = [];
  let listenersInstalled = false;

  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;

  const toCoord = p => {
    const c = Array.isArray(p?.coords)
      ? [Number(p.coords[0]), Number(p.coords[1])]
      : [Number(p?.lng), Number(p?.lat)];
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
    if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) return null;
    return c;
  };

  const rawTime = p => {
    const v = Number(p?.tRaw ?? p?.rawTime ?? p?.sourceTime ?? p?.t ?? p?.time);
    return Number.isFinite(v) ? v : null;
  };

  function timelineEdits(e) {
    if (!Array.isArray(e)) return [];
    return e.map(x => {
      const start = Number(x.start ?? x.from ?? x.startRaw);
      const end = Number(x.end ?? x.to ?? x.endRaw);
      const keepSeconds = Number(x.keepSeconds ?? x.keep ?? 0);
      if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(keepSeconds)) return null;
      if (start < 0 || end <= start || keepSeconds < 0 || keepSeconds > end - start) return null;
      return { start, end, keepSeconds };
    }).filter(Boolean).sort((a, b) => a.start - b.start);
  }

  function rawToVideoTime(t, edits) {
    t = Math.max(0, Number(t) || 0);
    let removed = 0;
    for (const x of timelineEdits(edits)) {
      const dur = x.end - x.start;
      const cut = dur - x.keepSeconds;
      if (t >= x.end) {
        removed += cut;
        continue;
      }
      if (t > x.start && t < x.end) {
        return Math.max(0, x.start - removed + (t - x.start) / dur * x.keepSeconds);
      }
      if (t <= x.start) break;
    }
    return Math.max(0, t - removed);
  }

  function pointVideoTime(point, route) {
    const explicit = Number(point?.tVideo ?? point?.videoTime);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
    return rawToVideoTime(rawTime(point), route?.timelineEdits);
  }

  function hav(a, b) {
    const R = 6371000;
    const dLat = rad(b[1] - a[1]);
    const dLng = rad(b[0] - a[0]);
    const la = rad(a[1]);
    const lb = rad(b[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function bearing(a, b) {
    const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
    const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  function angleDiff(a, b) {
    let d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function youtubeId(v) {
    if (!v) return null;
    let raw = String(v).trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
    try {
      const u = new URL(raw, location.href);
      const h = u.hostname.toLowerCase().replace(/^www\./, '');
      if (h === 'youtu.be') raw = u.pathname.split('/').filter(Boolean)[0] || '';
      else if (h === 'youtube.com' || h === 'm.youtube.com') {
        if (u.pathname === '/watch') raw = u.searchParams.get('v') || '';
        else if (/^\/(embed|shorts)\//.test(u.pathname)) raw = u.pathname.split('/')[2] || '';
      }
    } catch (_) {}
    return /^[A-Za-z0-9_-]{11}$/.test(raw) ? raw : null;
  }

  function cumulativeDistances(coords) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + hav(coords[i - 1], coords[i]);
    return cum;
  }

  function projectPointToSegment(point, a, b) {
    const lat0 = rad((point[1] + a[1] + b[1]) / 3);
    const kx = 111320 * Math.cos(lat0);
    const ky = 110540;
    const px = point[0] * kx, py = point[1] * ky;
    const ax = a[0] * kx, ay = a[1] * ky;
    const bx = b[0] * kx, by = b[1] * ky;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    const qx = ax + t * dx, qy = ay + t * dy;
    return { t, distance: Math.hypot(px - qx, py - qy) };
  }

  function nearestRoutePosition(routeCoords, routeCum, point, step = 1) {
    if (!Array.isArray(routeCoords) || routeCoords.length < 2) return null;
    const stride = Math.max(1, step | 0);
    let best = null;

    // Coarse pass over route vertices.
    let bestVertex = 0, bestVertexDistance = Infinity;
    for (let i = 0; i < routeCoords.length; i += stride) {
      const d = hav(routeCoords[i], point);
      if (d < bestVertexDistance) {
        bestVertexDistance = d;
        bestVertex = i;
      }
    }

    // Refine around the closest coarse vertex and project onto line segments.
    const lo = Math.max(0, bestVertex - stride - 2);
    const hi = Math.min(routeCoords.length - 2, bestVertex + stride + 2);
    for (let i = lo; i <= hi; i++) {
      const p = projectPointToSegment(point, routeCoords[i], routeCoords[i + 1]);
      if (!best || p.distance < best.distance) {
        const segMeters = hav(routeCoords[i], routeCoords[i + 1]);
        best = {
          segmentIndex: i,
          fraction: p.t,
          distance: p.distance,
          routeMeters: routeCum[i] + segMeters * p.t,
          routeBearing: segMeters >= 2 ? bearing(routeCoords[i], routeCoords[i + 1]) : null
        };
      }
    }
    return best;
  }

  function validateSegment(route, index) {
    const id = String(route?.id || route?.name || `segment-${index + 1}`);
    const points = Array.isArray(route?.points) ? route.points : [];
    const errors = [];
    const warnings = [];
    if (!route || typeof route !== 'object') errors.push('segment_not_object');
    if (route?.enabled === false) warnings.push('segment_disabled');
    if (points.length < CFG.minPoints) errors.push('not_enough_points');

    let invalidPoints = 0;
    const validCoords = [];
    const validTimes = [];
    let nonMonotonicTime = 0;
    let timedPairs = 0;
    let maxJumpMeters = 0;
    let maxSpeedMps = 0;
    let sparseGapCount = 0;

    for (const point of points) {
      const c = toCoord(point);
      if (!c) {
        invalidPoints++;
        continue;
      }
      validCoords.push(c);
      validTimes.push(rawTime(point));
    }

    const invalidRatio = points.length ? invalidPoints / points.length : 1;
    if (invalidRatio > CFG.maxInvalidPointRatio) errors.push('too_many_invalid_coordinates');
    else if (invalidPoints > 0) warnings.push('some_invalid_coordinates');
    if (validCoords.length < CFG.minPoints) errors.push('not_enough_valid_coordinates');

    for (let i = 1; i < validCoords.length; i++) {
      const d = hav(validCoords[i - 1], validCoords[i]);
      maxJumpMeters = Math.max(maxJumpMeters, d);
      if (d > CFG.warnSparsePointGapMeters) sparseGapCount++;
      if (d > CFG.maxGpsJumpMeters) warnings.push('large_gps_jump');
      const t0 = validTimes[i - 1], t1 = validTimes[i];
      if (t0 != null && t1 != null) {
        timedPairs++;
        const dt = t1 - t0;
        if (dt <= 0) nonMonotonicTime++;
        else maxSpeedMps = Math.max(maxSpeedMps, d / dt);
      }
    }

    if (timedPairs > 0) {
      const ratio = nonMonotonicTime / timedPairs;
      if (ratio > CFG.maxNonMonotonicTimeRatio) errors.push('non_monotonic_timestamps');
      else if (nonMonotonicTime > 0) warnings.push('minor_timestamp_irregularity');
    } else warnings.push('timestamps_missing_or_unusable');

    const finiteTimes = validTimes.filter(Number.isFinite);
    if (finiteTimes.length >= 2 && Math.max(...finiteTimes) - Math.min(...finiteTimes) < CFG.minTimeSpanSeconds) {
      warnings.push('very_short_time_span');
    }
    if (maxSpeedMps > CFG.maxGpsJumpSpeedMps) warnings.push('implausible_gps_speed');
    if (sparseGapCount > 0) warnings.push('sparse_gps_points');
    if (!youtubeId(route?.youtube || route?.videoId || route?.video)) warnings.push('youtube_id_missing_or_invalid');

    return {
      id,
      index,
      valid: errors.length === 0,
      enabled: route?.enabled !== false,
      points: points.length,
      validPoints: validCoords.length,
      invalidPoints,
      invalidRatio,
      youtubeValid: Boolean(youtubeId(route?.youtube || route?.videoId || route?.video)),
      maxJumpMeters,
      maxSpeedMps,
      sparseGapCount,
      errors,
      warnings: [...new Set(warnings)],
      route
    };
  }

  function validateLibrary(routes) {
    const items = routes.map((r, i) => validateSegment(r, i));
    const accepted = items.filter(x => x.valid && x.enabled).map(x => x.route);
    const report = {
      total: items.length,
      valid: items.filter(x => x.valid).length,
      accepted: accepted.length,
      rejected: items.filter(x => !x.valid).length,
      disabled: items.filter(x => x.valid && !x.enabled).length,
      warned: items.filter(x => x.valid && x.warnings.length).length,
      items,
      acceptedRoutes: accepted
    };
    lastValidation = report;
    window.VMAP_STITCHER_DEMO_VALIDATION = report;
    return report;
  }

  function printValidationReport(report) {
    const status = report.rejected === 0 ? 'PASS' : 'WARN';
    console.groupCollapsed(`🧪 Stitcher Validator V2 — ${status} | accepted ${report.accepted}/${report.total}`);
    console.table(report.items.map(x => ({
      id: x.id,
      status: !x.valid ? 'REJECT' : (!x.enabled ? 'DISABLED' : (x.warnings.length ? 'WARN' : 'PASS')),
      points: x.points,
      valid_points: x.validPoints,
      youtube: x.youtubeValid ? 'OK' : 'WARN',
      max_jump_m: Math.round(x.maxJumpMeters),
      max_speed_kmh: Number.isFinite(x.maxSpeedMps) ? (x.maxSpeedMps * 3.6).toFixed(1) : '',
      warnings: x.warnings.join(', '),
      errors: x.errors.join(', ')
    })));
    console.groupEnd();
  }

  function sampleSegment(route) {
    const points = Array.isArray(route.points) ? route.points : [];
    if (points.length < 2) return [];
    const every = Math.max(1, Math.ceil(points.length / CFG.maxSamplesPerSegment));
    const samples = [];
    for (let i = 0; i < points.length; i += every) {
      const coord = toCoord(points[i]);
      if (coord) samples.push({ pointIndex: i, point: points[i], coord });
    }
    const lastIndex = points.length - 1;
    if (!samples.some(s => s.pointIndex === lastIndex)) {
      const coord = toCoord(points[lastIndex]);
      if (coord) samples.push({ pointIndex: lastIndex, point: points[lastIndex], coord });
    }
    return samples;
  }

  function buildMatchedRuns(route, routeCoords, routeCum) {
    const radius = Number(route.matchRadiusMeters) > 0 ? Number(route.matchRadiusMeters) : CFG.routeMatchMeters;
    const samples = sampleSegment(route).map(s => {
      const projection = nearestRoutePosition(routeCoords, routeCum, s.coord, CFG.routeSampleStep);
      return { ...s, projection, matched: Boolean(projection && projection.distance <= radius) };
    });

    const runs = [];
    let run = [];
    let misses = [];

    const flush = () => {
      if (run.length >= 2) runs.push(run);
      run = [];
      misses = [];
    };

    for (const sample of samples) {
      if (sample.matched) {
        if (run.length && misses.length <= CFG.toleratedSampleMisses) run.push(...misses);
        run.push(sample);
        misses = [];
      } else if (run.length) {
        misses.push(sample);
        if (misses.length > CFG.toleratedSampleMisses) flush();
      }
    }
    flush();
    return { samples, runs };
  }

  function candidateFromRun(route, run, runIndex) {
    const matched = run.filter(s => s.matched && s.projection);
    if (matched.length < 2) return { rejected: true, reason: 'insufficient_matches' };

    // Keep only forward progress along Directions. Planned filming axes should be monotonic.
    const forward = [];
    let maxMeters = -Infinity;
    for (const s of matched) {
      if (s.projection.routeMeters + 8 >= maxMeters) {
        forward.push(s);
        maxMeters = Math.max(maxMeters, s.projection.routeMeters);
      }
    }
    if (forward.length < 2) return { rejected: true, reason: 'non_forward_progress' };

    const first = forward[0];
    const last = forward[forward.length - 1];
    const startMeters = first.projection.routeMeters;
    const endMeters = last.projection.routeMeters;
    const coveredMeters = endMeters - startMeters;
    if (!(coveredMeters >= CFG.minSegmentCoverageMeters)) return { rejected: true, reason: 'coverage_too_short' };

    const videoBearing = bearing(first.coord, last.coord);
    const mid = forward[Math.floor(forward.length / 2)];
    const routeBearing = mid.projection.routeBearing;
    const dirDiff = routeBearing == null ? 0 : angleDiff(videoBearing, routeBearing);
    if (dirDiff > CFG.maxDirectionDiffDeg) return { rejected: true, reason: 'wrong_direction', directionDiff: dirDiff };

    const avgGpsDistance = forward.reduce((sum, s) => sum + s.projection.distance, 0) / forward.length;
    const matchedRatio = forward.length / Math.max(2, run.length);
    const priority = Number(route.priority) || 0;
    const qualityScore = coveredMeters - avgGpsDistance * 2 - dirDiff * 3 + matchedRatio * 80 + priority * 0.05;

    return {
      rejected: false,
      id: String(route.id || route.name || 'segment'),
      virtualId: `${String(route.id || route.name || 'segment')}#${runIndex + 1}`,
      runIndex,
      name: String(route.name || route.id || 'GPS segment'),
      youtube: route.youtube || route.videoId || route.video || '',
      priority,
      startMeters,
      endMeters,
      coveredMeters,
      avgGpsDistance,
      directionDiff: dirDiff,
      matchedRatio,
      qualityScore,
      sourceStartPointIndex: first.pointIndex,
      sourceEndPointIndex: last.pointIndex,
      sourceStartVideoTime: pointVideoTime(first.point, route),
      sourceEndVideoTime: pointVideoTime(last.point, route),
      source: route.librarySource || 'route-videos.json'
    };
  }

  function analyzeRouteSegment(route, routeCoords, routeCum) {
    const { samples, runs } = buildMatchedRuns(route, routeCoords, routeCum);
    const accepted = [];
    const rejected = [];

    if (!samples.length) {
      rejected.push({ id: route.id || route.name || 'segment', reason: 'no_valid_points' });
      return { accepted, rejected };
    }
    if (!runs.length) {
      rejected.push({ id: route.id || route.name || 'segment', reason: 'too_far_from_route' });
      return { accepted, rejected };
    }

    runs.forEach((run, runIndex) => {
      const result = candidateFromRun(route, run, runIndex);
      if (result.rejected) rejected.push({ id: route.id || route.name || 'segment', runIndex, ...result });
      else accepted.push(result);
    });
    return { accepted, rejected };
  }

  function stateScore(state) {
    const covered = Math.max(0, state.cursor - state.gapMeters);
    return covered * 10 - state.gapMeters * CFG.gapPenalty - state.switches * CFG.switchPenalty + state.quality * CFG.qualityWeight;
  }

  function optimizeChain(candidates, totalMeters) {
    if (!candidates.length) return [{ type: 'gap', startMeters: 0, endMeters: totalMeters, lengthMeters: totalMeters }];
    const sorted = [...candidates].sort((a, b) => a.startMeters - b.startMeters || b.endMeters - a.endMeters);
    let beam = [{ cursor: 0, gapMeters: 0, switches: 0, quality: 0, chain: [], used: new Set() }];
    let best = beam[0];

    for (let depth = 0; depth < CFG.maxChainSegments; depth++) {
      const next = [];
      for (const state of beam) {
        if (state.cursor >= totalMeters - 5) {
          next.push(state);
          continue;
        }

        const pool = sorted
          .filter(c => c.endMeters > state.cursor + 5 && !state.used.has(c.virtualId))
          .map(c => ({ c, gap: Math.max(0, c.startMeters - state.cursor) }))
          .sort((a, b) => a.gap - b.gap || b.c.qualityScore - a.c.qualityScore)
          .slice(0, CFG.maxCandidatesPerStep);

        if (!pool.length) {
          next.push(state);
          continue;
        }

        for (const { c, gap } of pool) {
          const chain = state.chain.slice();
          if (gap > 1) chain.push({ type: 'gap', startMeters: state.cursor, endMeters: c.startMeters, lengthMeters: gap });
          const previousVideo = [...chain].reverse().find(x => x.type === 'video');
          const switches = state.switches + (previousVideo && previousVideo.id !== c.id ? 1 : 0);
          chain.push({ type: 'video', ...c, gapBeforeMeters: gap });
          const used = new Set(state.used);
          used.add(c.virtualId);
          next.push({
            cursor: Math.max(state.cursor, c.endMeters),
            gapMeters: state.gapMeters + gap,
            switches,
            quality: state.quality + c.qualityScore,
            chain,
            used
          });
        }
      }

      next.sort((a, b) => stateScore(b) - stateScore(a));
      beam = next.slice(0, CFG.beamWidth);
      if (!beam.length) break;
      if (stateScore(beam[0]) > stateScore(best)) best = beam[0];
      if (beam.some(s => s.cursor >= totalMeters - 5)) {
        const completed = beam.filter(s => s.cursor >= totalMeters - 5).sort((a, b) => stateScore(b) - stateScore(a));
        if (completed.length) best = completed[0];
        break;
      }
    }

    const chain = best.chain.slice();
    if (best.cursor < totalMeters - 1) {
      chain.push({ type: 'gap', startMeters: best.cursor, endMeters: totalMeters, lengthMeters: totalMeters - best.cursor });
    }
    return chain;
  }

  function summarize(chain, totalMeters, candidates, rejectedCandidates, validation) {
    const gapMeters = chain.filter(x => x.type === 'gap').reduce((sum, x) => sum + x.lengthMeters, 0);
    const coveredMeters = Math.max(0, totalMeters - gapMeters);
    return {
      totalMeters,
      coveredMeters,
      gapMeters,
      coveragePct: totalMeters > 0 ? coveredMeters / totalMeters * 100 : 0,
      videoCount: chain.filter(x => x.type === 'video').length,
      gapCount: chain.filter(x => x.type === 'gap').length,
      candidateCount: candidates.length,
      rejectedCandidateCount: rejectedCandidates.length,
      wrongDirectionCount: rejectedCandidates.filter(x => x.reason === 'wrong_direction').length,
      tooFarCount: rejectedCandidates.filter(x => x.reason === 'too_far_from_route').length,
      validation: validation ? {
        total: validation.total,
        accepted: validation.accepted,
        rejected: validation.rejected,
        warned: validation.warned
      } : null
    };
  }

  function diagnosticStatus(summary) {
    if (!summary.videoCount) return 'NO_MATCH';
    if (summary.validation?.rejected > 0) return 'WARN';
    if (summary.coveragePct >= 95 && summary.gapMeters <= 100) return 'PASS';
    if (summary.coveragePct >= 70) return 'PARTIAL';
    return 'WARN';
  }

  function printReport(routeCoords, candidates, rejectedCandidates, chain, validation) {
    const cum = cumulativeDistances(routeCoords);
    const total = cum[cum.length - 1] || 0;
    const summary = summarize(chain, total, candidates, rejectedCandidates, validation);
    const status = diagnosticStatus(summary);

    console.groupCollapsed(`🧩 V-MapVideo Stitcher DEMO V2 — ${status} | ${summary.coveragePct.toFixed(1)}% | ${summary.videoCount} video segment(s)`);
    console.log('Route length:', `${(total / 1000).toFixed(2)} km`);
    console.log('Segments loaded:', validation?.total ?? libraryRoutes.length);
    console.log('Segments accepted by validator:', validation?.accepted ?? libraryRoutes.length);
    console.log('Route candidates accepted:', candidates.length);
    console.log('Route candidates rejected:', rejectedCandidates.length);
    console.log('Wrong direction:', summary.wrongDirectionCount, '| Too far:', summary.tooFarCount);
    console.log('Coverage:', `${summary.coveragePct.toFixed(1)}%`, '| Gaps:', `${Math.round(summary.gapMeters)} m`);

    console.table(chain.map((x, i) => x.type === 'video' ? {
      '#': i + 1,
      type: 'VIDEO',
      id: x.id,
      run: x.runIndex + 1,
      from_km: (x.startMeters / 1000).toFixed(3),
      to_km: (x.endMeters / 1000).toFixed(3),
      gps_m: x.avgGpsDistance.toFixed(1),
      dir_deg: x.directionDiff.toFixed(1),
      video_from_s: Math.round(x.sourceStartVideoTime || 0),
      video_to_s: Math.round(x.sourceEndVideoTime || 0),
      gap_before_m: Math.round(x.gapBeforeMeters || 0)
    } : {
      '#': i + 1,
      type: 'NO VIDEO',
      id: '',
      run: '',
      from_km: (x.startMeters / 1000).toFixed(3),
      to_km: (x.endMeters / 1000).toFixed(3),
      gps_m: '',
      dir_deg: '',
      video_from_s: '',
      video_to_s: '',
      gap_before_m: ''
    }));

    if (rejectedCandidates.length) {
      console.groupCollapsed(`Rejected route matches (${rejectedCandidates.length})`);
      console.table(rejectedCandidates.map(x => ({
        id: x.id,
        run: Number.isFinite(x.runIndex) ? x.runIndex + 1 : '',
        reason: x.reason,
        direction_deg: Number.isFinite(x.directionDiff) ? x.directionDiff.toFixed(1) : ''
      })));
      console.groupEnd();
    }

    console.groupEnd();
    window.VMAP_STITCHER_DEMO_LAST = {
      version: 2,
      routeCoords,
      candidates,
      rejectedCandidates,
      chain,
      summary,
      status,
      validation
    };
    window.dispatchEvent(new CustomEvent('vmap:stitcher-demo-result', { detail: window.VMAP_STITCHER_DEMO_LAST }));
  }

  function nearestPointOnVideo(route, lngLat) {
    const click = Array.isArray(lngLat) ? lngLat : [Number(lngLat?.lng), Number(lngLat?.lat)];
    if (!Number.isFinite(click[0]) || !Number.isFinite(click[1])) return null;
    let best = null;
    (route.points || []).forEach((point, pointIndex) => {
      const coord = toCoord(point);
      if (!coord) return;
      const distance = hav(click, coord);
      if (!best || distance < best.distance) {
        best = {
          route,
          point,
          pointIndex,
          coord,
          distance,
          videoTime: pointVideoTime(point, route)
        };
      }
    });
    return best;
  }

  function resolveClick(lng, lat, options = {}) {
    const click = [Number(lng), Number(lat)];
    if (!Number.isFinite(click[0]) || !Number.isFinite(click[1])) return null;
    const activeIds = new Set((window.VMAP_STITCHER_DEMO_LAST?.chain || []).filter(x => x.type === 'video').map(x => x.id));
    const routes = options.activeRouteOnly && activeIds.size ? libraryRoutes.filter(r => activeIds.has(String(r.id || r.name))) : libraryRoutes;
    const routeProjection = lastRouteCoords.length > 1 ? nearestRoutePosition(lastRouteCoords, lastRouteCum, click, CFG.routeSampleStep) : null;
    const results = [];

    for (const route of routes) {
      const nearest = nearestPointOnVideo(route, click);
      if (!nearest) continue;
      const max = Number(route.matchRadiusMeters) > 0 ? Number(route.matchRadiusMeters) : CFG.clickMatchMeters;
      if (nearest.distance > max) continue;

      let directionDiff = null;
      if (routeProjection?.routeBearing != null) {
        const points = route.points || [];
        let a = Math.max(0, nearest.pointIndex - 2), b = Math.min(points.length - 1, nearest.pointIndex + 2);
        const ca = toCoord(points[a]), cb = toCoord(points[b]);
        if (ca && cb && hav(ca, cb) >= 2) directionDiff = angleDiff(bearing(ca, cb), routeProjection.routeBearing);
      }
      if (directionDiff != null && directionDiff > CFG.maxDirectionDiffDeg) continue;
      results.push({
        id: String(route.id || route.name || 'segment'),
        name: String(route.name || route.id || 'GPS segment'),
        youtube: route.youtube || route.videoId || route.video || '',
        distanceMeters: nearest.distance,
        videoTime: nearest.videoTime,
        pointIndex: nearest.pointIndex,
        directionDiff,
        priority: Number(route.priority) || 0,
        coords: nearest.coord
      });
    }

    results.sort((a, b) => (a.directionDiff ?? 999) - (b.directionDiff ?? 999) || a.distanceMeters - b.distanceMeters || b.priority - a.priority);
    return results[0] || null;
  }

  function extractRouteCoords(e) {
    const c = (e?.route?.[0] || e?.route || e?.routes?.[0])?.geometry?.coordinates;
    return Array.isArray(c) && c.length > 1 ? c : null;
  }

  async function loadLibrary() {
    const res = await fetch('route-videos.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`route-videos.json HTTP ${res.status}`);
    const data = await res.json();
    const rawRoutes = Array.isArray(data) ? data : (Array.isArray(data?.routes) ? data.routes : []);
    const validation = validateLibrary(rawRoutes);
    libraryRoutes = validation.acceptedRoutes;
    printValidationReport(validation);
    console.log(`🧩 Stitcher DEMO V2: accepted ${libraryRoutes.length}/${validation.total} GPS-video segment(s).`);
    return validation;
  }

  async function analyzeEvent(e) {
    const routeCoords = extractRouteCoords(e);
    if (!routeCoords) return;
    if (!libraryRoutes.length) await loadLibrary();

    lastRouteCoords = routeCoords;
    lastRouteCum = cumulativeDistances(routeCoords);
    const total = lastRouteCum[lastRouteCum.length - 1] || 0;
    if (total <= 0) return;

    const candidates = [];
    const rejectedCandidates = [];
    for (const route of libraryRoutes) {
      const result = analyzeRouteSegment(route, routeCoords, lastRouteCum);
      candidates.push(...result.accepted);
      rejectedCandidates.push(...result.rejected);
    }

    const chain = optimizeChain(candidates, total);
    printReport(routeCoords, candidates, rejectedCandidates, chain, lastValidation);
  }

  function waitForDirections() {
    if (listenersInstalled) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const d = window.vMapDirections;
      if (!d) {
        if (Date.now() - started > 15000) {
          clearInterval(timer);
          console.warn('🧩 Stitcher DEMO V2: MapboxDirections not found.');
        }
        return;
      }
      clearInterval(timer);
      listenersInstalled = true;
      loadLibrary().catch(err => console.warn('🧩 Stitcher DEMO V2 library load failed:', err));
      d.on('route', e => analyzeEvent(e).catch(err => console.warn('🧩 Stitcher DEMO V2 analysis failed:', err)));
      d.on('clear', () => {
        lastRouteCoords = [];
        lastRouteCum = [];
        window.VMAP_STITCHER_DEMO_LAST = null;
      });
      console.log('🧩 V-MapVideo GPX Route Stitcher DEMO V2 active — axis matching + click resolver + beam optimizer + diagnostics. No player changes.');
    }, 100);
  }

  window.VMAP_STITCHER_DEMO = {
    version: 2,
    config: CFG,
    getLastResult: () => window.VMAP_STITCHER_DEMO_LAST || null,
    getValidation: () => window.VMAP_STITCHER_DEMO_VALIDATION || null,
    reloadLibrary: loadLibrary,
    resolveClick,
    analyzeRouteSegment: (route, routeCoords) => {
      const coords = Array.isArray(routeCoords) ? routeCoords : lastRouteCoords;
      const cum = cumulativeDistances(coords || []);
      return analyzeRouteSegment(route, coords || [], cum);
    }
  };

  addEventListener('load', waitForDirections, { once: true });
})();
