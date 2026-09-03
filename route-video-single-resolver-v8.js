// V-MapVideo Single Resolver v8
// Local-segment authority: a video is valid for the segment under the click.
// It does NOT reject a valid current segment only because the video diverges farther ahead.
// Wrong branches are rejected by local corridor + local direction/heading around the click.
(function(){
  'use strict';
  if(window.__vMapSingleResolverV8Installed)return;
  window.__vMapSingleResolverV8Installed=true;

  const CFG={
    clickRouteMeters:80,
    anchorSearchMeters:110,
    videoBehindMeters:55,
    videoAheadMeters:75,
    routeWindowMeters:150,
    strongClickMeters:32,
    strongMedianMeters:26,
    strongP80Meters:44,
    correctedMedianMeters:30,
    correctedP80Meters:52,
    localFitMeters:42,
    minLocalFitRatio:0.58,
    minForwardRatio:0.55,
    maxHeadingError:72,
    minSamples:5,
    minConfidence:0.57,
    maxAnchorsPerRoute:10
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

  async function loadLibrary(){if(libraryPromise)return libraryPromise;libraryPromise=fetch('route-videos.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('route-videos.json HTTP '+r.status);return r.json();}).then(data=>{const routes=Array.isArray(data)?data:(Array.isArray(data?.routes)?data.routes:[]);library=routes.filter(r=>r&&r.enabled!==false&&Array.isArray(r.points)&&r.points.length>=2&&youtubeId(r.youtube||r.videoId||r.video));console.log('🧭 Resolver v8 library',library.length,library.map(r=>r.name||r.id));return library;}).catch(err=>{library=[];console.warn('🧭 Resolver v8 library load failed',err);return library;});return libraryPromise;}

  function captureRouteEvent(e){const g=(e?.route?.[0]||e?.route||e?.routes?.[0])?.geometry,c=g?.type==='LineString'&&Array.isArray(g.coordinates)?g.coordinates:null;if(!c||c.length<2)return false;activeRoute=c;activeCum=cumulative(c);window.VMAP_SINGLE_RESOLVER_ROUTE={version:8,coords:c,lengthMeters:activeCum.at(-1)||0};console.log('🧭 Resolver v8 captured route',Math.round(activeCum.at(-1)||0),'m');return true;}
  function clearRoute(){activeRoute=[];activeCum=[];window.VMAP_SINGLE_RESOLVER_ROUTE=null;if(popup){try{popup.remove();}catch(_){}popup=null;}}

  function anchors(route,click){const pts=route.points||[],out=[];for(let i=0;i<pts.length-1;i++){const a=coord(pts[i]),b=coord(pts[i+1]);if(!a||!b)continue;const pr=projectSeg(click,a,b);if(pr.distance<=CFG.anchorSearchMeters)out.push({i,t:pr.t,rawDistance:pr.distance,videoCoord:pr.coord});}out.sort((a,b)=>a.rawDistance-b.rawDistance);return out.slice(0,CFG.maxAnchorsPerRoute);}
  function localWindow(route,idx){const pts=route.points||[];let first=idx,last=Math.min(pts.length-1,idx+1),d=0,prev=coord(pts[first]);for(let i=first-1;i>=0&&prev;i--){const c=coord(pts[i]);if(!c)continue;d+=hav(c,prev);prev=c;first=i;if(d>=CFG.videoBehindMeters)break;}d=0;prev=coord(pts[last]);for(let i=last+1;i<pts.length&&prev;i++){const c=coord(pts[i]);if(!c)continue;d+=hav(prev,c);prev=c;last=i;if(d>=CFG.videoAheadMeters)break;}const arr=[];for(let i=first;i<=last;i++){const c=coord(pts[i]);if(c)arr.push({index:i,coord:c,point:pts[i]});}return arr;}
  function localVideoHeading(route,idx){const pts=route.points||[],origin=coord(pts[idx]);if(!origin)return null;let before=null,after=null;for(let i=idx-1;i>=0;i--){const c=coord(pts[i]);if(c&&hav(c,origin)>=8){before=c;break;}}for(let i=idx+1;i<pts.length;i++){const c=coord(pts[i]);if(c&&hav(origin,c)>=8){after=c;break;}}if(before&&after)return bearing(before,after);if(after)return bearing(origin,after);if(before)return bearing(before,origin);return null;}
  function localRouteHeading(cp){if(!cp||cp.segmentIndex<0)return null;const i=cp.segmentIndex;const before=activeRoute[Math.max(0,i-1)]||activeRoute[i],after=activeRoute[Math.min(activeRoute.length-1,i+2)]||activeRoute[i+1];return before&&after?bearing(before,after):null;}

  function evaluate(route,id,anchor,clickRoute){
    const samples=localWindow(route,anchor.i);if(samples.length<CFG.minSamples)return{ok:false,reason:'too_few_samples',route,id,confidence:0};
    const minM=Math.max(0,clickRoute.routeMeters-CFG.routeWindowMeters),maxM=clickRoute.routeMeters+CFG.routeWindowMeters;
    const rawProj=[];for(const s of samples){const pr=projectRoute(s.coord,minM,maxM);if(pr)rawProj.push({...s,pr});}
    if(rawProj.length<CFG.minSamples)return{ok:false,reason:'too_few_projected',route,id,confidence:0};

    const rawDist=rawProj.map(x=>x.pr.distance),rawMed=median(rawDist),rawP80=p80(rawDist),rawFit=rawProj.filter(x=>x.pr.distance<=CFG.localFitMeters).length/rawProj.length;
    let fwd=0,back=0;for(let i=1;i<rawProj.length;i++){const dr=rawProj[i].pr.routeMeters-rawProj[i-1].pr.routeMeters;if(dr>1)fwd++;else if(dr<-8)back++;}
    const forwardRatio=(fwd+back)?fwd/(fwd+back):0;
    const vh=localVideoHeading(route,anchor.i),rh=localRouteHeading(clickRoute),headingError=(Number.isFinite(vh)&&Number.isFinite(rh))?angleDiff(vh,rh):0;

    const off=delta(anchor.videoCoord,clickRoute.coord),corrProj=[];for(const s of samples){const corrected=shift(s.coord,off),pr=projectRoute(corrected,minM,maxM);if(pr)corrProj.push({...s,pr});}
    const corrDist=corrProj.map(x=>x.pr.distance),corrMed=median(corrDist),corrP80=p80(corrDist),corrFit=corrProj.length?corrProj.filter(x=>x.pr.distance<=CFG.localFitMeters).length/corrProj.length:0;

    // Current-segment eligibility. We deliberately do not require the trace to follow the route
    // hundreds of metres ahead: that previously rejected valid video just before a junction.
    const rawTrusted=anchor.rawDistance<=CFG.strongClickMeters&&rawMed<=CFG.strongMedianMeters&&rawP80<=CFG.strongP80Meters&&rawFit>=CFG.minLocalFitRatio&&forwardRatio>=CFG.minForwardRatio&&headingError<=CFG.maxHeadingError;
    const correctedTrusted=corrMed<=CFG.correctedMedianMeters&&corrP80<=CFG.correctedP80Meters&&corrFit>=CFG.minLocalFitRatio&&forwardRatio>=CFG.minForwardRatio&&headingError<=CFG.maxHeadingError;

    const distanceScore=clamp(1-Math.min(corrMed,rawMed)/60),fitScore=Math.max(rawFit,corrFit),dirScore=clamp(forwardRatio),headScore=clamp(1-headingError/100),clickScore=clamp(1-anchor.rawDistance/95);
    const confidence=.27*distanceScore+.25*fitScore+.22*dirScore+.16*headScore+.10*clickScore;
    let reason=null;if(!rawTrusted&&!correctedTrusted){if(forwardRatio<CFG.minForwardRatio)reason='wrong_direction';else if(headingError>CFG.maxHeadingError)reason='local_heading_mismatch';else if(Math.max(rawFit,corrFit)<CFG.minLocalFitRatio)reason='local_corridor_fit_low';else reason='local_shape_not_confident';}else if(!rawTrusted&&confidence<CFG.minConfidence)reason='confidence_low';
    const pA=route.points[anchor.i],pB=route.points[anchor.i+1],t=rawTime(pA)+(rawTime(pB)-rawTime(pA))*anchor.t;
    return{ok:!reason,reason,route,id,videoTime:t,confidence:rawTrusted?Math.max(.88,confidence):confidence,metrics:{rawClickDistance:anchor.rawDistance,rawMedian:rawMed,rawP80,rawFitRatio:rawFit,correctedMedian:corrMed,correctedP80:corrP80,correctedFitRatio:corrFit,forwardRatio,headingError,rawTrusted,correctedTrusted}};
  }

  function resolve(click){if(activeRoute.length<2||!library.length)return{match:null,diagnostics:{version:8,reason:'route_or_library_missing',activeRoutePoints:activeRoute.length,libraryCount:library.length}};const c=[+click.lng,+click.lat],cp=projectRoute(c);if(!cp||cp.distance>CFG.clickRouteMeters)return{match:null,diagnostics:{version:8,reason:'click_not_on_active_route',routeDistance:cp?.distance,activeRoutePoints:activeRoute.length,libraryCount:library.length}};const accepted=[],rejected=[];for(const route of library){const id=youtubeId(route.youtube||route.videoId||route.video);if(!id)continue;const aa=anchors(route,c);if(!aa.length){rejected.push({ok:false,route,id,reason:'no_anchor_near_click',confidence:0,metrics:{}});continue;}for(const a of aa){const r=evaluate(route,id,a,cp);(r.ok?accepted:rejected).push(r);}}accepted.sort((a,b)=>(Number(b.route.priority)||0)-(Number(a.route.priority)||0)||b.confidence-a.confidence||a.metrics.rawClickDistance-b.metrics.rawClickDistance);rejected.sort((a,b)=>(b.confidence||0)-(a.confidence||0));return{match:accepted[0]||null,diagnostics:{version:8,clickRouteDistance:cp.distance,activeRoutePoints:activeRoute.length,libraryCount:library.length,acceptedCount:accepted.length,rejectedCount:rejected.length,topRejected:rejected.slice(0,6).map(x=>({route:x.route?.name||x.route?.id,reason:x.reason,confidence:+(x.confidence||0).toFixed(3),metrics:x.metrics}))}};}

  function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function removePopup(){if(popup){try{popup.remove();}catch(_){}popup=null;}}
  function showNoVideo(map,ll,d){removePopup();const top=d?.topRejected?.[0],reason=top?.reason||d?.reason||'no_candidate',route=top?.route||'resolver-v8',conf=top?` • ${Math.round((top.confidence||0)*100)}%`:'';const details=`routePts ${d?.activeRoutePoints??0} • library ${d?.libraryCount??0}`;popup=new mapboxgl.Popup({maxWidth:'410px',closeButton:true,closeOnClick:false}).setLngLat(ll).setHTML(`<div class="route-video-popup"><div class="route-video-title">🎬 Đoạn này chưa có video</div><div class="route-video-meta">Không có GPS-video khớp đoạn hiện tại và đúng chiều.</div><div style="margin-top:6px;font-size:11px;color:#666">debug v8: ${esc(route)} • ${esc(reason)}${conf}<br>${esc(details)}</div></div>`).addTo(map);window.VMAP_SINGLE_RESOLVER_LAST={status:'NO_VIDEO',version:8,diagnostics:d};console.log('🧭 Resolver v8 NO_VIDEO',d);}
  async function handleMapClick(e){const map=e?.target||window.vMapMap;if(!map||!e?.lngLat)return false;await loadLibrary();const r=resolve(e.lngLat);if(!r.match){showNoVideo(map,e.lngLat,r.diagnostics);return true;}const m=r.match,start=Math.max(0,Math.floor(m.videoTime)),name=esc(m.route.name||m.route.id||'Video hướng dẫn'),embed=`https://www.youtube.com/embed/${encodeURIComponent(m.id)}?start=${start}&autoplay=1&playsinline=1&rel=0`,watch=`https://www.youtube.com/watch?v=${encodeURIComponent(m.id)}&t=${start}s`;removePopup();popup=new mapboxgl.Popup({maxWidth:'410px',closeButton:true,closeOnClick:false}).setLngLat(e.lngLat).setHTML(`<div class="route-video-popup"><div class="route-video-title">🎬 Xem đúng đoạn tuyến</div><div class="route-video-meta">${name}<br>tin cậy ${Math.round(m.confidence*100)}% • lệch GPS ~${Math.round(m.metrics.rawClickDistance)} m</div><iframe src="${embed}" title="${name}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe><a class="route-video-youtube-link" href="${watch}" target="_blank" rel="noopener noreferrer">Mở đúng đoạn này trên YouTube ↗</a></div>`).addTo(map);window.VMAP_SINGLE_RESOLVER_LAST={status:'MATCH',version:8,route:m.route.name||m.route.id,confidence:m.confidence,videoTime:m.videoTime,metrics:m.metrics,diagnostics:r.diagnostics};console.log('🧭 Resolver v8 MATCH',window.VMAP_SINGLE_RESOLVER_LAST);return true;}

  function bindRuntime(map,directions){if(!map||!directions||boundDirections===directions)return;boundDirections=directions;try{directions.on('route',captureRouteEvent);directions.on('clear',clearRoute);}catch(e){console.warn('🧭 Resolver v8 bind failed',e);}console.log('🧭 Resolver v8 bound to runtime');}
  window.VMAP_ROUTE_VIDEO_RESOLVER={version:8,handleMapClick,captureRouteEvent,clearRoute,resolveAt:(lng,lat)=>loadLibrary().then(()=>resolve({lng:+lng,lat:+lat})),getLast:()=>window.VMAP_SINGLE_RESOLVER_LAST||null,getRoute:()=>window.VMAP_SINGLE_RESOLVER_ROUTE||null,config:CFG};
  window.addEventListener('vmap:runtime-ready',e=>bindRuntime(e.detail?.map,e.detail?.directions));if(window.vMapMap&&window.vMapDirections)bindRuntime(window.vMapMap,window.vMapDirections);loadLibrary();console.log('🧭 V-MapVideo Single Resolver v8 active — local segment matching + single authority.');
})();
