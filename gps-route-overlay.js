// V-MAPVIDEO CLEAN 1.3.2 — V28 SAFE DUAL GEOMETRY, V19 resolver semantics preserved
(function () {
  'use strict';

  const SOURCE_ID='vmap-gps-video-routes', LINE_ID='vmap-gps-video-line', HIT_ID='vmap-gps-video-hit';
  const MAX_WAIT_MS=12000, ROUTE_MATCH_METERS=120, CLICK_MATCH_METERS=180, MAX_DIRECTION_DIFF_DEG=70;
  let routes=[], fullRouteCoords=[], activePopup=null,lastDiagnostics=null;
  let routeBuildSeq=0,lastRouteEvent=null,fullRouteRevision=0;

  const coordsOf=p=>{const c=Array.isArray(p?.coords)?[+p.coords[0],+p.coords[1]]:[+p?.lng,+p?.lat];return Number.isFinite(c[0])&&Number.isFinite(c[1])?c:null};
  const rawTime=p=>Math.max(0,Number(p?.tRaw??p?.rawTime??p?.sourceTime??p?.t??p?.time??0)||0);
  const rawTimeValue=p=>{const v=p?.tRaw??p?.rawTime??p?.sourceTime??p?.t??p?.time;const n=Number(v);return v==null||v===''||!Number.isFinite(n)?null:n};
  function edits(e){return Array.isArray(e)?e.map(x=>{const start=+(x.start??x.from??x.startRaw),end=+(x.end??x.to??x.endRaw),keepSeconds=+(x.keepSeconds??x.keep??0);return Number.isFinite(start)&&Number.isFinite(end)&&Number.isFinite(keepSeconds)&&start>=0&&end>start&&keepSeconds>=0&&keepSeconds<=end-start?{start,end,keepSeconds}:null}).filter(Boolean).sort((a,b)=>a.start-b.start):[]}
  function rawToVideoTime(t,e){t=Math.max(0,+t||0);let removed=0;for(const x of edits(e)){const dur=x.end-x.start,cut=dur-x.keepSeconds;if(t>=x.end){removed+=cut;continue}if(t>x.start&&t<x.end)return Math.max(0,x.start-removed+(t-x.start)/dur*x.keepSeconds);if(t<=x.start)break}return Math.max(0,t-removed)}
  function hav(a,b){const R=6371000,r=d=>d*Math.PI/180,dLat=r(b[1]-a[1]),dLng=r(b[0]-a[0]),la=r(a[1]),lb=r(b[1]);const h=Math.sin(dLat/2)**2+Math.cos(la)*Math.cos(lb)*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
  function segDist(p,a,b){const lat0=(p[1]+a[1]+b[1])/3*Math.PI/180,kx=111320*Math.cos(lat0),ky=110540,px=p[0]*kx,py=p[1]*ky,ax=a[0]*kx,ay=a[1]*ky,bx=b[0]*kx,by=b[1]*ky,dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy;if(!l)return Math.hypot(px-ax,py-ay);const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l));return Math.hypot(px-(ax+t*dx),py-(ay+t*dy))}
  function routeDist(p,c){let best=Infinity;for(let i=1;i<c.length;i++){best=Math.min(best,segDist(p,c[i-1],c[i]));if(best<=ROUTE_MATCH_METERS)break}return best}
  function bearing(a,b){const r=d=>d*Math.PI/180,d=d=>d*180/Math.PI,y=Math.sin(r(b[0]-a[0]))*Math.cos(r(b[1])),x=Math.cos(r(a[1]))*Math.sin(r(b[1]))-Math.sin(r(a[1]))*Math.cos(r(b[1]))*Math.cos(r(b[0]-a[0]));return(d(Math.atan2(y,x))+360)%360}
  function angleDiff(a,b){let d=Math.abs(a-b)%360;return d>180?360-d:d}
  function nearestIndex(coords,p){let bi=-1,bd=Infinity;coords.forEach((c,i)=>{if(!c)return;const d=hav(c,p);if(d<bd){bd=d;bi=i}});return bi}
  function localBearing(coords,index){if(index<0||coords.length<2)return null;let a=Math.max(0,index-2),b=Math.min(coords.length-1,index+2);while(a<index&&(!coords[a]||hav(coords[a],coords[index])<2))a++;while(b>index&&(!coords[b]||hav(coords[index],coords[b])<2))b--;const p1=coords[a],p2=coords[b];return p1&&p2&&hav(p1,p2)>=2?bearing(p1,p2):null}
  function validRouteGeometry(coords){return Array.isArray(coords)&&coords.length>1}
  function deriveLocalWindowFromFullRoute(routeCoords,click){
    if(!validRouteGeometry(routeCoords))return[];
    const index=nearestIndex(routeCoords,click);
    if(index<0)return[];
    const start=Math.max(0,index-8),end=Math.min(routeCoords.length,index+9);
    return routeCoords.slice(start,end);
  }
  function directionScore(route,click,directionCoords){
    const video=route.points.map(coordsOf).filter(Boolean);
    if(video.length<2||!validRouteGeometry(directionCoords))return {ok:true,diff:null,videoBearing:null,routeBearing:null,videoIndex:null,routeIndex:null};
    const vi=nearestIndex(video,click),di=nearestIndex(directionCoords,click),vb=localBearing(video,vi),db=localBearing(directionCoords,di);
    if(vb==null||db==null)return {ok:true,diff:null,videoBearing:vb,routeBearing:db,videoIndex:vi,routeIndex:di};
    const diff=angleDiff(vb,db);
    return {ok:diff<=MAX_DIRECTION_DIFF_DEG,diff,videoBearing:vb,routeBearing:db,videoIndex:vi,routeIndex:di};
  }
  function getResolveContext(event){
    const click=event?.lngLat?[+event.lngLat.lng,+event.lngLat.lat]:null;
    const renderedLocal=validRouteGeometry(event?.renderedRouteCoords)?event.renderedRouteCoords:null;
    const localRouteCoords=renderedLocal||(click?deriveLocalWindowFromFullRoute(fullRouteCoords,click):[]);
    return {
      fullRouteCoords,
      localRouteCoords,
      directionGeometrySource:renderedLocal?'rendered-local':(validRouteGeometry(localRouteCoords)?'full-derived-window':'none'),
      fullRouteRevision
    };
  }
  function telemetryGap(aPoint,bPoint){
    const a=coordsOf(aPoint),b=coordsOf(bPoint);
    if(!a||!b)return{hard:true,reason:'invalid_gps',gpsGapM:null,dtS:null};
    const gpsGapM=hav(a,b),ta=rawTimeValue(aPoint),tb=rawTimeValue(bPoint),dtS=ta==null||tb==null?null:tb-ta;
    if(gpsGapM>180)return{hard:true,reason:'gps_gap',gpsGapM,dtS};
    if(dtS==null||dtS<0||dtS>30)return{hard:true,reason:dtS!=null&&dtS<0?'time_reverse':'time_gap',gpsGapM,dtS};
    return{hard:false,reason:null,gpsGapM,dtS};
  }
  function youtubeId(v){if(!v)return null;let raw=String(v).trim();if(/^[A-Za-z0-9_-]{11}$/.test(raw))return raw;try{const u=new URL(raw,location.href),h=u.hostname.toLowerCase().replace(/^www\./,'');if(h==='youtu.be')raw=u.pathname.split('/').filter(Boolean)[0]||'';else if(h==='youtube.com'||h==='m.youtube.com'){if(u.pathname==='/watch')raw=u.searchParams.get('v')||'';else if(/^\/(embed|shorts)\//.test(u.pathname))raw=u.pathname.split('/')[2]||''}}catch(_){}return /^[A-Za-z0-9_-]{11}$/.test(raw)?raw:null}
  function fmt(s){s=Math.max(0,Math.floor(+s||0));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`:`${m}:${String(x).padStart(2,'0')}`}
  function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
  function nearestPoint(route,ll){const click=[ll.lng,ll.lat];let best=null;route.points.forEach((p,index)=>{const c=coordsOf(p);if(!c)return;const distance=hav(click,c);if(!best||distance<best.distance){const explicit=+(p?.tVideo??p?.videoTime);best={point:p,index,coords:c,distance,videoTime:Number.isFinite(explicit)&&explicit>=0?explicit:rawToVideoTime(rawTime(p),route.timelineEdits)}}});return best}
  function resolveRouteClick(ll,ctx){
    ctx=ctx||{fullRouteCoords,localRouteCoords:deriveLocalWindowFromFullRoute(fullRouteCoords,[ll.lng,ll.lat]),directionGeometrySource:'full-derived-window',fullRouteRevision};
    if(!validRouteGeometry(ctx.fullRouteCoords)){
      lastDiagnostics={event:'VMAP_VIDEO_RESOLVE',schemaVersion:'1.0',buildVersion:'v28-safe-route-event',result:'NO_VIDEO',reason:'NO_ACTIVE_ROUTE',click:{lng:+ll.lng,lat:+ll.lat},routeGeometry:{fullRoutePoints:ctx.fullRouteCoords?.length||0,localRoutePoints:ctx.localRouteCoords?.length||0,directionSource:ctx.directionGeometrySource||'none',fullRouteRevision:ctx.fullRouteRevision||0},candidateCount:0,selectedRouteId:null,selectedPointIndex:null,selectedVideoTimeS:null,candidates:[],shadow:{fullVsLocalConflict:false}};
      return null;
    }
    const click=[ll.lng,ll.lat],candidates=[],checks=[];
    routes.forEach(r=>{
      const m=nearestPoint(r,ll);if(!m)return;
      const activeDistance=routeDist(m.coords,ctx.fullRouteCoords);
      const dir=directionScore(r,click,ctx.localRouteCoords);
      const fullDir=directionScore(r,click,ctx.fullRouteCoords);
      const rejectedBy=[];
      if(m.distance>CLICK_MATCH_METERS)rejectedBy.push('CLICK_TOO_FAR');
      if(activeDistance>ROUTE_MATCH_METERS)rejectedBy.push('GPS_OFF_FULL_ROUTE');
      if(!dir.ok)rejectedBy.push('DIRECTION_MISMATCH');
      const ok=m.distance<=CLICK_MATCH_METERS&&activeDistance<=ROUTE_MATCH_METERS&&dir.ok;
      const check={
        routeId:r.id,priority:Number(r.priority)||0,pointIndex:m.index,
        gpsDistanceM:Math.round(m.distance*10)/10,
        fullRouteDistanceM:Math.round(activeDistance*10)/10,
        directionDiffDeg:dir.diff==null?null:Math.round(dir.diff*10)/10,
        videoBearingDeg:dir.videoBearing==null?null:Math.round(dir.videoBearing*10)/10,
        routeBearingDeg:dir.routeBearing==null?null:Math.round(dir.routeBearing*10)/10,
        fullDirectionDiffDeg:fullDir.diff==null?null:Math.round(fullDir.diff*10)/10,
        acceptedByV19Rule:ok,rejectedBy
      };
      checks.push(check);
      if(ok)candidates.push({r,m,dir,priority:Number(r.priority)||0,check});
    });
    candidates.sort((a,b)=>(a.dir.diff??999)-(b.dir.diff??999)||a.m.distance-b.m.distance||b.priority-a.priority);
    const selected=candidates[0]||null;
    let reason=null;
    if(!selected){
      const allReasons=checks.flatMap(x=>x.rejectedBy);
      reason=allReasons.includes('DIRECTION_MISMATCH')?'DIRECTION_MISMATCH':allReasons.includes('GPS_OFF_FULL_ROUTE')?'GPS_OFF_FULL_ROUTE':allReasons.includes('CLICK_TOO_FAR')?'CLICK_TOO_FAR':'NO_GPS_CANDIDATE';
    }
    lastDiagnostics={
      event:'VMAP_VIDEO_RESOLVE',schemaVersion:'1.0',buildVersion:'v28-safe-route-event',
      result:selected?'PLAY':'NO_VIDEO',reason,
      click:{lng:+ll.lng,lat:+ll.lat},
      routeGeometry:{fullRoutePoints:ctx.fullRouteCoords.length,localRoutePoints:ctx.localRouteCoords?.length||0,directionSource:ctx.directionGeometrySource||'none',fullRouteRevision:ctx.fullRouteRevision||0},
      candidateCount:checks.length,
      selectedRouteId:selected?.r?.id||null,
      selectedPointIndex:selected?.m?.index??null,
      selectedVideoTimeS:selected?.m?.videoTime??null,
      candidates:checks,
      shadow:{fullVsLocalConflict:checks.some(x=>x.directionDiffDeg!=null&&x.fullDirectionDiffDeg!=null&&x.directionDiffDeg<=MAX_DIRECTION_DIFF_DEG&&x.fullDirectionDiffDeg>MAX_DIRECTION_DIFF_DEG)}
    };
    return selected;
  }
  function removePopup(){if(activePopup){try{activePopup.remove()}catch(_){}activePopup=null}}
  function popup(map,route,m){const id=youtubeId(route.youtube||route.videoId||route.video);if(!id)return;removePopup();const start=Math.max(0,Math.floor(m.videoTime)),tt=fmt(start),title=esc(route.name||'Tuyến GPS-video'),dest=esc(route.destinationName||'điểm B'),embed=`https://www.youtube.com/embed/${encodeURIComponent(id)}?start=${start}&autoplay=1&playsinline=1&rel=0`,watch=`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&t=${start}s`;activePopup=new mapboxgl.Popup({maxWidth:'360px',closeButton:true,closeOnClick:false}).setLngLat(m.coords).setHTML(`<div class="route-video-popup"><div class="route-video-title">🎬 Xem từ đây → ${dest}</div><div class="route-video-meta">Tuyến video: ${title}<br>Bắt đầu tại ${tt} • lệch GPS ~${Math.round(m.distance)} m</div><iframe src="${embed}" title="${title}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe><a class="route-video-youtube-link" href="${watch}" target="_blank" rel="noopener noreferrer">Mở đúng đoạn ${tt} trên YouTube ↗</a></div>`).addTo(map)}
  function setData(map,f){const s=map.getSource(SOURCE_ID);if(s)s.setData({type:'FeatureCollection',features:f})}
  function features(routeCoords){
    const out=[];
    routes.forEach((route,routeIndex)=>{
      let run=[],n=0,prevPoint=null;
      const flush=()=>{if(run.length>=2)out.push({type:'Feature',properties:{routeIndex,segmentNo:n++,name:route.name||route.id||`Tuyến ${routeIndex+1}`},geometry:{type:'LineString',coordinates:run}});run=[]};
      route.points.forEach(point=>{
        const c=coordsOf(point);
        if(!c){flush();prevPoint=null;return}
        if(prevPoint&&telemetryGap(prevPoint,point).hard)flush();
        routeDist(c,routeCoords)<=ROUTE_MATCH_METERS?run.push(c):flush();
        prevPoint=point;
      });
      flush();
    });
    return out;
  }
  function decodePolyline(encoded,precision=5){
    if(typeof encoded!=='string'||!encoded.length)return null;
    const factor=Math.pow(10,precision);
    let index=0,lat=0,lng=0;
    const coords=[];
    try{
      while(index<encoded.length){
        let result=0,shift=0,b;
        do{b=encoded.charCodeAt(index++)-63;result|=(b&0x1f)<<shift;shift+=5}while(b>=0x20&&index<=encoded.length);
        lat+=(result&1)?~(result>>1):(result>>1);
        result=0;shift=0;
        do{b=encoded.charCodeAt(index++)-63;result|=(b&0x1f)<<shift;shift+=5}while(b>=0x20&&index<=encoded.length);
        lng+=(result&1)?~(result>>1):(result>>1);
        const point=[lng/factor,lat/factor];
        if(!Number.isFinite(point[0])||!Number.isFinite(point[1]))return null;
        coords.push(point);
      }
    }catch(_){return null}
    return coords.length>1?coords:null;
  }
  function geometryCoords(geometry){
    if(Array.isArray(geometry?.coordinates)&&geometry.coordinates.length>1)return geometry.coordinates;
    if(Array.isArray(geometry?.geometry?.coordinates)&&geometry.geometry.coordinates.length>1)return geometry.geometry.coordinates;
    if(typeof geometry==='string')return decodePolyline(geometry,5);
    return null;
  }
  function routeCoords(e){
    const route=(e?.route?.[0]||e?.route||e?.routes?.[0]);
    return geometryCoords(route?.geometry)||geometryCoords(route)||null;
  }
  function applyRouteEvent(map,event){
    // Runtime bridge phát lại cùng object qua vmap:route; chỉ xử lý một lần.
    if(event&&event===lastRouteEvent)return;
    lastRouteEvent=event||null;
    const nextCoords=routeCoords(event)||[];
    fullRouteCoords=nextCoords;
    fullRouteRevision++;
    const seq=++routeBuildSeq;
    const build=()=>{
      if(seq!==routeBuildSeq)return;
      setData(map,nextCoords.length?features(nextCoords):[]);
      console.log(`V-MapVideo Smart GPS: captured ${nextCoords.length} route points, ${routes.length} video GPS.`);
    };
    // Nhường khung hình đầu tiên cho Mapbox vẽ vệt chỉ đường.
    const afterPaint=typeof requestAnimationFrame==='function'?requestAnimationFrame:(fn=>setTimeout(fn,0));
    afterPaint(()=>{
      if(seq!==routeBuildSeq)return;
      if(typeof requestIdleCallback==='function')requestIdleCallback(build,{timeout:350});
      else setTimeout(build,0);
    });
  }
  function mergeConfig(route){const config=window.VMAP_ROUTE_VIDEO_CONFIG?.[route.id];return config&&typeof config==='object'?{...route,...config}:route}
  async function install(map,directions){const res=await fetch('route-videos.json',{cache:'no-store'});if(!res.ok)throw Error(`route-videos.json HTTP ${res.status}`);const data=await res.json();routes=(Array.isArray(data)?data:data.routes||[]).filter(r=>r&&r.enabled!==false&&Array.isArray(r.points)&&r.points.length>1).map(mergeConfig);if(!routes.length)return;if(!map.getSource(SOURCE_ID))map.addSource(SOURCE_ID,{type:'geojson',data:{type:'FeatureCollection',features:[]}});if(!map.getLayer(LINE_ID))map.addLayer({id:LINE_ID,type:'line',source:SOURCE_ID,paint:{'line-color':'#ff2d55','line-width':4,'line-opacity':.62,'line-dasharray':[1.2,1.2]}});if(!map.getLayer(HIT_ID))map.addLayer({id:HIT_ID,type:'line',source:SOURCE_ID,paint:{'line-color':'#ff2d55','line-width':20,'line-opacity':0}});directions.on('route',e=>applyRouteEvent(map,e));window.addEventListener('vmap:route',e=>applyRouteEvent(map,e.detail));const clearRoute=()=>{routeBuildSeq++;lastRouteEvent=null;fullRouteCoords=[];fullRouteRevision++;setData(map,[]);removePopup()};directions.on('clear',clearRoute);window.addEventListener('vmap:route-clear',clearRoute);if(window.__VMAP_LAST_ROUTE_EVENT)applyRouteEvent(map,window.__VMAP_LAST_ROUTE_EVENT);console.log(`V-MapVideo Smart GPS: đã nạp ${routes.length} GPS-video; một route-click authority.`)}
  function publishDiagnostics(){
    window.VMAP_GPS_VIDEO_LAST=lastDiagnostics;
    try{
      console.groupCollapsed(`[VMapVideo] ${lastDiagnostics?.result||'UNKNOWN'} ${lastDiagnostics?.reason||''}`);
      console.log(lastDiagnostics);
      if(Array.isArray(lastDiagnostics?.candidates)&&console.table)console.table(lastDiagnostics.candidates.map(c=>({routeId:c.routeId,pointIndex:c.pointIndex,gpsM:c.gpsDistanceM,routeM:c.fullRouteDistanceM,dirDeg:c.directionDiffDeg,fullDirDeg:c.fullDirectionDiffDeg,priority:c.priority,accepted:c.acceptedByV19Rule,rejectedBy:c.rejectedBy.join(',')})));
      console.groupEnd();
    }catch(_){}
  }
  function showNoVideo(map,ll){removePopup();activePopup=new mapboxgl.Popup({maxWidth:'300px',closeButton:true,closeOnClick:false}).setLngLat(ll).setHTML('<div class="route-video-popup"><div class="route-video-title">📍 Đoạn này chưa có video</div><div class="route-video-meta">Không có GPS-video trên đúng nhánh và đúng chiều tại vị trí này.</div></div>').addTo(map)}
  window.VMAP_GPS_VIDEO_OVERLAY={
    version:'1.4.2-v28-safe-route-event',
    handleMapClick:e=>{
      const map=e?.target||window.vMapMap;if(!map||!e?.lngLat)return false;
      const ctx=getResolveContext(e);
      const found=resolveRouteClick(e.lngLat,ctx);
      publishDiagnostics();
      if(found)popup(map,found.r,found.m);else showNoVideo(map,e.lngLat);
      return true;
    },
    resolveAt:(lng,lat,options={})=>{
      const event={lngLat:{lng:+lng,lat:+lat},renderedRouteCoords:options.renderedRouteCoords};
      const found=resolveRouteClick(event.lngLat,getResolveContext(event));
      return found;
    },
    getState:()=>({version:'1.4.2-v28-safe-route-event',fullRoutePoints:fullRouteCoords.length,fullRouteRevision,libraryCount:routes.length,lastDiagnostics})
  };
  function wait(){const start=Date.now(),t=setInterval(()=>{const map=window.vMapMap,d=window.vMapDirections;if(!map||!d){if(Date.now()-start>MAX_WAIT_MS)clearInterval(t);return}clearInterval(t);const run=()=>install(map,d).catch(e=>console.warn('Smart GPS overlay chưa khởi tạo được:',e));map.loaded()?run():map.once('load',run)},80)}
  addEventListener('load',wait,{once:true});
})();
