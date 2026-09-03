// V-MapVideo Single Resolver v5
// Direct runtime integration + local shape matching. No prototype monkey-patching.
// Active Mapbox Directions route is the authority; nearest-video fallback is never used.
(function () {
  'use strict';
  if (window.__vMapSingleResolverV5Installed) return;
  window.__vMapSingleResolverV5Installed = true;

  const CFG = Object.freeze({
    clickRouteMeters: 65,
    broadVideoMeters: 130,
    maxAnchorsPerRoute: 10,
    videoBehindMeters: 130,
    videoAheadMeters: 230,
    routeBehindMeters: 190,
    routeAheadMeters: 280,
    forwardInspectMeters: 130,
    minSamples: 7,
    strongFitMeters: 25,
    softFitMeters: 45,
    p80HardMeters: 62,
    headingHardDeg: 68,
    minFitRatio: 0.56,
    minMonotonicRatio: 0.62,
    minAheadFitRatio: 0.55,
    minForwardProgressMeters: 26,
    minConfidence: 0.62,
    maxStableOffsetStdMeters: 28,
    maxBacktrackStepMeters: 18,
    diagnosticsLimit: 10,
    sampleStride: 2
  });

  let activeRoute = [];
  let activeCum = [];
  let library = [];
  let libraryPromise = null;
  let popup = null;
  let boundDirections = null;

  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;
  const clamp01 = x => Math.max(0, Math.min(1, x));

  function hav(a, b) {
    const R = 6371000;
    const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
    const la = rad(a[1]), lb = rad(b[1]);
    const h = Math.sin(dLat/2)**2 + Math.cos(la)*Math.cos(lb)*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function frame(lat) { return { kx: 111320 * Math.cos(rad(lat)), ky: 110540 }; }
  function coord(p) {
    const c = Array.isArray(p?.coords) ? [Number(p.coords[0]), Number(p.coords[1])] : [Number(p?.lng), Number(p?.lat)];
    return Number.isFinite(c[0]) && Number.isFinite(c[1]) ? c : null;
  }
  function cumulative(coords) {
    const out = [0];
    for (let i=1;i<coords.length;i++) out[i] = out[i-1] + hav(coords[i-1], coords[i]);
    return out;
  }
  function projectSeg(p,a,b) {
    const f=frame((p[1]+a[1]+b[1])/3);
    const px=p[0]*f.kx, py=p[1]*f.ky, ax=a[0]*f.kx, ay=a[1]*f.ky, bx=b[0]*f.kx, by=b[1]*f.ky;
    const dx=bx-ax, dy=by-ay, l2=dx*dx+dy*dy;
    const t=l2 ? Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l2)) : 0;
    const qx=ax+t*dx, qy=ay+t*dy;
    return { t, distance: Math.hypot(px-qx,py-qy), coord:[qx/f.kx,qy/f.ky] };
  }
  function projectRoute(p,minM=-Infinity,maxM=Infinity) {
    if (activeRoute.length<2) return null;
    let best=null;
    for (let i=0;i<activeRoute.length-1;i++) {
      const s=activeCum[i], e=activeCum[i+1];
      if (e<minM || s>maxM) continue;
      const pr=projectSeg(p,activeRoute[i],activeRoute[i+1]);
      if (!best || pr.distance<best.distance) best={distance:pr.distance,routeMeters:s+(e-s)*pr.t,segmentIndex:i,t:pr.t,coord:pr.coord};
    }
    return best;
  }
  function bearing(a,b) {
    const a1=rad(a[1]), a2=rad(b[1]), dl=rad(b[0]-a[0]);
    const y=Math.sin(dl)*Math.cos(a2), x=Math.cos(a1)*Math.sin(a2)-Math.sin(a1)*Math.cos(a2)*Math.cos(dl);
    return (deg(Math.atan2(y,x))+360)%360;
  }
  function angleDiff(a,b) { let d=Math.abs(a-b)%360; return d>180?360-d:d; }
  function routeBearing(pr) {
    if (!pr || pr.segmentIndex<0 || pr.segmentIndex>=activeRoute.length-1) return null;
    return bearing(activeRoute[pr.segmentIndex],activeRoute[pr.segmentIndex+1]);
  }
  function median(v) { const a=v.filter(Number.isFinite).slice().sort((x,y)=>x-y); if(!a.length)return Infinity; const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }
  function pctl(v,q) { const a=v.filter(Number.isFinite).slice().sort((x,y)=>x-y); if(!a.length)return Infinity; return a[Math.max(0,Math.min(a.length-1,Math.floor((a.length-1)*q)))]; }
  function std(v) { const a=v.filter(Number.isFinite); if(a.length<2)return 0; const m=a.reduce((s,x)=>s+x,0)/a.length; return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/a.length); }
  function deltaMeters(from,to) { const f=frame((from[1]+to[1])/2); return {dx:(to[0]-from[0])*f.kx,dy:(to[1]-from[1])*f.ky}; }
  function shift(c,dx,dy) { const f=frame(c[1]); return [c[0]+dx/f.kx,c[1]+dy/f.ky]; }

  function rawTime(p) { const v=Number(p?.tRaw??p?.rawTime??p?.sourceTime??p?.t??p?.time??0); return Number.isFinite(v)?Math.max(0,v):0; }
  function edits(route) {
    return (Array.isArray(route?.timelineEdits)?route.timelineEdits:[]).map(x=>({start:Number(x.start??x.from??x.startRaw),end:Number(x.end??x.to??x.endRaw),keep:Number(x.keepSeconds??x.keep??0)}))
      .filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)&&Number.isFinite(x.keep)&&x.end>x.start&&x.keep>=0&&x.keep<=x.end-x.start).sort((a,b)=>a.start-b.start);
  }
  function videoTime(p,route) {
    const explicit=Number(p?.tVideo??p?.videoTime); if(Number.isFinite(explicit)&&explicit>=0)return explicit;
    const t=rawTime(p); let removed=0;
    for(const x of edits(route)){const dur=x.end-x.start,cut=dur-x.keep;if(t>=x.end){removed+=cut;continue;}if(t>x.start)return Math.max(0,x.start-removed+((t-x.start)/dur)*x.keep);break;}
    return Math.max(0,t-removed);
  }
  function youtubeId(value) {
    if(!value)return null; let raw=String(value).trim(); if(/^[A-Za-z0-9_-]{11}$/.test(raw))return raw;
    try { const u=new URL(raw,location.href); if(u.hostname.includes('youtu.be'))raw=u.pathname.split('/').filter(Boolean)[0]||''; else if(u.pathname.startsWith('/embed/')||u.pathname.startsWith('/shorts/'))raw=u.pathname.split('/')[2]||''; else raw=u.searchParams.get('v')||raw; } catch(_){}
    return /^[A-Za-z0-9_-]{11}$/.test(raw)?raw:null;
  }

  async function loadLibrary() {
    if(libraryPromise)return libraryPromise;
    libraryPromise=fetch('route-videos.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(`route-videos.json HTTP ${r.status}`);return r.json();}).then(data=>{
      const routes=Array.isArray(data)?data:(Array.isArray(data?.routes)?data.routes:[]);
      library=routes.filter(r=>r&&r.enabled!==false&&Array.isArray(r.points)&&r.points.length>=2);
      return library;
    }).catch(err=>{library=[];console.warn('🧭 Resolver v5 library load failed:',err);return library;});
    return libraryPromise;
  }

  function extractRouteCoords(e) {
    const g=(e?.route?.[0]||e?.route||e?.routes?.[0])?.geometry;
    return g?.type==='LineString'&&Array.isArray(g.coordinates)?g.coordinates:null;
  }
  function captureRouteEvent(e) {
    const c=extractRouteCoords(e); if(!c||c.length<2)return false;
    activeRoute=c; activeCum=cumulative(c);
    window.VMAP_SINGLE_RESOLVER_ROUTE={version:5,coords:c,lengthMeters:activeCum[activeCum.length-1]||0};
    console.log('🧭 Resolver v5 captured route',Math.round(window.VMAP_SINGLE_RESOLVER_ROUTE.lengthMeters),'m');
    return true;
  }
  function clearRoute() { activeRoute=[];activeCum=[];window.VMAP_SINGLE_RESOLVER_ROUTE=null;if(popup){try{popup.remove();}catch(_){}popup=null;} }

  function anchors(route,click) {
    const pts=route.points||[], out=[];
    for(let i=0;i<pts.length-1;i++){
      const a=coord(pts[i]),b=coord(pts[i+1]);if(!a||!b)continue;
      const pr=projectSeg(click,a,b);if(pr.distance<=CFG.broadVideoMeters)out.push({i,t:pr.t,rawDistance:pr.distance,videoCoord:pr.coord});
    }
    out.sort((a,b)=>a.rawDistance-b.rawDistance);return out.slice(0,CFG.maxAnchorsPerRoute);
  }
  function videoWindow(route,anchorIndex) {
    const pts=route.points||[];let first=anchorIndex,last=Math.min(pts.length-1,anchorIndex+1),d=0,prev=coord(pts[first]);
    for(let i=first-1;i>=0&&prev;i--){const c=coord(pts[i]);if(!c)continue;d+=hav(c,prev);prev=c;first=i;if(d>=CFG.videoBehindMeters)break;}
    d=0;prev=coord(pts[last]);for(let i=last+1;i<pts.length&&prev;i++){const c=coord(pts[i]);if(!c)continue;d+=hav(prev,c);prev=c;last=i;if(d>=CFG.videoAheadMeters)break;}
    const samples=[];for(let i=first;i<=last;i+=CFG.sampleStride){const c=coord(pts[i]);if(c)samples.push({index:i,point:pts[i],coord:c});}
    if(last!==samples.at(-1)?.index){const c=coord(pts[last]);if(c)samples.push({index:last,point:pts[last],coord:c});}
    return samples;
  }

  function evaluate(route,id,anchor,clickRoute) {
    const samples=videoWindow(route,anchor.i);if(samples.length<CFG.minSamples)return {ok:false,reason:'too_few_samples',route,confidence:0};
    const off=deltaMeters(anchor.videoCoord,clickRoute.coord);
    const minM=Math.max(0,clickRoute.routeMeters-CFG.routeBehindMeters),maxM=clickRoute.routeMeters+CFG.routeAheadMeters;
    const projected=[],rawDx=[],rawDy=[];
    for(const s of samples){
      const rawPr=projectRoute(s.coord,minM,maxM);if(rawPr&&rawPr.distance<=CFG.broadVideoMeters+40){const d=deltaMeters(s.coord,rawPr.coord);rawDx.push(d.dx);rawDy.push(d.dy);}
      const corrected=shift(s.coord,off.dx,off.dy),pr=projectRoute(corrected,minM,maxM);if(pr)projected.push({...s,corrected,pr});
    }
    if(projected.length<CFG.minSamples)return {ok:false,reason:'too_few_projected',route,confidence:0};
    const dist=projected.map(x=>x.pr.distance),med=median(dist),p80=pctl(dist,.8),fit=projected.filter(x=>x.pr.distance<=CFG.softFitMeters).length/projected.length,strong=projected.filter(x=>x.pr.distance<=CFG.strongFitMeters).length/projected.length;
    let fwd=0,back=0;const head=[];
    for(let i=1;i<projected.length;i++){const a=projected[i-1],b=projected[i],dr=b.pr.routeMeters-a.pr.routeMeters;if(dr>1)fwd++;else if(dr<-CFG.maxBacktrackStepMeters)back++;if(hav(a.corrected,b.corrected)>=4){const rb=routeBearing(b.pr);if(Number.isFinite(rb))head.push(angleDiff(bearing(a.corrected,b.corrected),rb));}}
    const mono=(fwd+back)?fwd/(fwd+back):0,medHead=median(head),p80Head=pctl(head,.8);
    let clickPos=0,bestErr=Infinity;for(let i=0;i<projected.length;i++){const e=Math.abs(projected[i].pr.routeMeters-clickRoute.routeMeters);if(e<bestErr){bestErr=e;clickPos=i;}}
    let aheadTotal=0,aheadGood=0,maxProg=0,travel=0,prev=projected[clickPos]?.coord;
    for(let i=clickPos+1;i<projected.length&&prev;i++){const s=projected[i];travel+=hav(prev,s.coord);prev=s.coord;if(travel>CFG.forwardInspectMeters)break;aheadTotal++;const prog=s.pr.routeMeters-clickRoute.routeMeters;maxProg=Math.max(maxProg,prog);if(s.pr.distance<=CFG.softFitMeters&&prog>=-10)aheadGood++;}
    const aheadFit=aheadTotal?aheadGood/aheadTotal:1,nearEnd=travel<CFG.minForwardProgressMeters;
    const offsetStd=Math.hypot(std(rawDx),std(rawDy)),offsetMag=Math.hypot(off.dx,off.dy);
    const distanceScore=.65*clamp01(1-med/58)+.35*clamp01(1-p80/78);
    const fitScore=.65*fit+.35*strong,headingScore=.7*clamp01(1-medHead/90)+.3*clamp01(1-p80Head/115),monoScore=clamp01(mono),aheadScore=.65*aheadFit+.35*clamp01(maxProg/80),stability=rawDx.length<4?.65:clamp01(1-offsetStd/50);
    let confidence=.22*fitScore+.18*distanceScore+.18*headingScore+.15*monoScore+.17*aheadScore+.10*stability;
    if(offsetMag>90)confidence-=Math.min(.08,(offsetMag-90)/500);confidence=clamp01(confidence);
    let reason=null;
    if(p80>CFG.p80HardMeters)reason='shape_distance_bad';else if(fit<CFG.minFitRatio)reason='shape_fit_low';else if(mono<CFG.minMonotonicRatio)reason='wrong_direction';else if(medHead>CFG.headingHardDeg)reason='heading_mismatch';else if(!nearEnd&&maxProg<CFG.minForwardProgressMeters)reason='forward_progress_low';else if(!nearEnd&&aheadFit<CFG.minAheadFitRatio)reason='branch_diverged';else if(offsetMag>55&&rawDx.length>=5&&offsetStd>CFG.maxStableOffsetStdMeters&&confidence<.78)reason='offset_unstable';else if(confidence<CFG.minConfidence)reason='confidence_low';
    const pA=route.points[anchor.i],pB=route.points[anchor.i+1],t=videoTime(pA,route)+(videoTime(pB,route)-videoTime(pA,route))*anchor.t;
    return {ok:!reason,reason,route,id,videoTime:Math.max(0,t),confidence,metrics:{rawClickDistance:anchor.rawDistance,offsetMeters:offsetMag,offsetStd,correctedMedian:med,correctedP80:p80,fitRatio:fit,strongFitRatio:strong,monotonicRatio:mono,medianHeadingError:medHead,aheadFitRatio:aheadFit,forwardProgress:maxProg,progressError:bestErr,projectedSamples:projected.length}};
  }

  function resolve(click) {
    if(activeRoute.length<2||!library.length)return {match:null,diagnostics:{reason:'route_or_library_missing',activeRoutePoints:activeRoute.length,libraryCount:library.length}};
    const c=[Number(click.lng),Number(click.lat)];if(!Number.isFinite(c[0])||!Number.isFinite(c[1]))return {match:null,diagnostics:{reason:'bad_click'}};
    const cp=projectRoute(c);if(!cp||cp.distance>CFG.clickRouteMeters)return {match:null,diagnostics:{reason:'click_not_on_active_route',routeDistance:cp?.distance}};
    const accepted=[],rejected=[];let noYoutube=0,noAnchor=0;
    for(const route of library){const id=youtubeId(route.youtube||route.videoId||route.video);if(!id){noYoutube++;continue;}const aa=anchors(route,c);if(!aa.length){noAnchor++;continue;}for(const a of aa){const r=evaluate(route,id,a,cp);(r.ok?accepted:rejected).push(r);}}
    accepted.sort((a,b)=>(Number(b.route.priority)||0)-(Number(a.route.priority)||0)||b.confidence-a.confidence||a.metrics.rawClickDistance-b.metrics.rawClickDistance);
    rejected.sort((a,b)=>(b.confidence||0)-(a.confidence||0));
    return {match:accepted[0]||null,diagnostics:{version:5,clickRouteDistance:cp.distance,acceptedCount:accepted.length,rejectedCount:rejected.length,noYoutube,noAnchor,topRejected:rejected.slice(0,CFG.diagnosticsLimit).map(x=>({route:x.route?.name||x.route?.id,reason:x.reason,confidence:+(x.confidence||0).toFixed(3),metrics:x.metrics}))}};
  }

  function removePopup(){if(popup){try{popup.remove();}catch(_){}popup=null;}}
  function showNoVideo(map,ll,d){removePopup();popup=new mapboxgl.Popup({maxWidth:'390px',closeButton:true,closeOnClick:false}).setLngLat(ll).setHTML('<div class="route-video-popup"><div class="route-video-title">🎬 Đoạn này chưa có video</div><div class="route-video-meta">Không có GPS-video đủ độ tin cậy trên đúng nhánh và đúng chiều. Không dùng video gần nhất.</div></div>').addTo(map);window.VMAP_SINGLE_RESOLVER_LAST={status:'NO_VIDEO',version:5,diagnostics:d};console.log('🧭 Resolver v5 NO_VIDEO',d);}
  async function handleMapClick(e){const map=e?.target||window.vMapMap;if(!map||!e?.lngLat)return false;await loadLibrary();const r=resolve(e.lngLat);if(!r.match){showNoVideo(map,e.lngLat,r.diagnostics);return true;}const m=r.match,start=Math.max(0,Math.floor(m.videoTime)),name=String(m.route.name||m.route.id||'Video hướng dẫn').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[c]));const embed=`https://www.youtube.com/embed/${encodeURIComponent(m.id)}?start=${start}&autoplay=1&playsinline=1&rel=0`,watch=`https://www.youtube.com/watch?v=${encodeURIComponent(m.id)}&t=${start}s`;removePopup();popup=new mapboxgl.Popup({maxWidth:'390px',closeButton:true,closeOnClick:false}).setLngLat(e.lngLat).setHTML(`<div class="route-video-popup"><div class="route-video-title">🎬 Xem đúng đoạn tuyến</div><div class="route-video-meta">${name}<br>tin cậy ${Math.round(m.confidence*100)}% • offset GPS ~${Math.round(m.metrics.offsetMeters)} m • sai số hiệu chỉnh ~${Math.round(m.metrics.correctedMedian)} m</div><iframe src="${embed}" title="${name}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe><a class="route-video-youtube-link" href="${watch}" target="_blank" rel="noopener noreferrer">Mở đúng đoạn này trên YouTube ↗</a></div>`).addTo(map);window.VMAP_SINGLE_RESOLVER_LAST={status:'MATCH',version:5,route:m.route.name||m.route.id,confidence:m.confidence,videoTime:m.videoTime,metrics:m.metrics,diagnostics:r.diagnostics};console.log('🧭 Resolver v5 MATCH',window.VMAP_SINGLE_RESOLVER_LAST);return true;}

  function bindRuntime(map,directions){if(!map||!directions||boundDirections===directions)return;boundDirections=directions;try{directions.on('route',captureRouteEvent);directions.on('clear',clearRoute);}catch(e){console.warn('🧭 Resolver v5 bind directions failed',e);}console.log('🧭 Resolver v5 bound directly to V-Map runtime');}
  window.VMAP_ROUTE_VIDEO_RESOLVER={version:5,handleMapClick,captureRouteEvent,clearRoute,resolveAt:(lng,lat)=>loadLibrary().then(()=>resolve({lng:Number(lng),lat:Number(lat)})),getLast:()=>window.VMAP_SINGLE_RESOLVER_LAST||null,getRoute:()=>window.VMAP_SINGLE_RESOLVER_ROUTE||null,config:CFG};
  window.addEventListener('vmap:runtime-ready',e=>bindRuntime(e.detail?.map,e.detail?.directions));
  if(window.vMapMap&&window.vMapDirections)bindRuntime(window.vMapMap,window.vMapDirections);
  loadLibrary();
  console.log('🧭 V-MapVideo Single Resolver v5 active — direct runtime bridge + offset-corrected shape matching + branch fail-closed.');
})();