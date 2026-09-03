// V-MAPVIDEO CLEAN 1.3.2 — FROM HERE TO B: UI rõ điểm bấm → đích, giữ kiểm tra GPS-video an toàn
window.addEventListener('load', function() {
            // --- NÂNG CẤP: Khai báo 'places' ở đây để nhận dữ liệu từ JSON ---
            let map, directions, userMarker, places;
            let routeVideos = [];
            let directionsLocationRequestSeq = 0;
            const exactDirectionsEndpoints = { origin: null, destination: null };

            // v17: điểm B được giao ngay cho Mapbox; GPS chỉ bổ sung điểm A mà không chặn vẽ tuyến.
            const USER_LOCATION_CACHE_KEY = 'vmap_last_user_location';
            const USER_LOCATION_CACHE_MAX_AGE_MS = 2 * 60 * 1000;
            const ROUTE_LOCATION_OPTIONS = Object.freeze({
                enableHighAccuracy: false,
                timeout: 5000,
                maximumAge: 60 * 1000
            });
            const LOCATE_BUTTON_OPTIONS = Object.freeze({
                enableHighAccuracy: true,
                timeout: 8000,
                maximumAge: 30 * 1000
            });

            function isValidLngLat(coords) {
                return Array.isArray(coords) &&
                    Number.isFinite(coords[0]) && Number.isFinite(coords[1]) &&
                    Math.abs(coords[0]) <= 180 && Math.abs(coords[1]) <= 90;
            }

            function saveRecentUserLocation(coords) {
                if (!isValidLngLat(coords)) return;
                try {
                    localStorage.setItem(USER_LOCATION_CACHE_KEY, JSON.stringify({
                        lng: coords[0],
                        lat: coords[1],
                        savedAt: Date.now()
                    }));
                } catch (e) {}
            }

            function readRecentUserLocation() {
                try {
                    const cached = JSON.parse(localStorage.getItem(USER_LOCATION_CACHE_KEY) || 'null');
                    const coords = cached && [Number(cached.lng), Number(cached.lat)];
                    if (!cached || !isValidLngLat(coords) ||
                        !Number.isFinite(cached.savedAt) ||
                        Date.now() - cached.savedAt > USER_LOCATION_CACHE_MAX_AGE_MS) {
                        return null;
                    }
                    return coords;
                } catch (e) {
                    return null;
                }
            }

            function locationDistanceMeters(a, b) {
                if (!isValidLngLat(a) || !isValidLngLat(b)) return Infinity;
                const rad = Math.PI / 180;
                const dLat = (b[1] - a[1]) * rad;
                const dLng = (b[0] - a[0]) * rad;
                const lat1 = a[1] * rad;
                const lat2 = b[1] * rad;
                const h = Math.sin(dLat / 2) ** 2 +
                    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
                return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
            }
            
            const iconUrl = 'https://cdn-icons-png.flaticon.com/512/2776/2776000.png';
            let activePopup = null;
            window.vMapIsAnimating = false; 

            // === KHU VỰC XỬ LÝ ÂM THANH ===
            const flightSound = new Audio('flycam_mix.mp3');
            const clickSound = new Audio('click.mp3');
            clickSound.preload = 'auto';
            clickSound.volume = 0.22;
            const landingSound = new Audio('Beep Short.mp3');
            flightSound.loop = true;
            let audioContext;
            let landingSoundBuffer;
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                window.fetch('Beep Short.mp3')
                    .then(response => response.arrayBuffer())
                    .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
                    .then(audioBuffer => {
                         landingSoundBuffer = audioBuffer;
                    })
                    .catch(e => console.error("Lỗi tải file 'Beep Short.mp3' cho Web Audio:", e));
            } catch(e) {
                console.error("Web Audio API không được trình duyệt này hỗ trợ.");
            }
            function unlockAndPreloadSounds() {
                if (audioContext && audioContext.state === 'suspended') {
                    audioContext.resume();
                }
                [flightSound, clickSound, landingSound].forEach(sound => {
                    sound.play().then(() => sound.pause()).catch(() => {});
                });
                window.removeEventListener('click', unlockAndPreloadSounds);
                window.removeEventListener('touchstart', unlockAndPreloadSounds);
            }
            window.addEventListener('click', unlockAndPreloadSounds, { once: true });
            window.addEventListener('touchstart', unlockAndPreloadSounds, { once: true });

            // === UX FEEDBACK: âm thanh chạm + rung nhẹ nếu thiết bị hỗ trợ ===
            function playTapFeedback() {
                try {
                    clickSound.currentTime = 0;
                    clickSound.play().catch(() => {});
                } catch (e) {}
                // Android/webview thường hỗ trợ; iPhone Safari có thể bỏ qua an toàn.
                if (navigator.vibrate) {
                    try { navigator.vibrate(8); } catch (e) {}
                }
            }

            // Chỉ phản hồi trên thao tác "chọn/bấm", không phát khi kéo/zoom bản đồ.
            document.addEventListener('click', (event) => {
                const interactive = event.target.closest(
                    'button, .location-item, .youtube-placeholder'
                );
                if (interactive) playTapFeedback();
            }, { passive: true });

            function playLandingSoundSpatially(xPosition) {
                if (audioContext && landingSoundBuffer && audioContext.state === 'running') {
                    try {
                        const source = audioContext.createBufferSource();
                        source.buffer = landingSoundBuffer;
                        const panner = audioContext.createStereoPanner();
                        source.connect(panner);
                        panner.connect(audioContext.destination);
                        const panValue = (xPosition / window.innerWidth) * 2 - 1;
                        panner.pan.value = Math.max(-1, Math.min(1, panValue));
                        source.start(0);
                    } catch(e) {
                        landingSound.currentTime = 0;
                        landingSound.play();
                    }
                } else {
                    landingSound.currentTime = 0;
                    landingSound.play();
                }
            }
            function fadeAudio(audio, options) {
                const { to, duration, onComplete } = options;
                const from = audio.volume;
                const interval = 50;
                const step = (to - from) / (duration / interval);
                let currentVolume = from;
                if (audio.fadeInterval) clearInterval(audio.fadeInterval);
                if (to > 0 && audio.paused) {
                    audio.volume = 0;
                    audio.play().catch(e => console.warn("Lỗi phát âm thanh:", e));
                }
                audio.fadeInterval = setInterval(() => {
                    currentVolume += step;
                    if ((step > 0 && currentVolume >= to) || (step < 0 && currentVolume <= to)) {
                         clearInterval(audio.fadeInterval);
                        audio.volume = to;
                        if (to === 0) {
                            audio.pause();
                            if (!audio.loop) { audio.currentTime = 0; }
                        }
                        if (onComplete) onComplete();
                    } else {
                         audio.volume = currentVolume;
                    }
                }, interval);
            }

            // === KẾT THÚC KHU VỰC ÂM THANH ===

            function showToast(message, duration = 3500) {
                const toast = document.getElementById('toast-message');
                if (!toast) return;
                toast.textContent = message;
                toast.classList.add('show');
                setTimeout(() => {
                    toast.classList.remove('show');
                }, duration);
            }

            // --- NÂNG CẤP: Đã xóa mảng 'places' cố định ra khỏi đây ---


            // ==========================================================
            // V-MAPVIDEO 1.3 — GPS / TIMELINE ENGINE
            //
            // Một tuyến = một video YouTube đầy đủ.
            // points.tRaw = thời gian GPS gốc kể từ lúc bắt đầu quay.
            // timelineEdits = các đoạn hậu kỳ bị rút ngắn (ví dụ đèn đỏ).
            // Khi bấm vệt đường, V-Map tự đổi tRaw -> thời gian video thành phẩm.
            // ==========================================================
            const routeVideoMatchRadiusMeters = 180;
            const routeVideoMaxCandidateCount = 3;

            function escapeHtml(value) {
                return String(value ?? '')
                    .replaceAll('&', '&amp;')
                    .replaceAll('<', '&lt;')
                    .replaceAll('>', '&gt;')
                    .replaceAll('"', '&quot;')
                    .replaceAll("'", '&#039;');
            }

            function haversineMeters(a, b) {
                const R = 6371000;
                const toRad = d => d * Math.PI / 180;
                const dLat = toRad(b[1] - a[1]);
                const dLng = toRad(b[0] - a[0]);
                const lat1 = toRad(a[1]);
                const lat2 = toRad(b[1]);
                const h = Math.sin(dLat / 2) ** 2 +
                    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
                return 2 * R * Math.asin(Math.sqrt(h));
            }

            function normalizeTimelineEdits(edits) {
                if (!Array.isArray(edits)) return [];
                const normalized = edits.map((edit, index) => {
                    const start = Number(edit.start ?? edit.from ?? edit.startRaw);
                    const end = Number(edit.end ?? edit.to ?? edit.endRaw);
                    const keep = Number(edit.keepSeconds ?? edit.keep ?? 0);
                    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(keep)) {
                        console.warn(`V-MapVideo: bỏ timelineEdit #${index + 1} vì dữ liệu không hợp lệ.`);
                        return null;
                    }
                    if (start < 0 || end <= start || keep < 0 || keep > (end - start)) {
                        console.warn(`V-MapVideo: bỏ timelineEdit #${index + 1} vì khoảng thời gian không hợp lệ.`);
                        return null;
                    }
                    return { start, end, keepSeconds: keep, label: edit.label || '' };
                }).filter(Boolean).sort((a, b) => a.start - b.start);

                const clean = [];
                normalized.forEach(edit => {
                    const previous = clean[clean.length - 1];
                    if (previous && edit.start < previous.end) {
                        console.warn("V-MapVideo: bỏ timelineEdit chồng lấn:", edit);
                        return;
                    }
                    clean.push(edit);
                });
                return clean;
            }

            function rawTimeToVideoTime(rawTime, edits) {
                const t = Math.max(0, Number(rawTime) || 0);
                let removedBefore = 0;

                for (const edit of normalizeTimelineEdits(edits)) {
                    const originalDuration = edit.end - edit.start;
                    const removed = originalDuration - edit.keepSeconds;

                    if (t >= edit.end) {
                        removedBefore += removed;
                        continue;
                    }
                    if (t > edit.start && t < edit.end) {
                        const ratio = (t - edit.start) / originalDuration;
                        return Math.max(0, edit.start - removedBefore + ratio * edit.keepSeconds);
                    }
                    if (t === edit.end) {
                        return Math.max(0, edit.start - removedBefore + edit.keepSeconds);
                    }
                    if (t <= edit.start) break;
                }
                return Math.max(0, t - removedBefore);
            }

            function getPointRawTime(point) {
                const value = point?.tRaw ?? point?.rawTime ?? point?.sourceTime ?? point?.t ?? point?.time ?? 0;
                return Math.max(0, Number(value) || 0);
            }

            function getPointCoords(point) {
                const coords = Array.isArray(point?.coords)
                    ? point.coords
                    : [Number(point?.lng), Number(point?.lat)];
                if (!Number.isFinite(Number(coords[0])) || !Number.isFinite(Number(coords[1]))) return null;
                return [Number(coords[0]), Number(coords[1])];
            }

            function getVideoTimeForMatch(route, point) {
                const explicit = Number(point?.tVideo ?? point?.videoTime);
                if (Number.isFinite(explicit) && explicit >= 0) return explicit;
                return rawTimeToVideoTime(getPointRawTime(point), route?.timelineEdits);
            }

            function normalizeYouTubeVideoId(urlOrId) {
                if (!urlOrId) return null;
                let value = String(urlOrId).trim();
                try {
                    if (value.includes('youtube.com') || value.includes('youtu.be')) {
                        const u = new URL(value, window.location.href);
                        if (u.hostname.includes('youtu.be')) {
                            value = u.pathname.replace(/^\/+/, '').split('/')[0];
                        } else if (u.pathname.startsWith('/embed/')) {
                            value = u.pathname.split('/embed/')[1].split('/')[0];
                        } else if (u.pathname.startsWith('/shorts/')) {
                            value = u.pathname.split('/shorts/')[1].split('/')[0];
                        } else {
                            value = u.searchParams.get('v') || value;
                        }
                    }
                } catch (e) {}
                if (value.includes('/')) value = value.split('/').pop().split('?')[0];
                value = value.split('&')[0].trim();
                if (!value || value === 'your_youtube_embed_link' || value === 'PUT_YOUTUBE_VIDEO_ID_HERE') return null;
                return value;
            }

            function buildYouTubeUrls(urlOrId, startSeconds = 0) {
                const id = normalizeYouTubeVideoId(urlOrId);
                if (!id) return null;
                const start = Math.max(0, Math.floor(Number(startSeconds) || 0));
                return {
                    id,
                    embed: `https://www.youtube.com/embed/${encodeURIComponent(id)}?start=${start}&autoplay=1&playsinline=1&rel=0`,
                    watch: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&t=${start}s`
                };
            }

            function findRouteVideoCandidates(lngLat) {
                if (!Array.isArray(routeVideos) || !routeVideos.length) return [];
                const clicked = [lngLat.lng, lngLat.lat];
                const candidates = [];

                routeVideos.forEach((route, routeIndex) => {
                    if (!route || route.enabled === false || !Array.isArray(route.points) || !route.points.length) return;
                    let bestForRoute = null;

                    route.points.forEach((point, pointIndex) => {
                        const coords = getPointCoords(point);
                        if (!coords) return;
                        const distance = haversineMeters(clicked, coords);
                        if (!bestForRoute || distance < bestForRoute.distance) {
                            bestForRoute = {
                                route, point, coords, distance, routeIndex, pointIndex,
                                rawTime: getPointRawTime(point),
                                videoTime: getVideoTimeForMatch(route, point)
                            };
                        }
                    });

                    if (!bestForRoute) return;
                    const routeRadius = Number(route.matchRadiusMeters);
                    const effectiveRadius = Number.isFinite(routeRadius) && routeRadius > 0
                        ? routeRadius : routeVideoMatchRadiusMeters;
                    if (bestForRoute.distance <= effectiveRadius) candidates.push(bestForRoute);
                });

                return candidates.sort((a, b) => {
                    const pa = Number(a.route.priority) || 0;
                    const pb = Number(b.route.priority) || 0;
                    if (pa !== pb) return pb - pa;
                    return a.distance - b.distance;
                }).slice(0, routeVideoMaxCandidateCount);
            }

            function getCurrentDestinationLabel() {
                const destinationInput = document.querySelector('.mapbox-directions-destination input');
                const text = destinationInput?.value?.trim();
                return text || 'điểm B';
            }

            function buildRouteVideoActionLabel(match) {
                const destination = escapeHtml(getCurrentDestinationLabel());
                const routeDestination = String(match?.route?.destinationName || '').trim();

                // Chỉ gọi đích theo metadata video nếu dữ liệu route có khai báo rõ.
                // Nếu chưa khai báo, dùng tên điểm B hiện tại cho câu chữ giao diện,
                // nhưng không coi đó là bằng chứng video thật sự đi đến B.
                if (routeDestination) {
                    return `Xem từ đây → ${escapeHtml(routeDestination)}`;
                }
                return `Xem từ đây → ${destination}`;
            }

            function formatSeconds(seconds) {
                const total = Math.max(0, Math.floor(Number(seconds) || 0));
                const h = Math.floor(total / 3600);
                const m = Math.floor((total % 3600) / 60);
                const s = total % 60;
                return h > 0
                    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
                    : `${m}:${String(s).padStart(2, '0')}`;
            }

            function openMatchedRouteVideo(match, lngLat) {
                const videoSource = match.route.youtube || match.route.videoId || match.route.video;
                const urls = buildYouTubeUrls(videoSource, match.videoTime);
                if (!urls) {
                    showToast("⚠️ Tuyến này chưa có YouTube video hợp lệ.");
                    return;
                }

                const routeName = escapeHtml(match.route.name || "Video hướng dẫn");
                const rawText = formatSeconds(match.rawTime);
                const videoText = formatSeconds(match.videoTime);
                const distanceText = Math.round(match.distance);
                const cutCount = normalizeTimelineEdits(match.route.timelineEdits).length;
                const actionLabel = buildRouteVideoActionLabel(match);
                const destinationVerified = Boolean(String(match.route.destinationName || '').trim());

                const popupContent = `
                    <div class="route-video-popup">
                        <div class="route-video-title">🎬 ${actionLabel}</div>
                        <div class="route-video-meta">
                            Tuyến video: ${routeName}<br>
                            Bắt đầu tại ${videoText} • lệch GPS ~${distanceText} m
                            ${cutCount ? `<br>Đã áp dụng ${cutCount} đoạn hậu kỳ` : ''}
                            ${destinationVerified ? '' : '<br><span class="route-video-note">Đích video chưa được xác nhận bằng metadata; hãy khai báo destinationName trong route-videos.json.</span>'}
                        </div>
                        <iframe
                            src="${urls.embed}"
                            title="${routeName}"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowfullscreen loading="lazy"></iframe>
                        <a class="route-video-youtube-link" href="${urls.watch}" target="_blank" rel="noopener noreferrer">
                            Mở đúng đoạn này trên YouTube ↗
                        </a>
                    </div>`;

                if (activePopup) activePopup.remove();
                activePopup = new mapboxgl.Popup({
                    maxWidth: '360px',
                    closeButton: true,
                    closeOnClick: false
                }).setLngLat(lngLat).setHTML(popupContent).addTo(map);
                activePopup.on('close', () => { activePopup = null; });
            }

            function openRouteVideoFallback(lngLat) {
                const channelUrl = "https://www.youtube.com/@dunguyen-r3v";
                const popupContent = `
                    <div class="route-video-popup">
                        <div class="route-video-title">🎬 Xem từ đây → ${escapeHtml(getCurrentDestinationLabel())}</div>
                        <div class="route-video-meta">
                            Chưa có GPS-video xác nhận cho hành trình này. Liên kết dưới đây chỉ là kênh YouTube dự phòng, không được coi là video hướng dẫn đến điểm B.
                        </div>
                        <a class="route-video-youtube-link" href="${channelUrl}" target="_blank" rel="noopener noreferrer">
                            Mở kênh YouTube ↗
                        </a>
                    </div>`;
                if (activePopup) activePopup.remove();
                activePopup = new mapboxgl.Popup({
                    maxWidth: '360px',
                    closeButton: true,
                    closeOnClick: false
                }).setLngLat(lngLat).setHTML(popupContent).addTo(map);
                activePopup.on('close', () => { activePopup = null; });
            }

            function openRouteVideoAtClick(lngLat) {
                const candidates = findRouteVideoCandidates(lngLat);
                if (!candidates.length) {
                    openRouteVideoFallback(lngLat);
                    return;
                }
                if (candidates.length === 1) {
                    openMatchedRouteVideo(candidates[0], lngLat);
                    return;
                }

                const choices = candidates.map((match, index) => {
                    const name = escapeHtml(match.route.name || `Tuyến ${index + 1}`);
                    const direction = match.route.direction ? ` • ${escapeHtml(match.route.direction)}` : '';
                    return `
                        <button class="route-candidate-btn" data-candidate-index="${index}">
                            <strong>${name}</strong>${direction}
                            <span>video ${formatSeconds(match.videoTime)} • lệch ~${Math.round(match.distance)} m</span>
                        </button>`;
                }).join('');

                if (activePopup) activePopup.remove();
                activePopup = new mapboxgl.Popup({
                    maxWidth: '360px',
                    closeButton: true,
                    closeOnClick: false
                }).setLngLat(lngLat).setHTML(`
                    <div class="route-candidate-picker">
                        <div class="route-video-title">🎬 Chọn đúng hướng video</div>
                        <div class="route-video-meta">Có nhiều tuyến GPS gần vị trí này.</div>
                        ${choices}
                    </div>`).addTo(map);

                const popupEl = activePopup.getElement();
                popupEl.querySelectorAll('.route-candidate-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const selected = candidates[Number(btn.dataset.candidateIndex)];
                        if (selected) openMatchedRouteVideo(selected, lngLat);
                    });
                });
                activePopup.on('close', () => { activePopup = null; });
            }

            function validateRouteVideoData(routes) {
                const issues = [];
                routes.forEach((route, index) => {
                    if (!route || typeof route !== 'object') {
                        issues.push(`Tuyến #${index + 1}: không phải object.`);
                        return;
                    }
                    if (!route.name) issues.push(`Tuyến #${index + 1}: thiếu name.`);
                    if (!route.destinationName) {
                        console.info(`${route.name || `Tuyến #${index + 1}`}: nên thêm destinationName để xác nhận đích video.`);
                    }
                    if (!Array.isArray(route.points) || route.points.length < 2) {
                        issues.push(`${route.name || `Tuyến #${index + 1}`}: cần ít nhất 2 điểm GPS.`);
                    }
                    const edits = normalizeTimelineEdits(route.timelineEdits);
                    if (Array.isArray(route.timelineEdits) && edits.length !== route.timelineEdits.length) {
                        issues.push(`${route.name || `Tuyến #${index + 1}`}: có timelineEdits sai/chồng lấn.`);
                    }
                });
                return issues;
            }

            async function loadRouteVideos() {
                try {
                    const response = await fetch('route-videos.json', { cache: 'no-store' });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const data = await response.json();
                    routeVideos = Array.isArray(data) ? data : (Array.isArray(data.routes) ? data.routes : []);
                    const issues = validateRouteVideoData(routeVideos);
                    if (issues.length) console.warn("V-MapVideo route-videos.json:", issues);
                    console.log(`V-MapVideo 1.3: đã tải ${routeVideos.length} tuyến GPS-video.`);
                } catch (e) {
                    routeVideos = [];
                    console.warn("Chưa tải được route-videos.json:", e);
                }
            }

            function initMap() { 
                const configuredToken = typeof window.VMAP_MAPBOX_TOKEN === 'string'
                    ? window.VMAP_MAPBOX_TOKEN.trim()
                    : '';
                if (!configuredToken.startsWith('pk.')) {
                    const loader = document.getElementById('loader');
                    if (loader) loader.style.display = 'none';
                    showToast('⚠️ Chưa cấu hình Mapbox token. Xem README.md.');
                    console.error('V-MapVideo: thiếu window.VMAP_MAPBOX_TOKEN trong mapbox-token.js.');
                    return false;
                }
                mapboxgl.accessToken = configuredToken;
                const lastLng = localStorage.getItem('vmap_lng') || 106.6955;
                const lastLat = localStorage.getItem('vmap_lat') || 10.7769;
                const lastZoom = localStorage.getItem('vmap_zoom') || 14;
                map = new mapboxgl.Map({ 
                    container: 'map', 
                    projection: 'globe' ,
                    // Link style mới nhất của anh (V-MAPVIDEO-TEST)
                    style: 'mapbox://styles/taladu/cml928jj3004c01s95ns59gwa', 
                    center: [parseFloat(lastLng), parseFloat(lastLat)],
                    zoom: parseFloat(lastZoom),
                    pitch: 0, 
                    bearing: 0, 
                    antialias: true 
                });
                directions = new MapboxDirections({
                    accessToken: mapboxgl.accessToken,
                    unit: 'metric',
                    profile: 'mapbox/driving',
                    interactive: false, // 1.3.1: không cho click bản đồ tự dời A/B
                    controls: { instructions: true, profileSwitcher: false }
                }); 
                document.getElementById('directions-container').appendChild(directions.onAdd(map));
                return true;
            }
            
            function setupRouteControls() { function clearRoute() { directionsLocationRequestSeq++; directions.removeRoutes(); } document.getElementById("clearRouteBtn").onclick = clearRoute; }
            function setupDirectionsToggle() { const directionsContainer = document.getElementById('directions-container'); const showDirectionsBtn = document.getElementById('showDirectionsBtn'); showDirectionsBtn.addEventListener('click', () => { directionsContainer.classList.toggle('is-visible'); }); directions.on('clear', () => { directionsContainer.classList.remove('is-visible'); }); const observer = new MutationObserver(() => { const instructionsEl = directionsContainer.querySelector('.mapbox-directions-instructions'); if (instructionsEl && !instructionsEl.previousElementSibling?.classList.contains('directions-details-toggle')) { const toggleBtn = document.createElement('button'); toggleBtn.className = 'directions-details-toggle'; toggleBtn.textContent = '▼ Xem chi tiết chỉ đường'; instructionsEl.parentNode.insertBefore(toggleBtn, instructionsEl); toggleBtn.addEventListener('click', () => { instructionsEl.classList.toggle('is-expanded'); if (instructionsEl.classList.contains('is-expanded')) { toggleBtn.textContent = '▲ Ẩn chi tiết'; } else { toggleBtn.textContent = '▼ Xem chi tiết chỉ đường'; } }); } }); observer.observe(directionsContainer, { childList: true, subtree: true }); }

            // v19: đảo A/B bằng chính tọa độ số, không geocode lại chuỗi địa chỉ.
            function setupExactDirectionsReverse() {
                const cloneCoords = coords => isValidLngLat(coords) ? [Number(coords[0]), Number(coords[1])] : null;
                const coordsFromFeature = feature => cloneCoords(feature?.geometry?.coordinates);

                directions.on('origin', event => {
                    const coords = coordsFromFeature(event?.feature);
                    if (coords) exactDirectionsEndpoints.origin = coords;
                });
                directions.on('destination', event => {
                    const coords = coordsFromFeature(event?.feature);
                    if (coords) exactDirectionsEndpoints.destination = coords;
                });
                directions.on('clear', () => {
                    exactDirectionsEndpoints.origin = null;
                    exactDirectionsEndpoints.destination = null;
                });

                const bindReverseButton = () => {
                    // Mapbox GL Directions 4.1.1 dùng .js-reverse-inputs cho nút đảo A/B.
                    // Bắt ở capture phase để chặn handler gốc re-geocode hai đầu tuyến.
                    const button = document.querySelector('.js-reverse-inputs');
                    if (!button || button.dataset.vmapExactReverse === '1') return Boolean(button);
                    button.dataset.vmapExactReverse = '1';
                    button.addEventListener('click', event => {
                        const apiOrigin = typeof directions.getOrigin === 'function'
                            ? coordsFromFeature(directions.getOrigin()) : null;
                        const apiDestination = typeof directions.getDestination === 'function'
                            ? coordsFromFeature(directions.getDestination()) : null;
                        const origin = apiOrigin || cloneCoords(exactDirectionsEndpoints.origin);
                        const destination = apiDestination || cloneCoords(exactDirectionsEndpoints.destination);

                        // Thiếu một đầu thì để Mapbox xử lý như cũ, không làm thay đổi hành vi nhập liệu.
                        if (!origin || !destination) return;

                        event.preventDefault();
                        event.stopPropagation();
                        event.stopImmediatePropagation();

                        // Hủy GPS đang chờ để callback cũ không ghi đè A sau khi vừa đảo.
                        directionsLocationRequestSeq++;
                        exactDirectionsEndpoints.origin = destination.slice();
                        exactDirectionsEndpoints.destination = origin.slice();
                        directions.setOrigin(destination);
                        directions.setDestination(origin);
                        document.getElementById('directions-container').classList.add('is-visible');
                    }, true);
                    return true;
                };

                if (!bindReverseButton()) {
                    const container = document.getElementById('directions-container');
                    const observer = new MutationObserver(() => {
                        if (bindReverseButton()) observer.disconnect();
                    });
                    observer.observe(container, { childList: true, subtree: true });
                }
            }
            function setupUserLocation() {
                function locateUser() {
                    if (!navigator.geolocation) {
                        showToast("Trình duyệt của bạn không hỗ trợ định vị GPS.");
                        return;
                    }
                    navigator.geolocation.getCurrentPosition(pos => {
                        const lng = pos.coords.longitude;
                        const lat = pos.coords.latitude;
                        const coords = [lng, lat];
                        saveRecentUserLocation(coords);
                        if (!userMarker) {
                            userMarker = new mapboxgl.Marker({ color: "red" })
                                .setLngLat(coords)
                                .setPopup(new mapboxgl.Popup().setText("📍 Vị trí của bạn"))
                                .addTo(map);
                        } else {
                            userMarker.setLngLat(coords);
                        }
                        map.flyTo({ center: coords, zoom: 15 });
                    }, () => {
                        showToast("Lỗi: Không thể lấy được vị trí của bạn.");
                    }, LOCATE_BUTTON_OPTIONS);
                }
                document.getElementById("locateUserBtn").onclick = locateUser;
            }

            function handleGetDirections(destinationCoords) {
                if (!isValidLngLat(destinationCoords)) {
                    showToast("Điểm đến không hợp lệ.");
                    return;
                }

                const requestSeq = ++directionsLocationRequestSeq;
                const directionsContainer = document.getElementById('directions-container');
                const cachedCoords = readRecentUserLocation();

                // Không chờ GPS: hiển thị B và thanh chỉ đường ngay khi người dùng chạm.
                directions.setDestination(destinationCoords);
                directionsContainer.classList.add('is-visible');

                if (cachedCoords) {
                    directions.setOrigin(cachedCoords);
                }

                if (!navigator.geolocation) {
                    if (!cachedCoords) showToast("Trình duyệt không hỗ trợ định vị. Anh nhập điểm A thủ công.");
                    return;
                }

                navigator.geolocation.getCurrentPosition(pos => {
                    if (requestSeq !== directionsLocationRequestSeq) return;
                    const liveCoords = [pos.coords.longitude, pos.coords.latitude];
                    if (!isValidLngLat(liveCoords)) return;
                    saveRecentUserLocation(liveCoords);

                    // Chỉ cập nhật lại tuyến khi GPS mới khác đáng kể, tránh vệt đường nháy/vẽ kép.
                    if (!cachedCoords || locationDistanceMeters(cachedCoords, liveCoords) > 25) {
                        directions.setOrigin(liveCoords);
                    }
                }, () => {
                    if (requestSeq !== directionsLocationRequestSeq) return;
                    if (!cachedCoords) {
                        showToast("Chưa lấy được vị trí. Anh có thể nhập điểm A thủ công.");
                    }
                }, ROUTE_LOCATION_OPTIONS);
            }            
            // Lưu ý: Hàm này giờ phụ thuộc vào biến 'places' được tải từ JSON
            function addCustomLayers() { 
                const styleLayers = map.getStyle()?.layers || [];
                const labelLayerId = styleLayers.find(layer =>
                    layer.type === 'symbol' && layer.layout && layer.layout['text-field']
                )?.id;
                try { if (map.getSource('composite') && map.getSource('composite').vectorLayerIds.includes('building')) { if (!map.getLayer('3d-buildings')) { map.addLayer({ 'id': '3d-buildings', 'source': 'composite', 'source-layer': 'building', 'filter': ['==', 'extrude', 'true'], 'type': 'fill-extrusion', 'minzoom': 15, 'paint': { 'fill-extrusion-color': '#aaa', 'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'height']], 'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'min_height']], 'fill-extrusion-opacity': 1 } }, labelLayerId); } } } catch(e) { console.warn("Style không hỗ trợ lớp 3D buildings."); } 
                
                // Sử dụng biến 'places' đã được tải
                const geojson = { 'type': 'FeatureCollection', 'features': places.map(p => ({ 'type': 'Feature', 'properties': { 'name': p.name, 'youtube': p.youtube, 'category': p.category }, 'geometry': { 'type': 'Point', 'coordinates': p.coords } })) }; 
                
                map.loadImage(iconUrl, (error, image) => { if (error) throw error; if (!map.hasImage('place-icon')) { map.addImage('place-icon', image); } if (map.getSource('places-source')) { map.getSource('places-source').setData(geojson); } else { map.addSource('places-source', { type: 'geojson', data: geojson, cluster: true, clusterMaxZoom: 14, clusterRadius: 50 }); } if (!map.getLayer('clusters')) { map.addLayer({ id: 'clusters', type: 'circle', source: 'places-source', filter: ['has', 'point_count'], paint: { 'circle-color': ['step', ['get', 'point_count'], '#51bbd6', 100, '#f1f075', 750, '#f28cb1'], 'circle-radius': ['step', ['get', 'point_count'], 20, 100, 30, 750, 40] } }); } if (!map.getLayer('cluster-count')) { map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'places-source', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'], 'text-size': 12 } }); } if (!map.getLayer('unclustered-point')) { map.addLayer({ id: 'unclustered-point', type: 'symbol', source: 'places-source', filter: ['!', ['has', 'point_count']], layout: { 'icon-image': 'place-icon', 'icon-size': 0.06 } }); } }); 
            }
            
            // ==========================================================
            // HÀM triggerFlycamAnimation (ĐÃ NÂNG CẤP LAZY-LOAD)
            // ==========================================================
            function triggerFlycamAnimation(place) {
                const customPopup = document.getElementById('custom-popup');
                const customPopupContent = document.getElementById('custom-popup-content');
                const flycamIcon = document.getElementById('flycam-icon');
                const ripple = document.getElementById('ripple-effect');

                if (window.vMapIsAnimating) return;
                window.vMapIsAnimating = true;
                fadeAudio(flightSound, { to: 0.6, duration: 300 });
                // === TỰ ĐỘNG THU GỌN THANH TRƯỢT KHI FLYCAM BẮT ĐẦU BAY ===
const bottomPanel = document.getElementById('bottomPanel');
const fabWrappers = document.querySelectorAll('.fab-btn-wrapper');
bottomPanel.style.transition = 'transform 0.6s cubic-bezier(0.25, 0.8, 0.25, 1)';
bottomPanel.style.transform = 'translateY(calc(90vh - 40px))'; // Thu gọn gần như ẩn
// Giữ các nút A/B, định vị và 3D/2D luôn rõ khi popup video đang mở.
fabWrappers.forEach(btn => btn.classList.remove('is-faded'));

                flycamIcon.className = 'is-hovering';
                const animatePopup = () => {
                    const centerScreenPos = { x: map.getCanvas().width / 2, y: map.getCanvas().height / 2 };
                    customPopup.style.transform = `translate(${centerScreenPos.x - customPopup.clientWidth / 2}px, ${centerScreenPos.y - customPopup.clientHeight / 2}px)`;
                };

                // --- BẮT ĐẦU NÂNG CẤP LAZY-LOAD YOUTUBE ---
                const videoID = place.youtube.split('/').pop().split('?')[0];
                const thumbnailUrl = `https://img.youtube.com/vi/${videoID}/hqdefault.jpg`;
                
                customPopupContent.innerHTML = `
                    <button class="custom-popup-close-btn">&times;</button>
                    <h3>${place.name}</h3>
                    <div class="youtube-placeholder" data-youtube-src="${place.youtube}">
                        <img src="${thumbnailUrl}" alt="Video thumbnail for ${place.name}">
                        <div class="play-button-overlay"></div>
                    </div>
                    <div class="popup-actions">
                        <button class="directions-btn" data-coords="${place.coords.join(',')}">📍 Dẫn đường đến đây</button>
                    </div>`;
                // --- KẾT THÚC NÂNG CẤP ---


                // --- BẮT ĐẦU THÊM TRÌNH XỬ LÝ CLICK ---
                const placeholder = customPopupContent.querySelector('.youtube-placeholder');
                if (placeholder) {
                    placeholder.addEventListener('click', function() {
                        const embedUrl = this.getAttribute('data-youtube-src');
                        let autoplayUrl = embedUrl;
                        if (embedUrl.includes('?')) {
                            autoplayUrl += '&autoplay=1&mute=1';
                        } else {
                            autoplayUrl += '?autoplay=1&mute=1';
                        }
                        
                        const iframe = document.createElement('iframe');
                        iframe.setAttribute('src', autoplayUrl);
                        iframe.setAttribute('frameborder', '0');
                        iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
                        iframe.setAttribute('allowfullscreen', 'true');
                        iframe.style.width = '100%';
                        iframe.style.height = '150px';
                        iframe.style.display = 'block';
                        iframe.style.border = 'none';

                        this.parentNode.replaceChild(iframe, this);
                    }, { once: true });
                }
                // --- KẾT THÚC THÊM TRÌNH XỬ LÝ CLICK ---

                customPopup.querySelector('.custom-popup-close-btn').addEventListener('click', () => {
                    customPopup.style.display = 'none';
                    window.vMapIsAnimating = false;
                    fadeAudio(flightSound, { to: 0, duration: 300 });
 // === HIỆN LẠI THANH TRƯỢT KHI FLYCAM DỪNG ===
bottomPanel.style.transform = 'translateY(calc(90vh - 60px))';
fabWrappers.forEach(btn => btn.classList.remove('is-faded'));

                });
                customPopup.style.display = 'block';
                requestAnimationFrame(() => { customPopup.style.opacity = '1'; animatePopup(); });
                
                map.on('move', animatePopup);
                map.once('moveend', () => {
                    map.off('move', animatePopup); 
                    fadeAudio(flightSound, { to: 0, duration: 300 });
                    flycamIcon.className = 'is-dropping';
                    const targetScreenPos = map.project(place.coords);
                    playLandingSoundSpatially(targetScreenPos.x);
                    customPopup.style.transform = `translate(${targetScreenPos.x - customPopup.clientWidth / 2}px, ${targetScreenPos.y - customPopup.clientHeight}px) scale(1)`;
                    ripple.style.left = `${targetScreenPos.x}px`;
                    ripple.style.top = `${targetScreenPos.y}px`;
                    ripple.classList.add('play');
                    ripple.addEventListener('animationend', () => { ripple.classList.remove('play'); }, { once: true });

                    customPopup.querySelector('.directions-btn').addEventListener('click', (e) => {
                        const coordsString = e.target.getAttribute('data-coords');
                        const coords = coordsString.split(',').map(Number);
                        handleGetDirections(coords);
                        customPopup.style.display = 'none';
                        window.vMapIsAnimating = false;
                    });
                    setTimeout(() => { window.vMapIsAnimating = false; }, 600);
                });

                map.flyTo({ center: place.coords, zoom: 16, pitch: 70, bearing: -30, speed: 0.4, curve: 1.8, easing: (t) => t * t });
            }

            function setupSearchFilter() {
                const searchInput = document.getElementById('searchInput');
                const locationsContainer = document.getElementById('locationsList');

                searchInput.addEventListener('input', function() {
                    const searchTerm = this.value.toLowerCase().trim();
                    const categories = locationsContainer.querySelectorAll('.category-title');

                    categories.forEach(categoryTitle => {
                        const itemsContainer = categoryTitle.nextElementSibling;
                        const items = itemsContainer.querySelectorAll('.location-item');
                        let visibleItemsInCategory = 0;

                        items.forEach(item => {
                            const itemName = item.querySelector('h4').textContent.toLowerCase();
                            if (itemName.includes(searchTerm)) {
                                item.style.display = 'flex';
                                visibleItemsInCategory++;
                            } else {
                                item.style.display = 'none';
                            }
                        });
                        if (visibleItemsInCategory > 0) {
                            categoryTitle.style.display = 'flex';
                            if (searchTerm) {
                                itemsContainer.style.display = 'block';
                                categoryTitle.querySelector('span').textContent = '▼';
                            }
                        } else {
                            categoryTitle.style.display = 'none';
                            itemsContainer.style.display = 'none';
                        }
                    });
                });
            }
            
            function setupPlacesAndFilters() { 
                // --- BẢN FULL SẠCH SẼ: CHỐNG LỖI MÀN HÌNH TRẮNG & CHE CHỮ ---
                
                // 1. Định nghĩa công việc cần làm khi Map đã tải xong
                const onMapLoaded = () => { 
                    // a. TẮT NGAY CÁI VÒNG XOAY (Quan trọng nhất)
                    const loader = document.getElementById('loader');
                    if (loader) {
                        loader.style.opacity = '0'; 
                        setTimeout(() => { loader.style.display = 'none'; }, 500); 
                    }

                    // b. Lưu vị trí khi di chuyển map
                    map.on('moveend', () => {
                        const center = map.getCenter();
                        localStorage.setItem('vmap_lng', center.lng);
                        localStorage.setItem('vmap_lat', center.lat);
                        localStorage.setItem('vmap_zoom', map.getZoom());
                    });

                    // c. Cấu hình độ đậm nhạt
                    if (map.getLayer('building')) { map.setPaintProperty('building', 'fill-opacity', 0.65); }
                    const styleLayers = map.getStyle().layers;
                    if (styleLayers) {
                        const landuseLayers = styleLayers.filter(layer => layer['source-layer'] === 'landuse');
                        landuseLayers.forEach(layer => {
                            if (layer.type === 'fill') { map.setPaintProperty(layer.id, 'fill-opacity', 0.75); }
                        });
                    }
                    
                    addCustomLayers(); 
                    
                    // d. Các sự kiện Click/Hover
                    map.on('click', 'clusters', (e) => { 
                        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] }); 
                        const clusterId = features[0].properties.cluster_id; 
                        map.getSource('places-source').getClusterExpansionZoom(clusterId, (err, zoom) => { 
                             if (err) return; 
                            map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom }); 
                        }); 
                     }); 
                    
                    map.on('click', 'unclustered-point', (e) => { 
                        const place = { name: e.features[0].properties.name, youtube: e.features[0].properties.youtube, coords: e.features[0].geometry.coordinates.slice() }; 
                        triggerFlycamAnimation(place); 
                    });
                    
                    map.on('mouseenter', ['clusters', 'unclustered-point'], () => { map.getCanvas().style.cursor = 'pointer'; }); 
                    map.on('mouseleave', ['clusters', 'unclustered-point'], () => { map.getCanvas().style.cursor = ''; });

                    // 1.3.1 HOTFIX:
                    // Mapbox Directions có thể tạo các layer id khác nhau tùy phiên bản/style
                    // (directions-route-line, directions-route-line-alt, casing...).
                    // Bắt click ở cấp map rồi kiểm tra mọi layer directions-route* đang render.
                    const getRouteHitAtPoint = (point) => {
                        const style = map.getStyle();
                        if (!style || !Array.isArray(style.layers)) {
                            return { directionsFeature: null, gpsFeature: null };
                        }

                        const directionsLayerIds = style.layers
                            .map(layer => layer.id)
                            .filter(id => typeof id === 'string' && id.startsWith('directions-route'));
                        const gpsLayerIds = ['vmap-gps-video-hit', 'vmap-gps-video-line']
                            .filter(id => map.getLayer(id));

                        let directionsFeature = null;
                        let gpsFeature = null;
                        try {
                            if (directionsLayerIds.length) {
                                let features = map.queryRenderedFeatures(point, { layers: directionsLayerIds });
                                if (!features.length && Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
                                    features = map.queryRenderedFeatures(
                                        [[point.x - 6, point.y - 6], [point.x + 6, point.y + 6]],
                                        { layers: directionsLayerIds }
                                    );
                                }
                                directionsFeature = features[0] || null;
                            }
                            if (gpsLayerIds.length) {
                                gpsFeature = map.queryRenderedFeatures(point, { layers: gpsLayerIds })[0] || null;
                            }
                        } catch (_) {}

                        return { directionsFeature, gpsFeature };
                    };

                    map.on('click', (e) => {
                        const hit = getRouteHitAtPoint(e.point);
                        if (!hit.directionsFeature && !hit.gpsFeature) return;
                        playTapFeedback();
                        const overlay = window.VMAP_GPS_VIDEO_OVERLAY;
                        if (overlay && typeof overlay.handleMapClick === 'function') {
                            const renderedRouteCoords = hit.directionsFeature?.geometry?.type === 'LineString'
                                ? hit.directionsFeature.geometry.coordinates : null;
                            Promise.resolve(overlay.handleMapClick({ ...e, renderedRouteCoords })).catch(error => {
                                console.warn('GPS-video route click failed:', error);
                            });
                            return;
                        }
                        console.warn('GPS-video overlay unavailable; route click ignored.');
                    });

                    map.on('mousemove', (e) => {
                        const hit = getRouteHitAtPoint(e.point);
                        if (hit.directionsFeature || hit.gpsFeature) {
                            map.getCanvas().style.cursor = 'pointer';
                        }
                    });

                    // e. CODE ĐA NĂNG: Xử lý vệt chỉ đường không che chữ (Cân mọi bản đồ)
                    directions.on('route', () => {
                        const style = map.getStyle();
                        if (!style || !style.layers) return;
                        // Kiểm tra bản đồ mới hay cũ
                        const isStandard = style.imports && style.imports.length > 0; 
                        
                        if (isStandard) { // Bản đồ mới (Standard) -> Dùng Slot
                             style.layers.forEach(layer => {
                                if (layer.id.startsWith('directions-route')) {
                                    if (layer.slot !== 'middle') {
                                        map.removeLayer(layer.id);
                                        layer.slot = 'middle'; map.addLayer(layer);
                                    }
                                }
                            });
                        } else { // Bản đồ cũ -> Dùng MoveLayer
                            let labelLayerId = style.layers.find(l => l.id === 'road-label')?.id || style.layers.find(l => l.type === 'symbol')?.id;
                            if (labelLayerId) {
                                style.layers.forEach(layer => {
                                    if (layer.id.startsWith('directions-')) {
                                        try { map.moveLayer(layer.id, labelLayerId); } catch (e) {}
                                    }
                                });
                            }
                        }
                    });
                }; 

                // 2. KÍCH HOẠT THÔNG MINH (CHỐNG TREO MÀN HÌNH)
                if (map.loaded()) {
                    onMapLoaded();
                } else {
                    map.on('load', onMapLoaded);
                    // Báo thức: Quá 3 giây mà chưa xong thì cứ tắt màn hình trắng đi!
                    setTimeout(() => {
                        const loader = document.getElementById('loader');
                        if (loader && loader.style.opacity !== '0') {
                            console.log("Map tải lâu, cưỡng chế tắt Loader!");
                            loader.style.opacity = '0';
                            setTimeout(() => { loader.style.display = 'none'; }, 500);
                            // addCustomLayers(); 
                        }
                    }, 3000);
                }
            }
                
            
                // --- HẾT FIX ---
            
            
            // Hàm này cũng phụ thuộc vào 'places'
            function createLocationList() { 
                const locationsListDiv = document.getElementById('locationsList');
                locationsListDiv.innerHTML = ''; 
                const groupedPlaces = places.reduce((groups, place) => { const category = place.category || 'Khác'; if (!groups[category]) groups[category] = []; groups[category].push(place); return groups; }, {});
                for (const category in groupedPlaces) { 
                    const categoryGroup = document.createElement('div');
                    const categoryTitle = document.createElement('h3'); 
                    categoryTitle.className = 'category-title';
                    categoryTitle.innerHTML = `${category} <span>▶</span>`; 
                    const itemsContainer = document.createElement('div'); 
                    itemsContainer.className = 'location-items-container';
                    groupedPlaces[category].forEach(place => { 
                        const listItem = document.createElement('div'); 
                        listItem.className = 'location-item'; 
                        listItem.innerHTML = `<img src="${iconUrl}" alt="icon"><h4>${place.name}</h4>`; 
                         listItem.addEventListener('click', () => { triggerFlycamAnimation(place); }); 
                        itemsContainer.appendChild(listItem); 
                    });
                    categoryGroup.appendChild(categoryTitle); 
                    categoryGroup.appendChild(itemsContainer); 
                    locationsListDiv.appendChild(categoryGroup); 
                } 
                map.on('dragstart', () => { const customPopup = document.getElementById('custom-popup'); if (!window.vMapIsAnimating) { customPopup.style.display = 'none'; } });
                document.querySelectorAll('.category-title').forEach(title => { 
                    title.addEventListener('click', () => { 
                        const itemsContainer = title.nextElementSibling; 
                        const arrow = title.querySelector('span'); 
                         if (itemsContainer && itemsContainer.classList.contains('location-items-container')) { 
                            const isVisible = itemsContainer.style.display === 'block'; 
                            itemsContainer.style.display = isVisible ? 'none' : 'block'; 
                             arrow.textContent = isVisible ? '▶' : '▼'; 
                        } 
                    }); 
                });
            }
            
            function initPanelDrag() { 
                const panel = document.getElementById('bottomPanel');
                const handle = panel.querySelector('.panel-header'); 
                const fabWrappers = document.querySelectorAll('.fab-btn-wrapper'); 
                const youtubeLinks = document.querySelector('.youtube-links-overlay'); 
                let dragging = false, startY, startTransformY;
                let currentY = 0; 
                let animationFrameId = null; 
                let panelHeight, snapPosFull, snapPosHalf, snapPosCollapsed; 
                const collapsedHeight = 60;
                function calculateSnapPositions() { 
                    panelHeight = panel.clientHeight;
                    snapPosFull = 0; 
                    snapPosHalf = panelHeight - window.innerHeight * 0.4;
                    snapPosCollapsed = panelHeight - collapsedHeight;
                } 
                
                const updatePositions = () => { 
                    panel.style.transform = `translateY(${currentY}px)`;
                    const panelTop = panel.getBoundingClientRect().top;
                    const visibleHeight = window.innerHeight - panelTop; 
                    const fabOffset = Math.max(0, visibleHeight - 20);
                    fabWrappers.forEach(wrapper => { 
                        if (wrapper.id === 'showDirectionsBtnWrapper') { wrapper.style.transform = `translateY(-${fabOffset + 120}px)`; } 
                        else if (wrapper.id === 'locateUserBtnWrapper') { wrapper.style.transform = `translateY(-${fabOffset + 60}px)`; } 
                        else if (wrapper.id === 'toggle3DBtnWrapper') { wrapper.style.transform = `translateY(-${fabOffset}px)`; } 
                    });
                    youtubeLinks.style.transform = `translateY(-${fabOffset}px)`; 
                    animationFrameId = null; 
                }; 
                
                const onDown = (e) => { 
                    e.preventDefault();
                    dragging = true;
                    startY = e.pageY || e.touches[0].pageY; 
                    calculateSnapPositions(); 
                    startTransformY = (panel.style.transform.match(/-?[\d\.]+/g) || [snapPosCollapsed])[0] * 1; 
                    panel.style.transition = 'none';
                    fabWrappers.forEach(w => w.style.transition = 'none'); 
                    youtubeLinks.style.transition = 'none'; 
                }; 
                
                const onMove = (e) => { 
                    if (!dragging) return;
                    const newY = e.pageY || e.touches[0].pageY; 
                    const delta = newY - startY; 
                    currentY = startTransformY + delta;
                    if (currentY < snapPosFull) { currentY = snapPosFull; } 
                    if (!animationFrameId) { animationFrameId = requestAnimationFrame(updatePositions); } 
                };
                const onUp = () => { 
                    if (!dragging) return;
                    dragging = false; 
                    cancelAnimationFrame(animationFrameId);
                    panel.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)';
                    fabWrappers.forEach(w => w.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)');
                    youtubeLinks.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)'; 
                    const positions = [snapPosFull, snapPosHalf, snapPosCollapsed];
                    const closest = positions.reduce((prev, curr) => (Math.abs(curr - currentY) < Math.abs(prev - currentY) ? curr : prev)); 
                    currentY = closest;
                    updatePositions(); 
                    
                    if (closest === snapPosFull) { 
                        document.getElementById('mapContainer').classList.add('is-dimmed');
                        fabWrappers.forEach(w => {
                            if (w.id !== 'toggle3DBtnWrapper') w.classList.add('is-faded');
                        });
                    } else { 
                        document.getElementById('mapContainer').classList.remove('is-dimmed');
                        fabWrappers.forEach(w => w.classList.remove('is-faded'));
                    } 
                };
                handle.addEventListener('mousedown', onDown); 
                document.addEventListener('mousemove', onMove); 
                document.addEventListener('mouseup', onUp);
                window.addEventListener('mouseleave', onUp); 
                handle.addEventListener('touchstart', onDown, { passive: false }); 
                document.addEventListener('touchmove', onMove, { passive: false });
                document.addEventListener('touchend', onUp); 
                document.addEventListener('touchcancel', onUp);
                window.addEventListener('resize', () => { calculateSnapPositions(); requestAnimationFrame(updatePositions); });
            }
            
            function setup3DToggle() { 
                const toggleBtn = document.getElementById('toggle3DBtn');
                let is3D = false; 
                toggleBtn.addEventListener('click', () => { 
                    is3D = !is3D; 
                    if (is3D) { 
                        map.easeTo({ pitch: 60, bearing: -15, duration: 1000 }); 
                        toggleBtn.textContent = '2D'; 
                        if (map.getLayer('3d-buildings')) { map.setPaintProperty('3d-buildings', 'fill-extrusion-opacity', 0.6); } 
                    } else { 
                        map.easeTo({ pitch: 0, bearing: 0, duration: 1000 }); 
                        toggleBtn.textContent = '3D'; 
                        if (map.getLayer('3d-buildings')) { map.setPaintProperty('3d-buildings', 'fill-extrusion-opacity', 1); } 
                    } 
                });
            }

            // --- KHỞI CHẠY TẤT CẢ ---
            if (!initMap()) return;
            setupRouteControls(); 
            setupDirectionsToggle();
            setupExactDirectionsReverse();
            setupUserLocation();
            initPanelDrag();
            setup3DToggle();

            // --- FIX 1: Tải dữ liệu an toàn (Dù lỗi cũng phải hiện Map) ---
            async function loadDataAndInit() {
                try {
                    const response = await fetch('places.json'); 
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    places = await response.json(); 

                    // Dữ liệu ngon lành -> Chạy tiếp
                    setupPlacesAndFilters();
                    createLocationList();
                    setupSearchFilter();

                } catch (e) {
                    console.error("Lỗi tải places.json:", e);
                    // Báo lỗi cho người dùng biết
                    showToast("⚠️ Không tìm thấy file dữ liệu places.json!");
                    
                    // QUAN TRỌNG: Nếu lỗi, vẫn phải gán danh sách rỗng để Map chạy, không được treo!
                    places = []; 
                    setupPlacesAndFilters(); // Vẫn cho chạy map để tắt loader
                    createLocationList(); // Tạo danh sách rỗng
                    
                    // Tắt ngay cái vòng xoay để không bị màn hình trắng
                    const loader = document.getElementById('loader');
                    if (loader) loader.style.display = 'none';
                }
            }
            // --- HẾT NÂNG CẤP ---
            loadRouteVideos();
            loadDataAndInit();
        });
