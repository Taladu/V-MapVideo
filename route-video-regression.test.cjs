const fs=require('fs'),vm=require('vm'),assert=require('assert');
const fixture=name=>fs.existsSync(name)?name:'../refs/dev/'+name;
const ab=JSON.parse(fs.readFileSync(fixture('route-videos-TEST-CHIEU-DI-A-B.json'))).routes[0];
const ba=JSON.parse(fs.readFileSync(fixture('route-videos-TEST-CHIEU-VE-B-A.json'))).routes[0];
let popups=[];
class Popup{setLngLat(x){this.ll=x;return this}setHTML(x){this.html=x;return this}addTo(){popups.push(this);return this}remove(){popups=popups.filter(x=>x!==this)}}
class Map{
 constructor(){this.handlers=[];this.sources={};this.layers=[]}
 on(type,a,b){this.handlers.push({type,layer:typeof a==='string'?a:null,fn:typeof a==='string'?b:a});return this}
 once(t,fn){fn()}
 loaded(){return true}
 getStyle(){return{layers:[{id:'directions-route-line'}]}}
 queryRenderedFeatures(point,opt){if(opt.layers.includes('directions-route-line'))return[{}];if(opt.layers.includes('vmap-gps-video-hit'))return point.videoHit?[{properties:{routeIndex:point.routeIndex||0}}]:[];return[]}
 getLayer(id){return this.layers.find(x=>x.id===id)}
 addLayer(x){this.layers.push(x)}
 getSource(id){return this.sources[id]}
 addSource(id){this.sources[id]={setData(){}}}
 getCanvas(){return{style:{}}}
 emitClick(point,ll){for(const h of this.handlers.filter(x=>x.type==='click'&&!x.layer))h.fn.call(this,{target:this,point,lngLat:ll,features:[]});for(const h of this.handlers.filter(x=>x.type==='click'&&(!x.layer||point.videoHit)))h.layer&&h.fn.call(this,{target:this,point,lngLat:ll,features:[{properties:{routeIndex:point.routeIndex||0}}],originalEvent:{}})}
}
class Directions{constructor(){this.handlers={}}on(t,fn){(this.handlers[t]??=[]).push(fn)}emit(t,e){for(const fn of this.handlers[t]||[])fn(e)}}
const map=new Map(),directions=new Directions();
const ctx={console,URL,URLSearchParams,Response,Promise,setInterval,clearInterval,setTimeout,window:null,location:{href:'http://x/'},mapboxgl:{Map,Popup},MapboxDirections:Directions,vMapMap:map,vMapDirections:directions,addEventListener:(t,fn)=>{if(t==='load')setTimeout(fn,0)},fetch:async()=>new Response(JSON.stringify({routes:[ab,ba]}),{status:200})};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../audit/gps-route-overlay.js','utf8'),ctx);
setTimeout(()=>{
 const ac=ab.points.map(p=>[p.lng,p.lat]),bc=ba.points.map(p=>[p.lng,p.lat]);
 directions.emit('route',{route:[{geometry:{coordinates:ac}}]});
 popups=[];ctx.VMAP_GPS_VIDEO_OVERLAY.handleMapClick({target:map,lngLat:{lng:ab.points[70].lng+0.00038,lat:ab.points[70].lat}});assert.equal(popups.length,1);assert.match(popups[0].html,/iframe/);
 directions.emit('route',{route:[{geometry:{coordinates:bc}}]});
 popups=[];ctx.VMAP_GPS_VIDEO_OVERLAY.handleMapClick({target:map,lngLat:{lng:ba.points[50].lng+0.00038,lat:ba.points[50].lat}});assert.equal(popups.length,1);assert.match(popups[0].html,/iframe/);
 popups=[];ctx.VMAP_GPS_VIDEO_OVERLAY.handleMapClick({target:map,lngLat:{lng:106.8425,lat:10.843}});assert.equal(popups.length,1);assert.match(popups[0].html,/chưa có video/);
 ctx.VMAP_GPS_VIDEO_OVERLAY.handleMapClick({target:map,lngLat:{lng:106.8425,lat:10.843}});assert.equal(popups.length,1);
 const script=fs.readFileSync('../audit/script.js','utf8'),index=fs.readFileSync('../audit/index.html','utf8'),overlay=fs.readFileSync('../audit/gps-route-overlay.js','utf8');
 assert.match(script,/VMAP_GPS_VIDEO_OVERLAY/);assert.doesNotMatch(index,/route-video-single-authority/);assert.doesNotMatch(index,/stitcher-active-route-lock/);assert.doesNotMatch(overlay,/map\.on\('click',HIT_ID/);
 console.log('PASS A→B, B→A, branch NO_VIDEO, single popup');
},150);
