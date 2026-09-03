// V-MAPVIDEO V29 — Safe satellite overlay.
// Deliberately never replaces the map style: V28 GPS-video, Directions and POI layers stay intact.
(function () {
    'use strict';

    const SOURCE_ID = 'vmap-satellite-source';
    const LAYER_ID = 'vmap-satellite-layer';
    const button = document.getElementById('toggleSatelliteBtn');
    if (!button) return;

    let map = null;
    let satelliteEnabled = false;

    function updateButton() {
        button.classList.toggle('is-active', satelliteEnabled);
        button.setAttribute('aria-pressed', String(satelliteEnabled));
        button.setAttribute(
            'aria-label',
            satelliteEnabled ? 'Chuyển sang bản đồ thường' : 'Chuyển sang bản đồ vệ tinh'
        );
        button.title = satelliteEnabled ? 'Bản đồ thường' : 'Bản đồ vệ tinh';
    }

    function getLayerDefinition() {
        const definition = {
            id: LAYER_ID,
            type: 'raster',
            source: SOURCE_ID,
            layout: { visibility: satelliteEnabled ? 'visible' : 'none' },
            paint: {
                'raster-opacity': 1,
                'raster-fade-duration': 0
            }
        };

        const style = map.getStyle?.();
        if (Array.isArray(style?.imports) && style.imports.length > 0) {
            // Mapbox Standard: bottom is above land/water and below roads/labels.
            definition.slot = 'bottom';
        }
        return definition;
    }

    function findLegacyLabelLayer() {
        const layers = map.getStyle?.()?.layers;
        if (!Array.isArray(layers)) return undefined;
        return layers.find(layer =>
            layer?.type === 'symbol' && layer.layout && layer.layout['text-field']
        )?.id;
    }

    function installSatelliteLayer() {
        if (!map || (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded())) {
            return false;
        }

        try {
            if (!map.getSource(SOURCE_ID)) {
                map.addSource(SOURCE_ID, {
                    type: 'raster',
                    url: 'mapbox://mapbox.satellite',
                    tileSize: 256
                });
            }

            if (!map.getLayer(LAYER_ID)) {
                const definition = getLayerDefinition();
                if (definition.slot) {
                    map.addLayer(definition);
                } else {
                    map.addLayer(definition, findLegacyLabelLayer());
                }
            }

            map.setLayoutProperty(
                LAYER_ID,
                'visibility',
                satelliteEnabled ? 'visible' : 'none'
            );
            button.disabled = false;
            updateButton();
            return true;
        } catch (error) {
            button.disabled = true;
            console.warn('V-MapVideo: chưa thể nạp lớp vệ tinh an toàn.', error);
            return false;
        }
    }

    function connectMap(nextMap) {
        if (!nextMap || map === nextMap) return;
        map = nextMap;
        button.disabled = true;

        // Also restores only this optional layer if a future module reloads the style.
        map.on('style.load', installSatelliteLayer);
        if (typeof map.isStyleLoaded !== 'function' || map.isStyleLoaded()) {
            installSatelliteLayer();
        }
    }

    button.addEventListener('click', () => {
        if (!map || button.disabled || !map.getLayer(LAYER_ID)) return;
        satelliteEnabled = !satelliteEnabled;
        map.setLayoutProperty(
            LAYER_ID,
            'visibility',
            satelliteEnabled ? 'visible' : 'none'
        );
        updateButton();
    });

    window.addEventListener('vmap:runtime-ready', event => {
        connectMap(event?.detail?.map);
    });
    if (window.vMapMap) connectMap(window.vMapMap);

    window.VMAP_SATELLITE_LAYER = Object.freeze({
        version: '1.0.0-v29-safe-layer',
        sourceId: SOURCE_ID,
        layerId: LAYER_ID,
        isEnabled: () => satelliteEnabled
    });
})();
