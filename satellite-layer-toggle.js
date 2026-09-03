// V-MAPVIDEO V29.2 — Clean satellite overlay.
// Safe rule: keep Directions, GPS-video, POI, popup and route data untouched.
(function () {
    'use strict';

    const SOURCE_ID = 'vmap-satellite-source';
    const LAYER_ID = 'vmap-satellite-layer';
    const CUSTOM_3D_LAYER_ID = '3d-buildings';
    const BASEMAP_IMPORT_ID = 'basemap';
    const STANDARD_SATELLITE_OVERRIDES = Object.freeze({
        show3dObjects: false,
        showPointOfInterestLabels: false,
        showTransitLabels: false,
        showPlaceLabels: false
    });

    const button = document.getElementById('toggleSatelliteBtn');
    const toggle3DButton = document.getElementById('toggle3DBtn');
    if (!button) return;

    let map = null;
    let satelliteEnabled = false;
    let installedSlot = null;
    let lastError = null;
    let retryTimer = null;
    let retryCount = 0;
    let basemapConfigSnapshot = null;
    let custom3DRestoreOpacity;

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
            // Mapbox Standard: MIDDLE shows imagery above the opaque basemap artwork
            // while V-Map custom overlays remain above it.
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

            map.addLayer(baseLayerDefinition());
            installedSlot = 'top-level';
            return true;
        }

        map.addLayer(baseLayerDefinition(), findLegacyLabelLayer());
        installedSlot = 'before-labels';
        return true;
    }

    function canSafelyConfigureBasemap() {
        return hasImports() &&
            typeof map?.getConfigProperty === 'function' &&
            typeof map?.setConfigProperty === 'function';
    }

    function captureBasemapConfig() {
        if (basemapConfigSnapshot || !canSafelyConfigureBasemap()) {
            return Boolean(basemapConfigSnapshot);
        }

        const snapshot = {};
        let captured = 0;
        for (const property of Object.keys(STANDARD_SATELLITE_OVERRIDES)) {
            try {
                const value = map.getConfigProperty(BASEMAP_IMPORT_ID, property);
                if (value !== undefined) {
                    snapshot[property] = value;
                    captured += 1;
                }
            } catch (_) {
                // Unsupported config keys are intentionally ignored.
            }
        }

        if (captured > 0) basemapConfigSnapshot = snapshot;
        return captured > 0;
    }

    function applyStandardSatelliteAppearance() {
        if (!captureBasemapConfig()) return false;

        let changed = 0;
        for (const [property, value] of Object.entries(STANDARD_SATELLITE_OVERRIDES)) {
            if (!Object.prototype.hasOwnProperty.call(basemapConfigSnapshot, property)) continue;
            try {
                map.setConfigProperty(BASEMAP_IMPORT_ID, property, value);
                changed += 1;
            } catch (error) {
                console.warn(`V-MapVideo: bỏ qua basemap config ${property}.`, error);
            }
        }
        return changed > 0;
    }

    function restoreStandardAppearance() {
        if (!basemapConfigSnapshot || typeof map?.setConfigProperty !== 'function') {
            basemapConfigSnapshot = null;
            return;
        }

        for (const [property, value] of Object.entries(basemapConfigSnapshot)) {
            try {
                map.setConfigProperty(BASEMAP_IMPORT_ID, property, value);
            } catch (error) {
                console.warn(`V-MapVideo: chưa khôi phục được basemap config ${property}.`, error);
            }
        }
        basemapConfigSnapshot = null;
    }

    function isNonZeroOpacity(value) {
        return typeof value === 'number' ? value !== 0 : value !== undefined && value !== null;
    }

    function captureCustom3DOpacity(forceRefresh = false) {
        if (!map?.getLayer?.(CUSTOM_3D_LAYER_ID) ||
            typeof map?.getPaintProperty !== 'function') return false;

        try {
            const current = map.getPaintProperty(CUSTOM_3D_LAYER_ID, 'fill-extrusion-opacity');
            if ((custom3DRestoreOpacity === undefined || forceRefresh) && isNonZeroOpacity(current)) {
                custom3DRestoreOpacity = current;
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    function hideCustom3DBuildings(forceRefresh = false) {
        if (!map?.getLayer?.(CUSTOM_3D_LAYER_ID) ||
            typeof map?.setPaintProperty !== 'function') return false;

        captureCustom3DOpacity(forceRefresh);
        try {
            map.setPaintProperty(CUSTOM_3D_LAYER_ID, 'fill-extrusion-opacity', 0);
            return true;
        } catch (error) {
            console.warn('V-MapVideo: chưa ẩn được lớp 3D tùy chỉnh.', error);
            return false;
        }
    }

    function restoreCustom3DBuildings() {
        if (custom3DRestoreOpacity === undefined) return;
        const restoreValue = custom3DRestoreOpacity;
        custom3DRestoreOpacity = undefined;

        if (!map?.getLayer?.(CUSTOM_3D_LAYER_ID) ||
            typeof map?.setPaintProperty !== 'function') return;

        try {
            map.setPaintProperty(
                CUSTOM_3D_LAYER_ID,
                'fill-extrusion-opacity',
                restoreValue
            );
        } catch (error) {
            console.warn('V-MapVideo: chưa khôi phục được lớp 3D tùy chỉnh.', error);
        }
    }

    function applySatelliteAppearance() {
        if (!satelliteEnabled || !map) return;
        applyStandardSatelliteAppearance();
        hideCustom3DBuildings();
    }

    function restoreNormalAppearance() {
        restoreStandardAppearance();
        restoreCustom3DBuildings();
    }

    function syncAppearanceLater() {
        setTimeout(() => {
            if (satelliteEnabled) applySatelliteAppearance();
        }, 0);
        setTimeout(() => {
            if (satelliteEnabled) applySatelliteAppearance();
        }, 250);
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

            if (satelliteEnabled) {
                applySatelliteAppearance();
                syncAppearanceLater();
            }

            lastError = null;
            button.disabled = false;
            updateButton();
            return true;
        } catch (error) {
            lastError = error;
            button.disabled = false;
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

    function resetAppearanceSnapshotsForNewStyle() {
        basemapConfigSnapshot = null;
        custom3DRestoreOpacity = undefined;
        installedSlot = null;
    }

    function connectMap(nextMap) {
        if (!nextMap || map === nextMap) return;
        map = nextMap;
        retryCount = 0;
        button.disabled = false;

        map.on('style.load', () => {
            retryCount = 0;
            resetAppearanceSnapshotsForNewStyle();
            installSatelliteLayer();
            scheduleRetry();
        });

        if (typeof map.once === 'function') {
            map.once('load', () => {
                installSatelliteLayer();
                if (satelliteEnabled) syncAppearanceLater();
                scheduleRetry();
            });
        }

        installSatelliteLayer();
        scheduleRetry();
    }

    function setSatelliteEnabled(nextEnabled) {
        if (!map?.getLayer?.(LAYER_ID)) return false;

        satelliteEnabled = Boolean(nextEnabled);
        map.setLayoutProperty(
            LAYER_ID,
            'visibility',
            satelliteEnabled ? 'visible' : 'none'
        );

        if (satelliteEnabled) {
            applySatelliteAppearance();
            syncAppearanceLater();
        } else {
            restoreNormalAppearance();
        }

        updateButton();
        return true;
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
            setSatelliteEnabled(!satelliteEnabled);
            notify(
                satelliteEnabled
                    ? '🛰️ Vệ tinh sạch: đã ẩn khối 3D và nhãn phụ'
                    : '🗺️ Đã khôi phục bản đồ thường'
            );
        } catch (error) {
            satelliteEnabled = false;
            lastError = error;
            restoreNormalAppearance();
            updateButton();
            console.warn('V-MapVideo: bật/tắt vệ tinh thất bại.', error);
            notify('⚠️ Chưa bật được vệ tinh. V-Map sẽ tự thử lại.');
            scheduleRetry();
        }
    });

    // script.js may change the custom 3D opacity when the 2D/3D button is pressed.
    // Capture that intended value after its click handler, then keep satellite mode clean.
    if (toggle3DButton) {
        toggle3DButton.addEventListener('click', () => {
            if (!satelliteEnabled) return;
            setTimeout(() => {
                if (!satelliteEnabled) return;
                hideCustom3DBuildings(true);
            }, 0);
        });
    }

    window.addEventListener('vmap:runtime-ready', event => {
        connectMap(event?.detail?.map);
    });
    if (window.vMapMap) connectMap(window.vMapMap);

    window.VMAP_SATELLITE_LAYER = Object.freeze({
        version: '1.2.0-v29.2-clean-satellite',
        sourceId: SOURCE_ID,
        layerId: LAYER_ID,
        isEnabled: () => satelliteEnabled,
        syncAppearance: () => {
            if (satelliteEnabled) {
                applySatelliteAppearance();
                return true;
            }
            return false;
        },
        getStatus: () => ({
            connected: Boolean(map),
            styleLoaded: Boolean(
                map && (typeof map.isStyleLoaded !== 'function' || map.isStyleLoaded())
            ),
            sourceReady: Boolean(map?.getSource?.(SOURCE_ID)),
            layerReady: Boolean(map?.getLayer?.(LAYER_ID)),
            slot: installedSlot,
            cleanAppearance: satelliteEnabled,
            basemapSnapshotKeys: basemapConfigSnapshot
                ? Object.keys(basemapConfigSnapshot)
                : [],
            custom3DHidden: Boolean(
                satelliteEnabled && map?.getLayer?.(CUSTOM_3D_LAYER_ID)
            ),
            lastError: lastError ? String(lastError?.message || lastError) : null
        })
    });
})();
