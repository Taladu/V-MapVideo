// V-MAPVIDEO V29.1 — Safe satellite overlay.
// Keeps the V28/V29 base style and all app layers intact; never replaces the style.
(function () {
    'use strict';

    const SOURCE_ID = 'vmap-satellite-source';
    const LAYER_ID = 'vmap-satellite-layer';
    const button = document.getElementById('toggleSatelliteBtn');
    if (!button) return;

    let map = null;
    let satelliteEnabled = false;
    let installedSlot = null;
    let lastError = null;
    let retryTimer = null;
    let retryCount = 0;

    function notify(message) {
        const toast = document.getElementById('toast-message');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(toast.__vmapSatelliteTimer);
        toast.__vmapSatelliteTimer = setTimeout(() => toast.classList.remove('show'), 2200);
    }

    function updateButton() {
        button.classList.toggle('is-active', satelliteEnabled);
        button.setAttribute('aria-pressed', String(satelliteEnabled));
        button.setAttribute(
            'aria-label',
            satelliteEnabled ? 'Chuyển sang bản đồ thường' : 'Chuyển sang bản đồ vệ tinh'
        );
        button.title = satelliteEnabled ? 'Bản đồ thường' : 'Bản đồ vệ tinh';
    }

    function baseLayerDefinition() {
        return {
            id: LAYER_ID,
            type: 'raster',
            source: SOURCE_ID,
            layout: { visibility: satelliteEnabled ? 'visible' : 'none' },
            paint: {
                'raster-opacity': 1,
                'raster-fade-duration': 0,
                'raster-resampling': 'linear'
            }
        };
    }

    function hasImports() {
        const style = map?.getStyle?.();
        return Array.isArray(style?.imports) && style.imports.length > 0;
    }

    function findLegacyLabelLayer() {
        const layers = map?.getStyle?.()?.layers;
        if (!Array.isArray(layers)) return undefined;
        return layers.find(layer =>
            layer?.type === 'symbol' && layer.layout && layer.layout['text-field']
        )?.id;
    }

    function addSatelliteLayer() {
        if (map.getLayer(LAYER_ID)) return true;

        if (hasImports()) {
            // Mapbox Standard: use MIDDLE so imagery sits above the opaque
            // land/road artwork while labels, 3D buildings and V-Map overlays stay visible.
            const middle = baseLayerDefinition();
            middle.slot = 'middle';
            try {
                map.addLayer(middle);
                installedSlot = 'middle';
                return true;
            } catch (middleError) {
                console.warn('V-MapVideo: middle slot unavailable, trying bottom slot.', middleError);
            }

            const bottom = baseLayerDefinition();
            bottom.slot = 'bottom';
            try {
                map.addLayer(bottom);
                installedSlot = 'bottom';
                return true;
            } catch (bottomError) {
                console.warn('V-MapVideo: bottom slot unavailable, trying top-level raster.', bottomError);
            }

            // Final compatibility fallback for unusual custom-import styles.
            map.addLayer(baseLayerDefinition());
            installedSlot = 'top-level';
            return true;
        }

        map.addLayer(baseLayerDefinition(), findLegacyLabelLayer());
        installedSlot = 'before-labels';
        return true;
    }

    function installSatelliteLayer() {
        if (!map) return false;
        if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) return false;

        try {
            if (!map.getSource(SOURCE_ID)) {
                map.addSource(SOURCE_ID, {
                    type: 'raster',
                    url: 'mapbox://mapbox.satellite',
                    tileSize: 256
                });
            }

            addSatelliteLayer();

            if (!map.getLayer(LAYER_ID)) {
                throw new Error('Satellite raster layer was not created.');
            }

            map.setLayoutProperty(
                LAYER_ID,
                'visibility',
                satelliteEnabled ? 'visible' : 'none'
            );
            lastError = null;
            button.disabled = false;
            updateButton();
            return true;
        } catch (error) {
            lastError = error;
            button.disabled = false; // keep clickable so a later click can retry
            console.warn('V-MapVideo: chưa thể nạp lớp vệ tinh.', error);
            return false;
        }
    }

    function scheduleRetry() {
        clearTimeout(retryTimer);
        if (!map || retryCount >= 12 || map.getLayer?.(LAYER_ID)) return;
        retryTimer = setTimeout(() => {
            retryCount += 1;
            if (!installSatelliteLayer()) scheduleRetry();
        }, 350);
    }

    function connectMap(nextMap) {
        if (!nextMap || map === nextMap) return;
        map = nextMap;
        retryCount = 0;

        // Let the button receive clicks even if the style is still finishing.
        button.disabled = false;

        map.on('style.load', () => {
            retryCount = 0;
            installSatelliteLayer();
            scheduleRetry();
        });
        if (typeof map.once === 'function') {
            map.once('load', () => {
                installSatelliteLayer();
                scheduleRetry();
            });
        }

        installSatelliteLayer();
        scheduleRetry();
    }

    button.addEventListener('click', () => {
        if (!map) {
            notify('⏳ Bản đồ đang khởi tạo, anh thử lại sau một giây.');
            return;
        }

        if (!map.getLayer(LAYER_ID) && !installSatelliteLayer()) {
            scheduleRetry();
            notify('⏳ Đang nạp ảnh vệ tinh…');
            return;
        }

        try {
            satelliteEnabled = !satelliteEnabled;
            map.setLayoutProperty(
                LAYER_ID,
                'visibility',
                satelliteEnabled ? 'visible' : 'none'
            );
            updateButton();
            notify(satelliteEnabled ? '🛰️ Đã bật bản đồ vệ tinh' : '🗺️ Đã về bản đồ thường');
        } catch (error) {
            satelliteEnabled = false;
            lastError = error;
            updateButton();
            console.warn('V-MapVideo: bật/tắt vệ tinh thất bại.', error);
            notify('⚠️ Chưa bật được vệ tinh. V-Map sẽ tự thử lại.');
            scheduleRetry();
        }
    });

    window.addEventListener('vmap:runtime-ready', event => {
        connectMap(event?.detail?.map);
    });
    if (window.vMapMap) connectMap(window.vMapMap);

    window.VMAP_SATELLITE_LAYER = Object.freeze({
        version: '1.1.0-v29.1-safe-layer',
        sourceId: SOURCE_ID,
        layerId: LAYER_ID,
        isEnabled: () => satelliteEnabled,
        getStatus: () => ({
            connected: Boolean(map),
            styleLoaded: Boolean(map && (typeof map.isStyleLoaded !== 'function' || map.isStyleLoaded())),
            sourceReady: Boolean(map?.getSource?.(SOURCE_ID)),
            layerReady: Boolean(map?.getLayer?.(LAYER_ID)),
            slot: installedSlot,
            lastError: lastError ? String(lastError?.message || lastError) : null
        })
    });
})();
