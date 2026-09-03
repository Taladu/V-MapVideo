// V-MapVideo Single Resolver v7
// Goal: accept real recorded video on the active route even when strict shape scoring is brittle,
// while still rejecting wrong branches and opposite direction. One resolver, fail closed.
(function(){
  'use strict';
  if(window.__vMapSingleResolverV7Installed)return;
  window.__vMapSingleResolverV7Installed=true;

  const CFG={
    clickRouteMeters:70,
    anchorSearchMeters:140,
    localBehindMeters:90,
    localAheadMeters:170,
    routeWindowMeters:260,
    rawStrongMedian:22,
    rawStrongP80:38,
    correctedMedian:32,
    correctedP80:58,
    minForwardRatio:0.58,
    minAheadSamples:4,
    minAheadFitRatio:0.55,
    aheadFitMeters:48,
    minConfidence:0.58,
    maxHeadingError:82,
    maxAnchorsPerRoute:8
  };

  let activeRoute=[],activeCum=[],library=[],libraryPromise=null,popup=null,boundDirections=null;
  const rad=d=>d*Math.PI/180,deg=r=>r*180/Math.PI,clamp=x=>Math.max(0,Math.min(1,x));
  function hav(a,b){const R=6371000,dLat=rad(b[1]-a[1]),dLng=rad(b[0]-a[0]),la=rad(a[1]),lb=rad(b[1]);const h=Math.sin(dLat/2)**2+Math.cos(la)*Math.cos(lb)*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
  function frame(lat){return{kx:111320*Math.cos(rad(lat)),ky:110540};}
  function coord(p){const c=Array.isArray(p?.coords)?[+p.coords[0],+p.coords[1]]:[+p?.lng,+p?.lat];return Number.isFinite(c[0])&&Number.isFinite(c[1])?c:null;}
  function cumulative(c){const out=[0];for(let i=1;i<c.length;i++)out[i]=out[i-1]+hav(c[i-1],c[i]);return out;}
  function projectSeg(p,a,b){const f=frame((p[1]+a[1]+b[1])/3),px=p[0]*f.kx,py=p[1]*f.ky,ax=a[0]*f.kx,ay=a[1]*f.ky,bx=b[0]*f.kx,by=b[1]*f.ky,dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy,t=l2?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l2)):0,qx=ax+t*dx,qy=ay+t*dy;return{t,distance:Math.hypot(px-qx,py-qy),coord:[qx/f.kx,qy/f.ky]};}
  function projectRoute(p,minM=-Infinity,maxM=Infinity){if(activeRoute.length<2)return null;let best=null;for(let i=0;i<activeRoute.length-1;i++){const s=activeCum[i],e=activeCum[i+1];if(e<minM||s>maxM)continue;const pr=projectSeg(p,activeRoute[i],activeRoute[i+1]);if(!best||pr.distance<best.distance)best={distance:pr.distance,routeMeters:s+(e-s)*pr.t,segmentIndex:i,t:pr.t,coord:pr.coord};}return best;}
  function bearing(a,b){const a1=rad(a[1]),a2=rad(b[1]),dl=rad(b[0]-a[0]),y=Math.sin(dl)*Math.cos(a2),x=Math.cos(a1)*Math.sin(a2)-Math.sin(a1)*Math.cos(a2)*Math.cos(dl);return(deg(Math.atan2(y,x))+360)%360;}
  function angleDiff(a,b){let d=Math.abs(a-b)%360;return d>180?360-d:d;}
  function median(v){const a=v.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!a.length)return Infinity;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
  function p80(v){const a=v.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!a.length)return Infinity;return a[Math.floor((a.length-1)*.8)];}
  function delta(from,to){const f=frame((from[1]+to[1])/2);return{dx:(to[0]-from[0])*f.kx,dy:(to[1]-from[1])*f.ky};}
  function shift(c,d){const f=frame(c[1]);return[c[0]+d.dx/f.kx,c[1]+d.dy/f.ky];}
  function youtubeId(v){if(!v)return null;let s=String(v).trim();if(/^[A-Za-z0-9_-]{11}$/.test(s))return s;try{const u=new URL(s,location.href);if(u.hostname.includes('youtu.be'))s=u.pathname.split('/').filter(Boolean)[0]||'';else if(u.pathname.startsWith('/embed/')||u.pathname.startsWith('/shorts/'))s=u.pathname.split('/')[2]||'';else s=u.searchParams.get('v')||s;}catch(_){}return/^[A-Za-z0-9_-]{11}$/.test(s)?s:null;}
  function rawTime(p){const v=Number(p?.tVideo??p?.videoTime??p?.tRaw??p?.rawTime??p?.t??p?.time??0);return Number.isFinite(v)?Math.max(0,v):0;}

  async function loadLibrary(){if(libraryPromise)return libraryPromise;libraryPromise=fetch('route-videos.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('route-videos.json HTTP '+r.status);return r.json();}).then(data=>{const routes=Array.isArray(data)?data:(Array.isArray(data?.routes)?data.routes:[]);library=routes.filter(r=>r&&r.enabled!==false&&Array.isArray(r.points)&&r.points.length>=2);console.log('🧭 Resolver v7 library',library.length,library.map(r=>r.name||r.id));return library;}).catch(err=>{library=[];console.warn('🧭 Resolver v7 library load failed',err);return library;});return libraryPromise;}

  function captureRouteEvent(e){const g=(e?.route?.[0]||e?.route||e?.routes?.[0])?.geometry,c=g?.type==='LineString'&&Array.isArray(g.coordinates)?g.coordinates:null;if(!c||c.length<2)return false;activeRoute=c;activeCum=cumulative(c);window.VMAP_SINGLE_RESOLVER_ROUTE={version:7,coords:c,lengthMeters:activeCum.at(-1)||0};console.log('🧭 Resolver v7 captured route',Math.round(activeCum.at(-1)||0),'m');return true;}
  function clearRoute(){activeRoute=[];activeCum=[];window.VMAP_SINGLE_RESOLVER_ROUTE=null;if(popup){try{popup.remove();}catch(_){}popup=null;}}

  function anchors(route,click){const pts=route.points||[],out=[];for(let i=0;i<pts.length-1;i++){const a=coord(pts[i]),b=coord(pts[i+1]);if(!a||!b)continue;const pr=projectSeg(click,a,b);if(pr.distance<=CFG.anchorSearchMeters)out.push({i,t:pr.t,rawDistance:pr.distance,videoCoord:pr.coord});}out.sort((a,b)=>a.rawDistance-b.rawDistance);return out.slice(0,CFG.maxAnchorsPerRoute);}
  function localWindow(route,idx){const pts=route.points||[];let first=idx,last=Math.min(pts.length-1,idx+1),d=0,prev=coord(pts[first]);for(let i=first-1;i>=0&&prev;i--){const c=coord(pts[i]);if(!c)continue;d+=hav(c,prev);prev=c;first=i;if(d>=CFG.localBehindMeters)break;}d=0;prev=coord(pts[last]);for(let i=last+1;i<pts.length&&prev;i++){const c=coord(pts[i]);if(!c)continue;d+=hav(prev,c);prev=c;last=i;if(d>=CFG.localAheadMeters)break;}const arr=[];for(let i=first;i<=last;i++){const c=coord(pts[i]);if(c)arr.push({index:i,coord:c,point:pts[i]});}return arr;}

  function evaluate(route,id,anchor,clickRoute){
    const samples=localWindow(route,anchor.i);if(samples.length<5)return{ok:false,reason:'too_few_samples',route,id,confidence:0};
    const minM=Math.max(0,clickRoute.routeMeters-CFG.routeWindowMeters),maxM=clickRoute.routeMeters+CFG.routeWindowMeters;
    const rawProj=[];for(const s of samples){const pr=projectRoute(s.coord,minM,maxM);if(pr)rawProj.push({...s,pr});}
    if(rawProj.length<5)return{ok:false,reason:'too_few_projected',route,id,confidence:0};

    const rawDist=rawProj.map(x=>x.pr.distance),rawMed=median(rawDist),rawP80=p80(rawDist);
    let anchorPos=0,best=Infinity;for(let i=0;i<rawProj.length;i++){const e=Math.abs(rawProj[i].index-anchor.i);if(e<best){best=e;anchorPos=i;}}
    let fwd=0,back=0;for(let i=1;i<rawProj.length;i++){const dr=rawProj[i].pr.routeMeters-rawProj[i-1].pr.routeMeters;if(dr>1)fwd++;else if(dr<-8)back++;}
    const forwardRatio=(fwd+back)?fwd/(fwd+back):0;

    const off=delta(anchor.videoCoord,clickRoute.coord),corrProj=[];for(const s of samples){const corrected=shift(s.coord,off),pr=projectRoute(corrected,minM,maxM);if(pr)corrProj.push({...s,corrected,pr});}
    const corrDist=corrProj.map(x=>x.pr.distance),corrMed=median(corrDist),corrP80=p80(corrDist);

    let aheadTotal=0,aheadGood=0,aheadProgress=0;const baseIndex=anchor.i;for(const s of corrProj){if(s.index<=baseIndex)continue;aheadTotal++;const prog=s.pr.routeMeters-clickRoute.routeMeters;aheadProgress=Math.max(aheadProgress,prog);if(s.pr.distance<=CFG.aheadFitMeters&&prog>=-8)aheadGood++;if(aheadTotal>=35)break;}
    const aheadFit=aheadTotal?aheadGood/aheadTotal:1;

    let videoHead=null;for(let j=anchor.i+1;j<route.points.length;j++){const a=coord(route.points[anchor.i]),b=coord(route.points[j]);if(a&&b&&hav(a,b)>=10){videoHead=bearing(a,b);break;}}
    let routeHead=null;if(clickRoute.segmentIndex>=0&&clickRoute.segmentIndex<activeRoute.length-1)routeHead=bearing(activeRoute[clickRoute.segmentIndex],activeRoute[clickRoute.segmentIndex+1]);
    const headingError=(Number.isFinite(videoHead)&&Number.isFinite(routeHead))?angleDiff(videoHead,routeHead):0;

    // Fast path: GPS trace is already physically on the active route. This is the trusted case
    // that earlier versions incorrectly rejected with global shape scoring.
    const rawStrong=rawMed<=CFG.rawStrongMedian&&rawP80<=CFG.rawStrongP80&&forwardRatio>=CFG.minForwardRatio&&aheadTotal>=CFG.minAheadSamples&&aheadFit>=CFG.minAheadFitRatio&&headingError<=CFG.maxHeadingError;

    const correctedGood=corrMed<=CFG.correctedMedian&&corrP80<=CFG.correctedP80&&forwardRatio>=CFG.minForwardRatio&&aheadTotal>=CFG.minAheadSamples&&aheadFit>=CFG.minAheadFitRatio&&headingError<=CFG.maxHeadingError;
    const distanceScore=clamp(1-corrMed/60),aheadScore=clamp(aheadFit),dirScore=clamp(forwardRatio),headScore=clamp(1-headingError/100),rawScore=clamp(1-rawMed/70);
    const confidence=.28*distanceScore+.24*aheadScore+.20*dirScore+.16*headScore+.12*rawScore;
    let reason=null;if(!rawStrong&&!correctedGood){if(forwardRatio<CFG.minForwardRatio)reason='wrong_direction';else if(headingError>CFG.maxHeadingError)reason='heading_mismatch';else if(aheadTotal<CFG.minAheadSamples)reason='insufficient_ahead_samples';else if(aheadFit<CFG.minAheadFitRatio)reason='branch_diverged';else reason='shape_not_confident';}else if(!rawStrong&&confidence<CFG.minConfidence)reason='confidence_low';

    const pA=route.points[anchor.i],pB=route.points[anchor.i+1],t=rawTime(pA)+(rawTime(pB)-rawTime(pA))*anchor.t;
    return{ok:!reason,reason,route,id,videoTime:t,confidence:rawStrong?Math.max(.86,confidence):confidence,metrics:{rawClickDistance:anchor.rawDistance,rawMedian:rawMed,rawP80,correctedMedian:corrMed,correctedP80:corrP80,forwardRatio,aheadFit,aheadProgress,headingError,rawStrong,correctedGood}};
  }

  function resolve(click){if(activeRoute.length<2||!library.length)return{match:null,diagnostics:{reason:'route_or_library_missing',activeRoutePoints:activeRoute.length,libraryCount:library.length}};const c=[+click.lng,+click.lat],cp=projectRoute(c);if(!cp||cp.distance>CFG.clickRouteMeters)return{match:null,diagnostics:{reason:'click_not_on_active_route',routeDistance:cp?.distance}};const accepted=[],rejected=[];for(const route of library){const id=youtubeId(route.youtube||route.videoId||route.video);if(!id)continue;for(const a of anchors(route,c)){const r=evaluate(route,id,a,cp);(r.ok?accepted:rejected).push(r);}}accepted.sort((a,b)=>(Number(b.route.priority)||0)-(Number(a.route.priority)||0)||b.confidence-a.confidence||a.metrics.rawClickDistance-b.metrics.rawClickDistance);rejected.sort((a,b)=>(b.confidence||0)-(a.confidence||0));return{match:accepted[0]||null,diagnostics:{version:7,clickRouteDistance:cp.distance,acceptedCount:accepted.length,rejectedCount:rejected.length,topRejected:rejected.slice(0,5).map(x=>({route:x.route?.name||x.route?.id,reason:x.reason,confidence:+(x.confidence||0).toFixed(3),metrics:x.metrics}))}};}

  function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function removePopup(){if(popup){try{popup.remove();}catch(_){}popup=null;}}
  function showNoVideo(map,ll,d){removePopup();const top=d?.topRejected?.[0];const debug=top?`<div style="margin-top:6px;font-size:11px;color:#666">debug: ${esc(top.route||'candidate')} • ${esc(top.reason||'rejected')} • ${Math.round((top.confidence||0)*100)}%</div>`:'';popup=new mapboxgl.Popup({maxWidth:'390px',closeButton:true,closeOnClick:false}).setLngLat(ll).setHTML(`<div class="route-video-popup"><div class="route-video-title">🎬 Đoạn này chưa có video</div><div class="route-video-meta">Không có GPS-video đủ tin cậy trên đúng nhánh và đúng chiều.</div>${debug}</div>`).addTo(map);window.VMAP_SINGLE_RESOLVER_LAST={status:'NO_VIDEO',version:7,diagnostics:d};console.log('🧭 Resolver v7 NO_VIDEO',d);}
  async function handleMapClick(e){const map=e?.target||window.vMapMap;if(!map||!e?.lngLat)return false;await loadLibrary();const r=resolve(e.lngLat);if(!r.match){showNoVideo(map,e.lngLat,r.diagnostics);return true;}const m=r.match,start=Math.max(0,Math.floor(m.videoTime)),name=esc(m.route.name||m.route.id||'Video hướng dẫn'),embed=`https://www.youtube.com/embed/${encodeURIComponent(m.id)}?start=${start}&autoplay=1&playsinline=1&rel=0`,watch=`https://www.youtube.com/watch?v=${encodeURIComponent(m.id)}&t=${start}s`;removePopup();popup=new mapboxgl.Popup({maxWidth:'390px',closeButton:true,closeOnClick:false}).setLngLat(e.lngLat).setHTML(`<div class="route-video-popup"><div class="route-video-title">🎬 Xem đúng đoạn tuyến</div><div class="route-video-meta">${name}<br>tin cậy ${Math.round(m.confidence*100)}% • lệch GPS ~${Math.round(m.metrics.rawClickDistance)} m</div><iframe src="${embed}" title="${name}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe><a class="route-video-youtube-link" href="${watch}" target="_blank" rel="noopener noreferrer">Mở đúng đoạn này trên YouTube ↗</a></div>`).addTo(map);window.VMAP_SINGLE_RESOLVER_LAST={status:'MATCH',version:7,route:m.route.name||m.route.id,confidence:m.confidence,videoTime:m.videoTime,metrics:m.metrics,diagnostics:r.diagnostics};console.log('🧭 Resolver v7 MATCH',window.VMAP_SINGLE_RESOLVER_LAST);return true;}

  function bindRuntime(map,directions){if(!map||!directions||boundDirections===directions)return;boundDirections=directions;try{directions.on('route',captureRouteEvent);directions.on('clear',clearRoute);}catch(e){console.warn('🧭 Resolver v7 bind failed',e);}console.log('🧭 Resolver v7 bound to runtime');}
  window.VMAP_ROUTE_VIDEO_RESOLVER={version:7,handleMapClick,captureRouteEvent,clearRoute,resolveAt:(lng,lat)=>loadLibrary().then(()=>resolve({lng:+lng,lat:+lat})),getLast:()=>window.VMAP_SINGLE_RESOLVER_LAST||null,getRoute:()=>window.VMAP_SINGLE_RESOLVER_ROUTE||null,config:CFG};
  window.addEventListener('vmap:runtime-ready',e=>bindRuntime(e.detail?.map,e.detail?.directions));if(window.vMapMap&&window.vMapDirections)bindRuntime(window.vMapMap,window.vMapDirections);loadLibrary();console.log('🧭 V-MapVideo Single Resolver v7 active — trusted near-corridor fast path + branch validation.');
})();
