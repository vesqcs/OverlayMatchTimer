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
        vid = media;
        // Own the click exclusively so OpenPlayer cannot also toggle (net no-op).
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (typeof clearAutoPauseFlag === 'function') clearAutoPauseFlag();
        if (media.paused) {
            media.play().catch(() => {});
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
        if (document.getElementById('omt-examino-hide-css')) return;
        const style = document.createElement('style');
        style.id = 'omt-examino-hide-css';
        style.textContent = [
            /* OpenPlayer built-in chrome */
            '.op-controls,',
            '.op-ui:not(.op-media-element-container),',
            '.op-progressbar-container,',
            '.op-player .button-bar,',
            '.video-container > .button-bar,',
            '.setting-holder,',
            '.op-button.op-setting-button,',
            /* Examino Svelte chrome from owner probe */
            '.hamburger-menu,',
            '.examino-bottom-controls,',
            '.omt-examino-native-hidden {',
            '  display: none !important;',
            '  opacity: 0 !important;',
            '  pointer-events: none !important;',
            '  max-height: 0 !important;',
            '  overflow: hidden !important;',
            '  margin: 0 !important;',
            '  padding: 0 !important;',
            '}',
            /* Give the video the space freed by the ~108px bottom bars */
            '.main-container.svelte-iq8mv8,',
            '.main-container {',
            '  height: 100% !important;',
            '  max-height: 100% !important;',
            '}',
            /* Fallback raised settings panel when proxying native gear */
            '.op-setting-panel.omt-settings-raised {',
            '  display: block !important;',
            '  opacity: 1 !important;',
            '  pointer-events: auto !important;',
            '  z-index: 2147483647 !important;',
            '  position: fixed !important;',
            '  top: 48px !important;',
            '  right: 12px !important;',
            '}',
            '.setting-holder.omt-settings-temp-visible,',
            '.setting-holder.omt-settings-temp-visible .op-setting-button {',
            '  display: block !important;',
            '  opacity: 0 !important;',
            '  pointer-events: auto !important;',
            '  position: fixed !important;',
            '  top: 0 !important;',
            '  left: 0 !important;',
            '  width: 1px !important;',
            '  height: 1px !important;',
            '}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(style);
    }

    function markNativeHidden(el) {
        if (!el || el.id === 'omt-root' || (omtRoot && omtRoot.contains(el))) return;
        el.classList.add('omt-examino-native-hidden');
    }

    function hideExaminoNativeChrome() {
        injectExaminoHideCSS();

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
        document.querySelectorAll('div, section, nav, aside').forEach((el) => {
            if (!el || el.closest('#omt-root')) return;
            if (el.querySelector && el.querySelector('video, .op-player, .op-media-element-container, #omt-root')) return;
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
                if (child.matches && child.matches('.op-player, .video-container, .op-media-element-container')) return;
                if (child.querySelector && child.querySelector('video, .op-player, .op-media-element-container')) return;
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

    function startExaminoNativeChromeObserver() {
        if (nativeChromeObserver) return;
        let scheduled = null;
        nativeChromeObserver = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = setTimeout(() => {
                scheduled = null;
                hideExaminoNativeChrome();
            }, 50);
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
            }
            return confirmed;
        });
    }

    function fillSourceSelect(scraped) {
        const selectEl = q('omt-examino-source');
        if (!selectEl) return;
        const { current, options, loading } = scraped || { current: null, options: [], loading: false };
        selectEl.innerHTML = '';
        if (loading && (!options || !options.length)) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'Loading…';
            selectEl.appendChild(opt);
            selectEl.disabled = true;
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
                    mostrarOSD('VOD auto-switch ON');
                    maybeAutoSwitchToVod(0).catch(() => {});
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

        // Lightweight placeholder until menus exist
        fillSourceSelect({ current: detectCurrentSource(null), options: [], loading: true });
        startAutoVodWatcher();
    }

    async function maybeAutoSwitchToVod(attempt = 0) {
        if (site.id !== 'examino') return;
        if (!storageGetAutoVod()) return;
        if (examinoManualSourceChoice === 'DVR') return;
        if (examinoAutoVodDone) return;
        if (examinoAutoVodInFlight) return;

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
                if (attempt < 10) {
                    setTimeout(() => maybeAutoSwitchToVod(attempt + 1).catch(() => {}), 300);
                }
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
                if (attempt < 10) {
                    setTimeout(() => maybeAutoSwitchToVod(attempt + 1).catch(() => {}), 300);
                }
                return;
            }
            console.log('[OMT] Auto-switching Examino source to VOD (attempt ' + attempt + ')');
            const ok = await applyOpSource('VOD', { manual: false });
            if (ok) {
                examinoAutoVodDone = true;
                fillSourceSelect({
                    current: 'VOD',
                    options: [{ value: 'DVR', label: 'DVR' }, { value: 'VOD', label: 'VOD' }],
                    loading: false
                });
                mostrarOSD('Switched to VOD');
                setTimeout(() => refreshExaminoSourceSelect().catch(() => {}), 800);
            } else if (attempt < 10) {
                setTimeout(() => maybeAutoSwitchToVod(attempt + 1).catch(() => {}), 400);
            }
        } catch (err) {
            console.warn('[OMT] Auto-VOD failed:', err && err.message);
            if (attempt < 10) {
                setTimeout(() => maybeAutoSwitchToVod(attempt + 1).catch(() => {}), 400);
            }
        } finally {
            examinoAutoVodInFlight = false;
            closeOpSettingsUi();
        }
    }

    function startAutoVodWatcher() {
        if (site.id !== 'examino') return;
        if (examinoManualSourceChoice === 'DVR' || examinoAutoVodDone) return;
        if (!storageGetAutoVod()) return;

        // Immediate attempt (no fixed 1.2s delay)
        maybeAutoSwitchToVod(0).catch(() => {});

        if (examinoAutoVodWatcher) return;
        examinoAutoVodWatcher = new MutationObserver(() => {
            if (examinoAutoVodDone || examinoManualSourceChoice === 'DVR' || !storageGetAutoVod()) {
                if (examinoAutoVodWatcher) {
                    examinoAutoVodWatcher.disconnect();
                    examinoAutoVodWatcher = null;
                }
                return;
            }
            if (document.querySelector('.op-setting-button, .op-setting-panel, .setting-holder')) {
                maybeAutoSwitchToVod(0).catch(() => {});
            }
        });
        const root = document.documentElement || document.body;
        if (root) {
            examinoAutoVodWatcher.observe(root, { childList: true, subtree: true });
        }
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
