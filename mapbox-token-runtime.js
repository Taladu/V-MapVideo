// V-MAPVIDEO V29 — Safe runtime Mapbox token setup.
// Stores the public Mapbox token only in this browser; never commits it to GitHub.
(function () {
    'use strict';

    const STORAGE_KEY = 'vmap_mapbox_public_token_v1';
    const OVERLAY_ID = 'vmap-mapbox-token-setup';

    function normalize(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function isPublicToken(value) {
        return normalize(value).startsWith('pk.');
    }

    function readStoredToken() {
        try {
            return normalize(localStorage.getItem(STORAGE_KEY));
        } catch (error) {
            return '';
        }
    }

    function saveStoredToken(value) {
        const token = normalize(value);
        if (!isPublicToken(token)) {
            throw new Error('Mapbox public token phải bắt đầu bằng pk.');
        }
        localStorage.setItem(STORAGE_KEY, token);
        window.VMAP_MAPBOX_TOKEN = token;
        return token;
    }

    function clearStoredToken() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (error) {}
        try {
            delete window.VMAP_MAPBOX_TOKEN;
        } catch (error) {
            window.VMAP_MAPBOX_TOKEN = '';
        }
    }

    const configured = normalize(window.VMAP_MAPBOX_TOKEN);
    const stored = readStoredToken();
    if (isPublicToken(configured)) {
        window.VMAP_MAPBOX_TOKEN = configured;
    } else if (isPublicToken(stored)) {
        window.VMAP_MAPBOX_TOKEN = stored;
    }

    function showSetup() {
        if (isPublicToken(window.VMAP_MAPBOX_TOKEN)) return;
        if (document.getElementById(OVERLAY_ID)) return;

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'vmap-token-title');
        overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:2147483647',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'padding:20px',
            'background:rgba(5,14,24,.82)',
            'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
        ].join(';');

        const card = document.createElement('div');
        card.style.cssText = [
            'width:min(520px,100%)',
            'background:#fff',
            'border-radius:18px',
            'padding:22px',
            'box-shadow:0 20px 60px rgba(0,0,0,.35)',
            'color:#17202a'
        ].join(';');

        const title = document.createElement('h2');
        title.id = 'vmap-token-title';
        title.textContent = '🔐 Cấu hình Mapbox lần đầu';
        title.style.cssText = 'margin:0 0 10px;font-size:22px';

        const help = document.createElement('p');
        help.textContent = 'Dán public token Mapbox bắt đầu bằng pk. Token chỉ được lưu trên trình duyệt của máy này, không ghi vào source code và không đưa lên GitHub.';
        help.style.cssText = 'margin:0 0 16px;line-height:1.5;color:#445';

        const inputWrap = document.createElement('div');
        inputWrap.style.cssText = 'display:flex;gap:8px';

        const input = document.createElement('input');
        input.type = 'password';
        input.placeholder = 'pk.ey...';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('aria-label', 'Mapbox public token');
        input.style.cssText = [
            'flex:1',
            'min-width:0',
            'padding:12px 13px',
            'border:1px solid #b9c5d0',
            'border-radius:10px',
            'font:14px ui-monospace,SFMono-Regular,Menlo,monospace'
        ].join(';');

        const reveal = document.createElement('button');
        reveal.type = 'button';
        reveal.textContent = 'Hiện';
        reveal.style.cssText = 'padding:10px 14px;border:0;border-radius:10px;background:#eef3f7;cursor:pointer;font-weight:600';
        reveal.addEventListener('click', () => {
            const hidden = input.type === 'password';
            input.type = hidden ? 'text' : 'password';
            reveal.textContent = hidden ? 'Ẩn' : 'Hiện';
        });

        const message = document.createElement('div');
        message.setAttribute('aria-live', 'polite');
        message.style.cssText = 'min-height:22px;margin-top:9px;font-size:13px;color:#b42318';

        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'Lưu & mở V-Map';
        save.style.cssText = 'width:100%;margin-top:8px;padding:12px 16px;border:0;border-radius:11px;background:#1677ff;color:white;font-weight:700;font-size:15px;cursor:pointer';

        const note = document.createElement('p');
        note.textContent = 'Khi đưa V-MapVideo lên tên miền thật, hãy giới hạn token theo đúng domain trong tài khoản Mapbox.';
        note.style.cssText = 'margin:13px 0 0;font-size:12px;line-height:1.45;color:#687684';

        function submit() {
            const token = normalize(input.value);
            if (!isPublicToken(token)) {
                message.textContent = 'Token chưa đúng. Public token Mapbox phải bắt đầu bằng pk.';
                input.focus();
                return;
            }
            try {
                saveStoredToken(token);
                message.style.color = '#067647';
                message.textContent = 'Đã lưu an toàn trên máy. Đang mở V-Map…';
                save.disabled = true;
                setTimeout(() => location.reload(), 120);
            } catch (error) {
                message.style.color = '#b42318';
                message.textContent = 'Trình duyệt không cho lưu token. Hãy cho phép lưu dữ liệu trang rồi thử lại.';
            }
        }

        save.addEventListener('click', submit);
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') submit();
        });

        inputWrap.append(input, reveal);
        card.append(title, help, inputWrap, message, save, note);
        overlay.append(card);
        document.body.append(overlay);

        const loader = document.getElementById('loader');
        if (loader) loader.style.display = 'none';
        setTimeout(() => input.focus(), 0);
    }

    window.VMAP_MAPBOX_TOKEN_RUNTIME = Object.freeze({
        storageKey: STORAGE_KEY,
        hasToken: () => isPublicToken(window.VMAP_MAPBOX_TOKEN),
        save: saveStoredToken,
        clear: clearStoredToken,
        showSetup
    });

    if (!isPublicToken(window.VMAP_MAPBOX_TOKEN)) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', showSetup, { once: true });
        } else {
            showSetup();
        }
    }
})();
