const fs=require('fs'),vm=require('vm'),assert=require('assert');

const source=fs.readFileSync('gps-route-overlay.js','utf8');

class Popup{setLngLat(){return this}setHTML(){return this}addTo(){return this}remove(){}}
class Map{
  constructor(){this.sources={};this.layers=[]}
  loaded(){return true}
  once(t,f){f()}
  getSource(i){return this.sources[i]}
  addSource(i){this.sources[i]={setData(){}}}
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
  return{ctx,directions};
}

(async()=>{
  const coords=[[-120.2,38.5],[-120.95,40.7],[-126.453,43.252]];
  const route={id:'polyline-route',youtube:'abcdefghijk',points:coords.map((c,i)=>({lng:c[0],lat:c[1],tRaw:i}))};

  // Standard Google/Mapbox polyline precision-5 example.
  const encoded='_p~iF~ps|U_ulLnnqC_mqNvxq\`@';

  {
    const {ctx,directions}=boot([route]);
    await sleep(150);
    directions.emit('route',{route:[{geometry:encoded}]});
    await sleep(30);
    const state=ctx.VMAP_GPS_VIDEO_OVERLAY.getState();
    assert.equal(state.fullRoutePoints,3,'encoded polyline route event must decode into fullRouteCoords');
    const hit=ctx.VMAP_GPS_VIDEO_OVERLAY.resolveAt(coords[0][0],coords[0][1],{renderedRouteCoords:coords});
    assert.ok(hit,'decoded polyline route must be usable by resolver');
  }

  {
    const {ctx,directions}=boot([route]);
    await sleep(150);
    directions.emit('route',{route:[{geometry:{type:'LineString',coordinates:coords}}]});
    await sleep(30);
    assert.equal(ctx.VMAP_GPS_VIDEO_OVERLAY.getState().fullRoutePoints,3,'GeoJSON route event must remain supported');
  }

  assert(source.includes('function decodePolyline(encoded,precision=5)'),'polyline decoder missing');
  assert(source.includes("if(typeof geometry==='string')return decodePolyline(geometry,5);"),'string geometry fallback missing');

  console.log('PASS V28 route-event parser accepts encoded polyline and GeoJSON');
})().catch(err=>{console.error(err);process.exit(1)});
