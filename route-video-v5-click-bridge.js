// V-MapVideo v5 click bridge
// Installs AFTER script.js has registered legacy handlers, so v5 becomes the final authority for route clicks.
(function(){
  'use strict';
  if(window.__vMapV5ClickBridgeInstalled)return;
  window.__vMapV5ClickBridgeInstalled=true;

  function isDirectionsRouteAtPoint(map,point){
    try{
      const style=map.getStyle();
      if(!style||!Array.isArray(style.layers))return false;
      const ids=style.layers.map(l=>l.id).filter(id=>typeof id==='string'&&id.startsWith('directions-route'));
      if(!ids.length)return false;
      return map.queryRenderedFeatures(point,{layers:ids}).length>0;
    }catch(_){return false;}
  }

  function attach(){
    const map=window.vMapMap;
    const resolver=window.VMAP_ROUTE_VIDEO_RESOLVER;
    if(!map||!resolver||typeof resolver.handleMapClick!=='function'){
      setTimeout(attach,100);
      return;
    }
    if(map.__vMapV5FinalClickAttached)return;
    map.__vMapV5FinalClickAttached=true;
    map.on('click',e=>{
      if(!isDirectionsRouteAtPoint(map,e.point))return;
      // Run after legacy click listeners, then replace any legacy popup with the resolver result.
      setTimeout(()=>resolver.handleMapClick(e).catch?.(err=>console.warn('🧭 v5 click bridge failed',err)),0);
    });
    console.log('🧭 Resolver v5 final route-click bridge attached');
  }

  window.addEventListener('load',()=>setTimeout(attach,80),{once:true});
})();