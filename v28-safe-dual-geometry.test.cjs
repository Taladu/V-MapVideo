const fs=require('fs'),vm=require('vm'),assert=require('assert');

const source=fs.readFileSync('gps-route-overlay.js','utf8');
assert(source.includes("ROUTE_MATCH_METERS=120, CLICK_MATCH_METERS=180, MAX_DIRECTION_DIFF_DEG=70"),'V19 120/180/70 constants changed');
for(const forbidden of ['fixedCoverageAt','safeStart','safeEnd','advanceOK']){
  assert(!source.includes(forbidden),`Forbidden V27 fixed-coverage logic returned: ${forbidden}`);
}

class Popup{setLngLat(){return this}setHTML(){return this}addTo(){return this}remove(){}}
class Map{
  constructor(){this.sources={};this.layers=[]}
  loaded(){return true}
  once(t,f){f()}
  getSource(i){return this.sources[i]}
  addSource(i){this.sources[i]={data:null,setData(d){this.data=d}}}
  getLayer(i){return this.layers.find(x=>x.id===i)}
  addLayer(x){this.layers.push(x)}
}
class Directions{
  constructor(){this.h={}}
  on(t,f){(this.h[t]??=[]).push(f)}
  emit(t,e){for(const f of this.h[t]||[])f(e)}
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function boot(routes){
  const map=new Map(),directions=new Directions();
  const ctx={
    console,URL,URLSearchParams,Response,Promise,setInterval,clearInterval,setTimeout,
    requestAnimationFrame:fn=>setTimeout(fn,0),
    window:null,location:{href:'http://x/'},mapboxgl:{Map,Popup},
    vMapMap:map,vMapDirections:directions,
    addEventListener:(t,f)=>{if(t==='load')setTimeout(f,0)},
    fetch:async()=>new Response(JSON.stringify({routes}),{status:200})
  };
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
  return{ctx,map,directions};
}

(async()=>{
  // 1) Golden A->B / B->A samples remain playable.
  const ab=JSON.parse(fs.readFileSync('route-videos-TEST-CHIEU-DI-A-B.json','utf8')).routes[0];
  const ba=JSON.parse(fs.readFileSync('route-videos-TEST-CHIEU-VE-B-A.json','utf8')).routes[0];
  {
    const {ctx,directions}=boot([ab,ba]); await sleep(150);
    const abCoords=ab.points.map(p=>[p.lng,p.lat]);
    directions.emit('route',{route:[{geometry:{coordinates:abCoords}}]});
    await sleep(25);
    for(let i=5;i<ab.points.length-5;i+=9){
      const p=ab.points[i];
      const local=abCoords.slice(Math.max(0,i-5),Math.min(abCoords.length,i+6));
      assert.ok(ctx.VMAP_GPS_VIDEO_OVERLAY.resolveAt(p.lng,p.lat,{renderedRouteCoords:local}),`A->B lost at ${i}`);
    }

    const baCoords=ba.points.map(p=>[p.lng,p.lat]);
    directions.emit('route',{route:[{geometry:{coordinates:baCoords}}]});
    await sleep(25);
    for(let i=5;i<ba.points.length-5;i+=9){
      const p=ba.points[i];
      const local=baCoords.slice(Math.max(0,i-5),Math.min(baCoords.length,i+6));
      assert.ok(ctx.VMAP_GPS_VIDEO_OVERLAY.resolveAt(p.lng,p.lat,{renderedRouteCoords:local}),`B->A lost at ${i}`);
    }
  }

  // 2) Self-near route: global nearest branch points west, local clicked branch points east.
  // The local V19 direction context must win without overwriting full-route authority.
  {
    const y=10.8,x=106.7,step=.0005;
    const videoPoints=[];
    for(let i=0;i<=4;i++)videoPoints.push({lng:x+i*step,lat:y,tRaw:i});
    const route={id:'self-near-east',name:'Self near east',youtube:'abcdefghijk',points:videoPoints};

    const lower=videoPoints.map(p=>[p.lng,p.lat]);
    const upper=[];
    for(let i=4;i>=0;i--)upper.push([x+i*step,y+.00005]);
    const full=[...lower,[x+4*step,y+.000025],...upper];
    const local=lower;
    const click={lng:x+2*step,lat:y+.00007};

    const {ctx,directions}=boot([route]); await sleep(150);
    directions.emit('route',{route:[{geometry:{coordinates:full}}]});
    await sleep(25);

    const noLocal=ctx.VMAP_GPS_VIDEO_OVERLAY.resolveAt(click.lng,click.lat);
    assert.equal(noLocal,null,'fixture must expose global-nearest wrong-branch risk');

    const hit=ctx.VMAP_GPS_VIDEO_OVERLAY.resolveAt(click.lng,click.lat,{renderedRouteCoords:local});
    assert.ok(hit,'rendered local branch must preserve V19 PLAY');
    const diag=ctx.VMAP_GPS_VIDEO_OVERLAY.getState().lastDiagnostics;
    assert.equal(diag.routeGeometry.directionSource,'rendered-local');
    assert.equal(diag.routeGeometry.fullRoutePoints,full.length);
    assert.equal(diag.routeGeometry.localRoutePoints,local.length);
    assert.equal(diag.shadow.fullVsLocalConflict,true,'shadow must record full/local branch conflict');
  }

  // 3) Video pre-roll before Directions origin A must remain playable just after A.
  {
    const y=10.81,x=106.71,step=.0004;
    const points=[];for(let i=0;i<=16;i++)points.push({lng:x+i*step,lat:y,tRaw:i});
    const route={id:'preroll',youtube:'abcdefghijk',points};
    const full=points.slice(5).map(p=>[p.lng,p.lat]);
    const local=full.slice(0,7);
    const {ctx,directions}=boot([route]);await sleep(150);
    directions.emit('route',{route:[{geometry:{coordinates:full}}]});await sleep(25);
    const p=points[6];
    assert.ok(ctx.VMAP_GPS_VIDEO_OVERLAY.resolveAt(p.lng,p.lat,{renderedRouteCoords:local}),'pre-roll before A must not remove video after A');
  }

  // 4) Hard telemetry gap splits only the rendered line; no safeStart/safeEnd dead-zone logic.
  {
    const y=10.82,x=106.72;
    const points=[
      {lng:x,lat:y,tRaw:0},{lng:x+.0001,lat:y,tRaw:1},
      {lng:x+.0040,lat:y,tRaw:40},{lng:x+.0041,lat:y,tRaw:41}
    ];
    const route={id:'gap',youtube:'abcdefghijk',points};
    const full=points.map(p=>[p.lng,p.lat]);
    const {map,directions}=boot([route]);await sleep(150);
    directions.emit('route',{route:[{geometry:{coordinates:full}}]});await sleep(80);
    const data=map.getSource('vmap-gps-video-routes').data;
    assert.equal(data.features.length,2,'telemetry gap must split visual line exactly at gap');
  }

  console.log('PASS V28 Safe Dual Geometry: Golden coverage, self-near topology, pre-roll and non-destructive gap handling');
})().catch(err=>{console.error(err);process.exit(1)});
