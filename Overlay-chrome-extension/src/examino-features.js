/* Examino-only: hotkeys install, click-to-toggle, hide native chrome,
 * Source DVR/VOD scrape/apply, auto-VOD, chrome.storage bridge client.
 */
    /* =========================================================
       18. EXAMINO — HOTKEYS, NATIVE CHROME, SETTINGS, AUTO-VOD
       ========================================================= */
    function installExaminoHotkeys() {
        if (examinoHotkeysInstalled) return;
        examinoHotkeysInstalled = true;
        // window + capture + earliest possible registration wins over OpenPlayer.
        window.addEventListener('keydown', handleKeydown, true);
        console.log('[OMT] Examino window capture hotkeys installed.');
    }

    function isExaminoSettingsChrome(target) {
        const el = target && (target.nodeType === 1 ? target : target.parentElement);
        if (!el || !el.closest) return false;
        return !!el.closest([
            '.op-setting-panel',
            '.omt-settings-raised',
            '.setting-holder',
            '.op-setting-button',
            '.op-button.op-setting-button',
            '.op-setting-item',
            '[op-panel-type]',
            '.op-setting-title',
            '.op-setting-title-container',
            '.op-setting-item-container'
        ].join(','));
    }

    // IMPORTANT: only the video surface — never the whole .op-player tree.
    // v1.2.1 used anchor.contains() and swallowed OpenPlayer settings clicks,
    // which broke Source switching (native works with the extension disabled).
    function isExaminoPlayerMediaTarget(target) {
        if (!target) return false;
        const el = target.nodeType === 1 ? target : target.parentElement;
        if (!el) return false;
        if (isOmtInteractiveTarget(el)) return false;
        if (isExaminoSettingsChrome(el)) return false;
        if (el.tagName === 'VIDEO') return true;
        // Transparent hits on the media container (not buttons/chrome inside it)
        if (el.classList && el.classList.contains('op-media-element-container')) return true;
        return false;
    }

    function resolveExaminoMedia(fromTarget) {
        if (fromTarget && fromTarget.tagName === 'VIDEO') return fromTarget;
        if (fromTarget && fromTarget.closest) {
            const nested = fromTarget.closest('video');
            if (nested) return nested;
        }
        return vid || site.findVideo();
    }

    async function withClickToggleSuppressed(fn) {
        examinoSuppressClickToggle++;
        try {
            return await fn();
        } finally {
            examinoSuppressClickToggle--;
        }
    }

    function handleExaminoClickArm(e) {
        if (site.id !== 'examino') return;
        if (examinoSuppressClickToggle > 0) {
            examinoClickArmed = false;
            return;
        }
        examinoClickArmed = isExaminoPlayerMediaTarget(e.target);
    }

    function handleExaminoClickToggle(e) {
        if (site.id !== 'examino') return;
        if (examinoSuppressClickToggle > 0) return;
        if (!examinoClickArmed) return;
        examinoClickArmed = false;
        if (!isExaminoPlayerMediaTarget(e.target)) return;
        const media = resolveExaminoMedia(e.target);
        if (!media) return;
        if (media !== vid) omtAdoptReplacedVideo(media);
        // Own the click exclusively so OpenPlayer cannot also toggle (net no-op).
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (typeof clearAutoPauseFlag === 'function') clearAutoPauseFlag();
        if (media.paused) {
            safePlay(media);
            mostrarOSD('Play');
        } else {
            media.pause();
            mostrarOSD('Pause');
        }
        noteOmtUiActivity(false);
    }

    function installExaminoClickToToggle() {
        if (examinoClickToggleInstalled) return;
        examinoClickToggleInstalled = true;
        window.addEventListener('pointerdown', handleExaminoClickArm, true);
        window.addEventListener('mousedown', handleExaminoClickArm, true);
        window.addEventListener('click', handleExaminoClickToggle, true);
        console.log('[OMT] Examino click-to-toggle installed (video surface only).');
    }

    function settleExaminoMediaAfterBind() {
        if (site.id !== 'examino' || !vid) return;
        // Only used after VOD→DVR (examinoPendingDvrSettle). Always snap once to the
        // DVR live edge so a carried VOD playhead cannot leave playback frozen.
        userIntendedTime = null;
        seekLockUntil = 0;
        let settled = false;

        const goLiveEdgeIfNeeded = () => {
            if (!vid || settled) return;
            try {
                if (!vid.seekable || vid.seekable.length === 0) return;
                const start = vid.seekable.start(0);
                const end = vid.seekable.end(vid.seekable.length - 1);
                if (!isFinite(start) || !isFinite(end)) return;
                settled = true;
                vid.currentTime = Math.max(start, end - 2);
            } catch (_) {}
        };

        if (vidAbortController) {
            vid.addEventListener('loadedmetadata', goLiveEdgeIfNeeded, {
                once: true,
                signal: vidAbortController.signal
            });
        } else {
            vid.addEventListener('loadedmetadata', goLiveEdgeIfNeeded, { once: true });
        }
        setTimeout(goLiveEdgeIfNeeded, 300);
    }

    function injectExaminoHideCSS() {
        let style = document.getElementById('omt-examino-hide-css');
        if (!style) {
            style = document.createElement('style');
            style.id = 'omt-examino-hide-css';
            (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = [
            /* Only while HUD is active (html.omt-hud-on). When the video */
            /* surface is obscured, host chrome must be usable again. */
            'html.omt-host-examino.omt-hud-on .op-controls,',
            /* Do not hide .op-ui when it wraps <video> (real Examino DOM). */
            'html.omt-host-examino.omt-hud-on .op-ui:not(.op-media-element-container):not(:has(video)):not(:has(.op-media-element-container)),',
            'html.omt-host-examino.omt-hud-on .op-progressbar-container,',
            'html.omt-host-examino.omt-hud-on .op-player .button-bar,',
            'html.omt-host-examino.omt-hud-on .video-container > .button-bar,',
            'html.omt-host-examino.omt-hud-on .setting-holder,',
            'html.omt-host-examino.omt-hud-on .op-button.op-setting-button,',
            'html.omt-host-examino.omt-hud-on .hamburger-menu,',
            'html.omt-host-examino.omt-hud-on .examino-bottom-controls {',
            '  display: none !important;',
            '  opacity: 0 !important;',
            '  pointer-events: none !important;',
            '  max-height: 0 !important;',
            '  overflow: hidden !important;',
            '  margin: 0 !important;',
            '  padding: 0 !important;',
            '}',
            'html.omt-host-examino.omt-hud-on .omt-examino-native-hidden {',
            '  display: none !important;',
            '  opacity: 0 !important;',
            '  pointer-events: none !important;',
            '  max-height: 0 !important;',
            '  overflow: hidden !important;',
            '  margin: 0 !important;',
            '  padding: 0 !important;',
            '}',
            /* Undo sticky class on media hosts / ancestors that contain media
               (Source-switch gap race). Higher specificity than the hide rule. */
            'html.omt-host-examino.omt-hud-on .op-player.omt-examino-native-hidden,',
            'html.omt-host-examino.omt-hud-on .op-media-element-container.omt-examino-native-hidden,',
            'html.omt-host-examino.omt-hud-on .video-container.omt-examino-native-hidden,',
            'html.omt-host-examino.omt-hud-on .main-container.omt-examino-native-hidden,',
            'html.omt-host-examino.omt-hud-on .top.omt-examino-native-hidden,',
            'html.omt-host-examino.omt-hud-on .omt-examino-native-hidden:has(video),',
            'html.omt-host-examino.omt-hud-on .omt-examino-native-hidden:has(.op-media-element-container),',
            'html.omt-host-examino.omt-hud-on .omt-examino-native-hidden:has(.op-player) {',
            '  display: block !important;',
            '  opacity: 1 !important;',
            '  pointer-events: auto !important;',
            '  max-height: none !important;',
            '  overflow: visible !important;',
            '  margin: 0 !important;',
            '  padding: 0 !important;',
            '}',
            'html.omt-host-examino.omt-hud-on .main-container.svelte-iq8mv8,',
            'html.omt-host-examino.omt-hud-on .main-container {',
            '  height: 100% !important;',
            '  max-height: 100% !important;',
            '}',
            /* Raised settings panel while scraping Source — keep usable even */
            /* if HUD paint state flaps; scoped to the temporary classes. */
            'html.omt-host-examino .op-setting-panel.omt-settings-raised,',
            '.op-setting-panel.omt-settings-raised {',
            '  display: block !important;',
            '  opacity: 1 !important;',
            '  pointer-events: auto !important;',
            '  z-index: 2147483647 !important;',
            '  position: fixed !important;',
            '  top: 48px !important;',
            '  right: 12px !important;',
            '  max-height: none !important;',
            '  overflow: visible !important;',
            '}',
            /* Must beat html.omt-host-examino.omt-hud-on .setting-holder and */
            /* .omt-examino-native-hidden (v2.0.x scoped hide broke 1.2.0's */
            /* weaker .setting-holder.omt-settings-temp-visible override). */
            'html.omt-host-examino.omt-hud-on .setting-holder.omt-settings-temp-visible,',
            'html.omt-host-examino.omt-hud-on .setting-holder.omt-settings-temp-visible .op-setting-button,',
            'html.omt-host-examino.omt-hud-on .op-button.op-setting-button.omt-settings-temp-visible,',
            'html.omt-host-examino.omt-hud-on .omt-examino-native-hidden.omt-settings-temp-visible,',
            'html.omt-host-examino.omt-hud-on .setting-holder.omt-examino-native-hidden.omt-settings-temp-visible {',
            '  display: block !important;',
            '  opacity: 0 !important;',
            '  pointer-events: auto !important;',
            '  max-height: none !important;',
            '  overflow: visible !important;',
            '  margin: 0 !important;',
            '  padding: 0 !important;',
            '  position: fixed !important;',
            '  top: 0 !important;',
            '  left: 0 !important;',
            '  width: 1px !important;',
            '  height: 1px !important;',
            '}'
        ].join('\n');
    }

    function omtIsMediaHostNode(el) {
        if (!el || el.nodeType !== 1) return false;
        try {
            if (el.tagName === 'VIDEO') return true;
            if (el.id === 'omt-root') return true;
            if (el.matches && el.matches('.op-player, .op-media-element-container, .video-container, .main-container, .top')) {
                return true;
            }
            if (el.querySelector && el.querySelector('video, .op-media-element-container, .op-player, #omt-root')) {
                return true;
            }
        } catch (_) {
            return true;
        }
        return false;
    }

    function markNativeHidden(el) {
        if (!el || el.id === 'omt-root' || (omtRoot && omtRoot.contains(el))) return;
        // Never hide a media host — display:none on an ancestor of <video>
        // makes Chrome power-save pause fight OpenPlayer play().
        if (omtIsMediaHostNode(el)) return;
        el.classList.add('omt-examino-native-hidden');
    }

    function scrubStaleNativeHiddenOnMedia() {
        // Source DVR↔VOD briefly removes <video>. A hide pass in that gap can
        // stamp omt-examino-native-hidden on .op-player; the class must not stick.
        document.querySelectorAll('.omt-examino-native-hidden').forEach((el) => {
            if (omtIsMediaHostNode(el)) el.classList.remove('omt-examino-native-hidden');
        });
        document.querySelectorAll(
            '.op-player.omt-examino-native-hidden, ' +
            '.op-media-element-container.omt-examino-native-hidden, ' +
            '.video-container.omt-examino-native-hidden, ' +
            '.main-container.omt-examino-native-hidden, ' +
            '.top.omt-examino-native-hidden'
        ).forEach((el) => el.classList.remove('omt-examino-native-hidden'));
    }

    function hideExaminoNativeChrome() {
        injectExaminoHideCSS();
        scrubStaleNativeHiddenOnMedia();

        // Probe layout: main-container uses height calc(100% - 108px) for the
        // three Examino button rows that sit as siblings under the same parent.
        document.querySelectorAll('.main-container').forEach((main) => {
            try {
                main.style.setProperty('height', '100%', 'important');
                main.style.setProperty('max-height', '100%', 'important');
            } catch (_) {}
            const parent = main.parentElement;
            if (!parent) return;
            Array.from(parent.children).forEach((child) => {
                if (child === main) return;
                markNativeHidden(child);
            });
        });

        document.querySelectorAll('.hamburger-menu, .setting-holder, .examino-bottom-controls').forEach(markNativeHidden);

        // Heuristic: hide compact control stacks that contain LIVE + FOCUS + seek labels.
        // Never touch anything inside the player tree — a Source-switch video gap
        // used to let this stamp omt-examino-native-hidden on .op-player itself.
        document.querySelectorAll('div, section, nav, aside').forEach((el) => {
            if (!el || el.closest('#omt-root')) return;
            if (el.closest && el.closest('.op-player, .op-media-element-container, .video-container')) return;
            if (omtIsMediaHostNode(el)) return;
            const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
            if (!text || text.length > 280) return;
            const hasLiveFocus = /\bLIVE\b/i.test(text) && /\bFOCUS\b/i.test(text);
            const hasSeeks = /(-|−)?\s*30\s*s/i.test(text) && /(7\s*s|2\s*s)/i.test(text);
            const hasSpeeds = /0\.1\s*x/i.test(text) && /1\.5\s*x/i.test(text);
            if ((hasLiveFocus && hasSeeks) || (hasSeeks && hasSpeeds) || (hasLiveFocus && hasSpeeds)) {
                markNativeHidden(el);
            }
        });

        // Top-right clock / idle chrome inside .top (keep player media).
        document.querySelectorAll('.top.svelte-iq8mv8, .top').forEach((top) => {
            Array.from(top.children || []).forEach((child) => {
                if (omtIsMediaHostNode(child)) return;
                if (child.classList && child.classList.contains('hamburger-menu')) {
                    markNativeHidden(child);
                    return;
                }
                const t = (child.innerText || '').trim();
                // Clock-like short text (e.g. 12:34:56) or empty icon chrome
                if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t) || child.classList.contains('hamburger-menu')) {
                    markNativeHidden(child);
                }
            });
        });
    }

    // hideExaminoNativeChrome reads innerText on every div (forced layout).
    // Ignore our own HUD writes (timeupdate re-renders time text several times
    // a second) and run at most once per second.
    const OMT_NATIVE_CHROME_MIN_GAP_MS = 1000;

    try { window.__omtHideExaminoNativeChrome = hideExaminoNativeChrome; } catch (_) {}

    function startExaminoNativeChromeObserver() {
        if (nativeChromeObserver) return;
        let scheduled = null;
        let lastRun = 0;
        nativeChromeObserver = new MutationObserver((records) => {
            if (scheduled) return;
            const hostChange = records.some((r) => {
                const t = r.target;
                return !(t && t.nodeType === 1 && (t.id === 'omt-root' || (t.closest && t.closest('#omt-root'))));
            });
            if (!hostChange) return;
            const wait = Math.max(50, OMT_NATIVE_CHROME_MIN_GAP_MS - (Date.now() - lastRun));
            scheduled = setTimeout(() => {
                scheduled = null;
                lastRun = Date.now();
                hideExaminoNativeChrome();
            }, wait);
        });
        const root = document.documentElement || document.body;
        if (root) {
            nativeChromeObserver.observe(root, { childList: true, subtree: true });
        }
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function revealNativeSettingsButton() {
        const holder = document.querySelector('.setting-holder');
        const btn = document.querySelector('.op-button.op-setting-button, .op-setting-button');
        if (holder) holder.classList.add('omt-settings-temp-visible');
        if (btn) btn.classList.add('omt-settings-temp-visible');
        return btn;
    }

    function concealNativeSettingsButton() {
        document.querySelectorAll('.omt-settings-temp-visible').forEach((el) => {
            el.classList.remove('omt-settings-temp-visible');
        });
    }

    function isOpSettingsPanelVisible(panel) {
        if (!panel) return false;
        if (panel.classList.contains('omt-settings-raised') || panel.classList.contains('open')) return true;
        const cs = getComputedStyle(panel);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
    }

    async function ensureOpSettingsOpen() {
        return withClickToggleSuppressed(async () => {
            revealNativeSettingsButton();
            let panel = document.querySelector('.op-setting-panel');
            if (panel && isOpSettingsPanelVisible(panel)) {
                panel.classList.add('omt-settings-raised');
                return panel;
            }
            const btn = revealNativeSettingsButton();
            if (!btn) return null;
            try { btn.click(); } catch (_) {}
            for (let i = 0; i < 24; i++) {
                await sleep(50);
                panel = document.querySelector('.op-setting-panel');
                if (panel && (isOpSettingsPanelVisible(panel) || panel.querySelector('.op-setting-item'))) {
                    panel.classList.add('omt-settings-raised');
                    return panel;
                }
            }
            return null;
        });
    }

    async function clickOpSettingBack() {
        return withClickToggleSuppressed(async () => {
            if (findOpSourceItem()) return;
            const title = document.querySelector('.op-setting-panel .op-setting-title, .op-setting-panel .op-setting-title-title');
            if (title) {
                try { title.click(); } catch (_) {}
                await sleep(120);
            }
            if (!findOpSourceItem()) {
                await ensureOpSettingsOpen();
            }
        });
    }

    function findOpSourceItem() {
        const items = document.querySelectorAll('.op-setting-panel .op-setting-item');
        for (const el of items) {
            const title = ((el.querySelector('.op-setting-item-title') || {}).textContent || '').trim();
            const type = (el.getAttribute('op-panel-type') || '').toLowerCase();
            if (title.toLowerCase() === 'source' || type === 'source') return el;
        }
        return null;
    }

    // Only exact DVR / VOD tokens — reject vod1/dvr2/quality mix-ins.
    function normalizeSourceToken(raw) {
        const s = String(raw || '').trim();
        if (!s) return null;
        if (/^dvr$/i.test(s)) return 'DVR';
        if (/^vod$/i.test(s)) return 'VOD';
        return null;
    }

    function detectCurrentSource(scrapedCurrent) {
        const fromMenu = normalizeSourceToken(scrapedCurrent);
        if (fromMenu) return fromMenu;
        const path = location.pathname || '';
        if (/\/play\/vod\b/i.test(path)) return 'VOD';
        if (/\/play\/dvr\b/i.test(path)) return 'DVR';
        if (typeof window.__omtMockSource === 'string') {
            const mock = normalizeSourceToken(window.__omtMockSource);
            if (mock) return mock;
        }
        if (vid) {
            try {
                if (vid.dataset && vid.dataset.omtSource) {
                    const ds = normalizeSourceToken(vid.dataset.omtSource);
                    if (ds) return ds;
                }
                if (isFinite(vid.duration) && vid.duration > 600) return 'VOD';
                if (vid.seekable && vid.seekable.length > 0) {
                    const span = vid.seekable.end(vid.seekable.length - 1) - vid.seekable.start(0);
                    if (span > 0 && span <= 400) return 'DVR';
                    if (span > 600) return 'VOD';
                }
            } catch (_) {}
        }
        return null;
    }

    function closeOpSettingsUi() {
        concealNativeSettingsButton();
        document.querySelectorAll('.op-setting-panel').forEach((p) => {
            p.classList.remove('omt-settings-raised');
            p.classList.remove('open');
        });
    }

    async function scrapeOpSourceOptions() {
        return withClickToggleSuppressed(async () => {
            let panel = await ensureOpSettingsOpen();
            if (!panel) {
                return { current: detectCurrentSource(null), options: [], loading: true };
            }

            if (!findOpSourceItem()) {
                await clickOpSettingBack();
                panel = await ensureOpSettingsOpen();
            }

            const mainItem = findOpSourceItem();
            let current = null;
            if (mainItem) {
                current = normalizeSourceToken(
                    mainItem.getAttribute('op-data-value') ||
                    ((mainItem.querySelector('.op-setting-item-value') || {}).textContent || '')
                );
                try { mainItem.click(); } catch (_) {}
            } else {
                closeOpSettingsUi();
                return { current: detectCurrentSource(null), options: [], loading: true };
            }

            let options = [];
            let submenuReady = false;
            for (let i = 0; i < 16; i++) {
                options = [];
                // Submenu is ready when the root "Source" row with chevron is gone.
                const stillOnRoot = !!findOpSourceItem();
                document.querySelectorAll('.op-setting-panel .op-setting-item').forEach((el) => {
                    if (el.querySelector('.op-setting-item-nexticon')) return;
                    if (el.getAttribute('op-panel-type')) return; // still a root row
                    const value = el.getAttribute('op-data-value');
                    const label = ((el.querySelector('.op-setting-item-title') ||
                        el.querySelector('.op-setting-item-value') || el).textContent || '').trim();
                    const token = normalizeSourceToken(value) || normalizeSourceToken(label);
                    if (!token) return;
                    if (!options.some((o) => o.value === token)) {
                        options.push({ value: token, label: token });
                    }
                });
                if (!stillOnRoot && options.length >= 1) {
                    submenuReady = true;
                    break;
                }
                await sleep(40);
            }

            if (!submenuReady) {
                closeOpSettingsUi();
                return { current: detectCurrentSource(current), options: [], loading: true };
            }

            // Dedupe + ensure both choices once the real submenu is open
            const deduped = [];
            options.forEach((o) => {
                if (!deduped.some((x) => x.value === o.value)) deduped.push(o);
            });
            ['DVR', 'VOD'].forEach((v) => {
                if (!deduped.some((o) => o.value === v)) deduped.push({ value: v, label: v });
            });

            if (!findOpSourceItem()) {
                await clickOpSettingBack();
            }
            closeOpSettingsUi();
            return {
                current: detectCurrentSource(current),
                options: deduped,
                loading: false
            };
        });
    }

    // Last Source we picked in the host menu; survives SPA teardown/boot so the
    // overlay select shows it even when the row/path can't confirm it.
    let examinoLastAppliedSource = null;

    async function applyOpSource(value, { manual = true } = {}) {
        if (!value) return false;
        const wanted = normalizeSourceToken(value) || String(value).toUpperCase();
        if (manual) {
            examinoManualSourceChoice = wanted;
            if (wanted === 'DVR') examinoAutoVodDone = true;
        }
        userIntendedTime = null;
        seekLockUntil = 0;

        return withClickToggleSuppressed(async () => {
            let panel = await ensureOpSettingsOpen();
            if (!panel) return false;
            if (!findOpSourceItem()) {
                await clickOpSettingBack();
                panel = await ensureOpSettingsOpen();
            }
            const mainItem = findOpSourceItem();
            if (!mainItem) {
                closeOpSettingsUi();
                return false;
            }
            try { mainItem.click(); } catch (_) {}

            let option = null;
            for (let i = 0; i < 16; i++) {
                option = Array.from(document.querySelectorAll('.op-setting-panel .op-setting-item'))
                    .find((el) => {
                        if (el.querySelector('.op-setting-item-nexticon')) return false;
                        if (el.getAttribute('op-panel-type')) return false;
                        const v = normalizeSourceToken(el.getAttribute('op-data-value')) ||
                            normalizeSourceToken(((el.querySelector('.op-setting-item-title') || {}).textContent || ''));
                        return v === wanted;
                    });
                if (option) break;
                await sleep(40);
            }

            if (!option) {
                closeOpSettingsUi();
                return false;
            }

            try { option.click(); } catch (_) {}
            examinoLastAppliedSource = wanted;
            // Wait until the root Source row reflects the new value (or panel closes).
            let confirmed = false;
            for (let i = 0; i < 20; i++) {
                await sleep(50);
                const row = findOpSourceItem();
                if (row) {
                    const now = normalizeSourceToken(
                        row.getAttribute('op-data-value') ||
                        ((row.querySelector('.op-setting-item-value') || {}).textContent || '')
                    );
                    if (now === wanted) { confirmed = true; break; }
                }
                // Panel may close after a successful pick — treat as success if mock/path agrees soon.
                if (!document.querySelector('.op-setting-panel.open, .op-setting-panel.omt-settings-raised')) {
                    confirmed = true;
                    break;
                }
            }
            closeOpSettingsUi();

            if (confirmed && wanted === 'DVR') {
                examinoPendingDvrSettle = true;
                // Settle now — do not wait for the 1.5s SPA monitor to notice a
                // replaced <video> (avoids a frozen out-of-window DVR playhead).
                if (typeof settleExaminoMediaAfterBind === 'function') {
                    try { settleExaminoMediaAfterBind(); } catch (_) {}
                }
            }
            return confirmed;
        });
    }

    function fillSourceSelect(scraped) {
        const selectEl = q('omt-examino-source');
        if (!selectEl) return;
        const { current, options, loading } = scraped || { current: null, options: [], loading: false };
        selectEl.innerHTML = '';
        // Never leave Source stuck on "Loading…" when the host gear scrape
        // fails (v2.1.0 field). DVR/VOD are always the real choices; keep them
        // selectable so Auto VOD / manual change can still apply.
        if (loading && (!options || !options.length)) {
            const list = [{ value: 'DVR', label: 'DVR' }, { value: 'VOD', label: 'VOD' }];
            selectEl.disabled = false;
            list.forEach((o) => {
                const opt = document.createElement('option');
                opt.value = o.value;
                opt.textContent = o.label;
                selectEl.appendChild(opt);
            });
            const cur = detectCurrentSource(current) || examinoManualSourceChoice ||
                examinoLastAppliedSource;
            const match = cur && list.find((o) => o.value === cur);
            selectEl.value = match ? match.value : list[0].value;
            return;
        }
        const list = (options && options.length)
            ? options
            : [{ value: 'DVR', label: 'DVR' }, { value: 'VOD', label: 'VOD' }];
        selectEl.disabled = false;
        list.forEach((o) => {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            selectEl.appendChild(opt);
        });
        const cur = detectCurrentSource(current) || examinoManualSourceChoice;
        const match = cur && list.find((o) => o.value === cur);
        selectEl.value = match ? match.value : list[0].value;
    }

    async function refreshExaminoSourceSelect() {
        if (site.id !== 'examino' || !omtRoot) return;
        const section = q('omt-examino-settings');
        if (section) section.style.display = 'flex';
        const source = await scrapeOpSourceOptions();
        fillSourceSelect(source);
        const autoBox = q('omt-examino-auto-vod');
        if (autoBox) {
            autoBox.checked = storageGetAutoVod() && examinoManualSourceChoice !== 'DVR';
        }
    }

    function wireExaminoSettingsUI() {
        const section = q('omt-examino-settings');
        if (section) section.style.display = 'flex';

        const autoBox = q('omt-examino-auto-vod');
        if (autoBox) {
            autoBox.checked = storageGetAutoVod() && examinoManualSourceChoice !== 'DVR';
            autoBox.addEventListener('change', () => {
                storageSetAutoVod(!!autoBox.checked);
                if (autoBox.checked) {
                    examinoManualSourceChoice = null;
                    examinoAutoVodDone = false;
                    examinoAutoVodAttempts = 0;
                    mostrarOSD('VOD auto-switch ON');
                    maybeAutoSwitchToVod().catch(() => {});
                } else {
                    examinoManualSourceChoice = examinoManualSourceChoice || 'DVR';
                    examinoAutoVodDone = true;
                    mostrarOSD('VOD auto-switch OFF');
                }
            });
        }

        const sourceSel = q('omt-examino-source');
        if (sourceSel) {
            sourceSel.addEventListener('focus', () => {
                refreshExaminoSourceSelect().catch(() => {});
            });
            sourceSel.addEventListener('mousedown', () => {
                refreshExaminoSourceSelect().catch(() => {});
            });
            sourceSel.addEventListener('change', async () => {
                const value = sourceSel.value;
                if (!value) return;
                const ok = await applyOpSource(value, { manual: true });
                if (ok) {
                    fillSourceSelect({
                        current: normalizeSourceToken(value),
                        options: [{ value: 'DVR', label: 'DVR' }, { value: 'VOD', label: 'VOD' }],
                        loading: false
                    });
                    mostrarOSD('Source: ' + value);
                    setTimeout(() => refreshExaminoSourceSelect().catch(() => {}), 900);
                } else {
                    mostrarOSD('Source change failed');
                    refreshExaminoSourceSelect().catch(() => {});
                }
            });
        }

        // DVR/VOD straight away (no host-menu scrape). 2.0.2 showed "Loading…"
        // here and relied on the auto-VOD loop re-scraping to clear it.
        fillSourceSelect({
            current: examinoLastAppliedSource || detectCurrentSource(null),
            options: [],
            loading: false
        });
        startAutoVodWatcher();
    }

    /*
     * Auto-VOD budget. 1.2.2–2.0.2 re-ran this from a document-wide
     * MutationObserver and from every teardown/boot, so whenever the menu did
     * not confirm VOD (e.g. /play/dvr/ path keeps reading as DVR) it clicked
     * Source → VOD again and again. Each click makes OpenPlayer pause, reload
     * and play() the media: the player flashes, never opens, and the console
     * fills with page-side "play() interrupted by pause()" errors.
     * Now: bounded attempts per page load, and at most ONE Source click per
     * page load (module state survives SPA teardown/boot).
     */
    const OMT_AUTO_VOD_MAX_ATTEMPTS = 6;
    let examinoAutoVodAttempts = 0;
    let examinoAutoVodClicked = false;

    function autoVodAlreadyClicked() {
        return examinoAutoVodClicked;
    }

    function markAutoVodClicked() {
        examinoAutoVodClicked = true;
    }

    function scheduleAutoVodRetry(delayMs) {
        if (examinoAutoVodAttempts >= OMT_AUTO_VOD_MAX_ATTEMPTS) {
            examinoAutoVodDone = true;
            return;
        }
        setTimeout(() => maybeAutoSwitchToVod().catch(() => {}), delayMs);
    }

    async function maybeAutoSwitchToVod() {
        if (site.id !== 'examino') return;
        if (!storageGetAutoVod()) return;
        if (examinoManualSourceChoice === 'DVR') return;
        if (examinoAutoVodDone) return;
        if (examinoAutoVodInFlight) return;
        if (autoVodAlreadyClicked()) {
            examinoAutoVodDone = true;
            return;
        }
        if (examinoAutoVodAttempts >= OMT_AUTO_VOD_MAX_ATTEMPTS) {
            examinoAutoVodDone = true;
            return;
        }
        examinoAutoVodAttempts += 1;
        const attempt = examinoAutoVodAttempts;

        examinoAutoVodInFlight = true;
        try {
            const already = detectCurrentSource(null);
            if (already === 'VOD') {
                examinoAutoVodDone = true;
                fillSourceSelect({
                    current: 'VOD',
                    options: [{ value: 'DVR', label: 'DVR' }, { value: 'VOD', label: 'VOD' }],
                    loading: false
                });
                return;
            }

            const source = await scrapeOpSourceOptions();
            if (source.loading) {
                scheduleAutoVodRetry(700);
                return;
            }
            const current = detectCurrentSource(source.current);
            if (current === 'VOD') {
                examinoAutoVodDone = true;
                fillSourceSelect(source);
                return;
            }
            const vod = source.options.find((o) => o.value === 'VOD');
            if (!vod) {
                scheduleAutoVodRetry(700);
                return;
            }
            console.log('[OMT] Auto-switching Examino source to VOD (attempt ' + attempt + ')');
            // One Source click per tab session, confirmed or not: a second
            // click would reload the media again.
            markAutoVodClicked();
            examinoAutoVodDone = true;
            const ok = await applyOpSource('VOD', { manual: false });
            fillSourceSelect({
                current: ok ? 'VOD' : (examinoLastAppliedSource || detectCurrentSource(null)),
                options: [{ value: 'DVR', label: 'DVR' }, { value: 'VOD', label: 'VOD' }],
                loading: false
            });
            if (ok) mostrarOSD('Switched to VOD');
        } catch (err) {
            console.warn('[OMT] Auto-VOD failed:', err && err.message);
            if (!autoVodAlreadyClicked()) scheduleAutoVodRetry(700);
        } finally {
            examinoAutoVodInFlight = false;
            closeOpSettingsUi();
        }
    }

    function startAutoVodWatcher() {
        if (site.id !== 'examino') return;
        if (examinoManualSourceChoice === 'DVR' || examinoAutoVodDone) return;
        if (!storageGetAutoVod()) return;
        if (examinoAutoVodWatcher) return;
        // Single delayed kick (OpenPlayer settings mount late); retries are
        // bounded inside maybeAutoSwitchToVod. No DOM observer.
        examinoAutoVodWatcher = setTimeout(() => {
            examinoAutoVodWatcher = null;
            maybeAutoSwitchToVod().catch(() => {});
        }, 1200);
    }

    function initExaminoPlayerFeatures() {
        installExaminoHotkeys();
        installExaminoClickToToggle();
        injectExaminoHideCSS();
        hideExaminoNativeChrome();
        startExaminoNativeChromeObserver();
        if (examinoManualSourceChoice === 'DVR') return;
        startAutoVodWatcher();
    }
