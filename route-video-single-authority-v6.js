// V-MapVideo v6 single route-click authority
// Loaded BEFORE script.js. It replaces only the legacy generic Directions-route click handler
// at registration time, so one click has exactly one video resolver.
(function () {
  'use strict';
  if (window.__vMapSingleAuthorityV6Installed) return;
  window.__vMapSingleAuthorityV6Installed = true;

  function isDirectionsRouteAtPoint(map, point) {
    try {
      const style = map.getStyle();
      if (!style || !Array.isArray(style.layers)) return false;
      const ids = style.layers
        .map(layer => layer.id)
        .filter(id => typeof id === 'string' && id.startsWith('directions-route'));
      if (!ids.length) return false;
      return map.queryRenderedFeatures(point, { layers: ids }).length > 0;
    } catch (_) {
      return false;
    }
  }

  const MapProto = window.mapboxgl && window.mapboxgl.Map && window.mapboxgl.Map.prototype;
  if (!MapProto || typeof MapProto.on !== 'function') {
    console.warn('🧭 Single Authority v6: Mapbox Map.prototype.on unavailable.');
    return;
  }

  const nativeOn = MapProto.on;
  MapProto.on = function (type, layerOrListener, maybeListener) {
    // Only intercept the legacy GLOBAL click listener from script.js.
    // Layer-specific click handlers (places/clusters/etc.) pass through unchanged.
    if (type === 'click' && typeof layerOrListener === 'function' && maybeListener === undefined) {
      let source = '';
      try { source = Function.prototype.toString.call(layerOrListener); } catch (_) {}

      const isLegacyRouteVideoHandler =
        source.includes('openRouteVideoAtClick') &&
        source.includes('isRouteFeatureAtPoint');

      if (isLegacyRouteVideoHandler) {
        console.log('🧭 Single Authority v6: legacy nearest-video route click handler replaced.');
        return nativeOn.call(this, 'click', function (e) {
          if (!isDirectionsRouteAtPoint(this, e.point)) return;
          // The stable overlay's layer handler owns clicks on a real GPS-video line.
          // Only fall through to NO_VIDEO when the active Directions branch has no video hit.
          try {
            if (this.getLayer('vmap-gps-video-hit') &&
                this.queryRenderedFeatures(e.point, { layers: ['vmap-gps-video-hit'] }).length > 0) return;
          } catch (_) {}

          const resolver = window.VMAP_GPS_VIDEO_OVERLAY;
          if (!resolver || typeof resolver.handleMapClick !== 'function') {
            console.warn('🧭 Single Authority v6: GPS-video overlay unavailable; fail closed.');
            return;
          }

          Promise.resolve(resolver.handleMapClick(e)).catch(err => {
            console.warn('🧭 Single Authority v6: GPS-video click failed', err);
          });
        });
      }
    }

    return nativeOn.apply(this, arguments);
  };

  MapProto.__vMapSingleAuthorityV6Patched = true;
  console.log('🧭 V-MapVideo Single Authority v6 active — stable GPS-video overlay is the only route-click resolver.');
})();

