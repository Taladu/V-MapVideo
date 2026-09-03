// V-MapVideo runtime bridge v3
// Publishes the real map/directions instances deterministically from Directions.onAdd(map),
// so route resolvers are bound BEFORE the first route event.
(function(){
  'use strict';
  if(window.__vMapRuntimeBridgeV3Installed)return;
  window.__vMapRuntimeBridgeV3Installed=true;

  let lastMap=null;
  let lastDirections=null;
  let publishQueued=false;

  function publish(){
    publishQueued=false;
    const map=window.vMapMap||lastMap;
    const directions=window.vMapDirections||lastDirections;
    if(!map||!directions)return;

    window.vMapMap=map;
    window.vMapDirections=directions;
    window.dispatchEvent(new CustomEvent('vmap:runtime-ready',{detail:{map,directions}}));
    console.log('🧭 V-Map runtime bridge v3 ready');
  }

  function queuePublish(){
    if(publishQueued)return;
    publishQueued=true;
    queueMicrotask(publish);
  }

  function rememberRouteEvent(event){
    window.__VMAP_LAST_ROUTE_EVENT=event;
    window.dispatchEvent(new CustomEvent('vmap:route',{detail:event}));
  }

  // Most reliable hook: script.js always calls directions.onAdd(map) immediately
  // after creating the MapboxDirections instance. Capture both objects right there.
  const DirectionsProto=window.MapboxDirections?.prototype;
  if(DirectionsProto&&typeof DirectionsProto.onAdd==='function'&&!DirectionsProto.__vmapRuntimeOnAddPatched){
    const nativeOnAdd=DirectionsProto.onAdd;
    DirectionsProto.onAdd=function(map){
      if(map){
        lastMap=map;
        window.vMapMap=map;
      }
      lastDirections=this;
      window.vMapDirections=this;

      if(!this.__vmapRouteMemoryInstalled&&typeof this.on==='function'){
        this.__vmapRouteMemoryInstalled=true;
        this.on('route',rememberRouteEvent);
        this.on('clear',()=>{
          window.__VMAP_LAST_ROUTE_EVENT=null;
          window.dispatchEvent(new CustomEvent('vmap:route-clear'));
        });
      }

      const result=nativeOnAdd.apply(this,arguments);
      queuePublish();
      return result;
    };
    DirectionsProto.__vmapRuntimeOnAddPatched=true;
  }

  // Fallbacks for compatibility if a future Directions build changes onAdd behavior.
  const MapProto=window.mapboxgl?.Map?.prototype;
  if(MapProto&&typeof MapProto.on==='function'&&!MapProto.__vmapRuntimeExposePatched){
    const nativeOn=MapProto.on;
    MapProto.on=function(){
      if(!window.vMapMap){lastMap=this;window.vMapMap=this;queuePublish();}
      return nativeOn.apply(this,arguments);
    };
    MapProto.__vmapRuntimeExposePatched=true;
  }

  if(DirectionsProto&&typeof DirectionsProto.on==='function'&&!DirectionsProto.__vmapRuntimeExposePatched){
    const nativeOn=DirectionsProto.on;
    DirectionsProto.on=function(){
      if(!window.vMapDirections){lastDirections=this;window.vMapDirections=this;queuePublish();}
      return nativeOn.apply(this,arguments);
    };
    DirectionsProto.__vmapRuntimeExposePatched=true;
  }

  // If another module already exposed the runtime before this script executes.
  if(window.vMapMap&&window.vMapDirections)queuePublish();
})();
