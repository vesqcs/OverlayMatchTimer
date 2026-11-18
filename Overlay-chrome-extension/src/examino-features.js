/* Examino-only: hotkeys, click-to-toggle, hide native chrome,
 * Source DVR/VOD (v1.2.0 path), auto-VOD.
 *
 * v2.1.3: Source/VOD switching + host-hide/settings handling copied
 * VERBATIM from v1.2.0 (811be7b), with only:
 *   - [OMT-DEBUG][examino-source] step logs
 *   - storageGetAutoVod/Set via existing bus (no window.postMessage)
 *   - withClickToggleSuppressed around menu clicks (click-to-toggle is
 *     post-1.2.0; suppress so gear/Source clicks are not stolen)
 * InPlay is untouched.
 */
    /* =========================================================
       18. EXAMINO — HOTKEYS, NATIVE CHROME, SETTINGS, AUTO-VOD
       ========================================================= */

    // 2.1.3 flags: Source path is v1.2.0. Post-1.2.0 features that can
    // interfere with host VOD are gated here.
    const OMT_EXAMINO_SOURCE_V120 = true;
    const OMT_EXAMINO_CLICK_TOGGLE_ENABLED = true;
    // Serialize OpenPlayer settings scrape/apply/refresh. Video replace →
    // teardown/boot re-wires a 600 ms refresh that otherwise races mid-apply
    // and steals the Source submenu (option-not-found → "Source change failed").
    let examinoSettingsChain = Promise.resolve();
    function withExaminoSettingsLock(fn) {
        const run = examinoSettingsChain.then(() => fn(), () => fn());
        examinoSettingsChain = run.then(() => {}, () => {});
        return run;
    }

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
        if (!OMT_EXAMINO_CLICK_TOGGLE_ENABLED) {
            console.log('[OMT] Examino click-to-toggle DISABLED (flag).');
            return;
        }
        if (examinoClickToggleInstalled) return;
        examinoClickToggleInstalled = true;
        window.addEventListener('pointerdown', handleExaminoClickArm, true);
        window.addEventListener('mousedown', handleExaminoClickArm, true);
        window.addEventListener('click', handleExaminoClickToggle, true);
        console.log('[OMT] Examino click-to-toggle installed (video surface only).');
    }

    // ---- v1.2.0 host-hide / settings / Source (811be7b) + OMT-DEBUG ----

    function omtDebugSource(step, detail) {
        try {
            if (detail !== undefined) console.log('[OMT-DEBUG][examino-source]', step, detail);
            else console.log('[OMT-DEBUG][examino-source]', step);
        } catch (_) {}
    }

    function injectExaminoHideCSS() {
        // v1.2.0 verbatim (create-once). content.css keeps Examino-scoped hide
        // + higher-specificity temp-visible so gear beats html.omt-host-examino
        // hide without touching InPlay rules.
        if (document.getElementById('omt-examino-hide-css')) return;
        const style = document.createElement('style');
        style.id = 'omt-examino-hide-css';
        style.textContent = [
            /* OpenPlayer built-in chrome — 1.2.0 list, with :has(video) /
               :has(.op-media-element-container) exclusions on .op-ui so a
               nested media host is never blanked (post-1.2.0 field). */
            '.op-controls,',
            '.op-ui:not(.op-media-element-container):not(:has(video)):not(:has(.op-media-element-container)),',
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
            '}',
            /* Undo sticky hide when class lands on a media host during a
               Source-switch video gap (same intent as content.css). */
            '.omt-examino-native-hidden:has(video),',
            '.omt-examino-native-hidden:has(.op-media-element-container),',
            '.omt-examino-native-hidden:has(.op-player) {',
            '  display: block !important;',
            '  opacity: 1 !important;',
            '  pointer-events: auto !important;',
            '  max-height: none !important;',
            '  overflow: visible !important;',
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
        omtDebugSource('reveal-gear', {
            holder: !!holder,
            btn: !!btn,
            holderDisplay: holder ? getComputedStyle(holder).display : null,
            btnPE: btn ? getComputedStyle(btn).pointerEvents : null
        });
        return btn;
    }

    function concealNativeSettingsButton() {
        document.querySelectorAll('.omt-settings-temp-visible').forEach((el) => {
            el.classList.remove('omt-settings-temp-visible');
        });
    }

    function dismissOpSettingsChrome() {
        concealNativeSettingsButton();
        document.querySelectorAll('.op-setting-panel').forEach((p) => {
            p.classList.remove('omt-settings-raised');
            p.classList.remove('open');
        });
    }

    function isOpSettingsPanelVisible(panel) {
        if (!panel) return false;
        if (panel.classList.contains('omt-settings-raised') || panel.classList.contains('open')) return true;
        const cs = getComputedStyle(panel);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
    }

    async function ensureOpSettingsOpen() {
        // v1.2.0 body + suppress so click-to-toggle cannot steal gear clicks.
        return withClickToggleSuppressed(async () => {
            revealNativeSettingsButton();
            let panel = document.querySelector('.op-setting-panel');
            if (panel && isOpSettingsPanelVisible(panel)) {
                panel.classList.add('omt-settings-raised');
                omtDebugSource('ensure-panel:already-open');
                return panel;
            }
            const btn = revealNativeSettingsButton();
            if (!btn) {
                omtDebugSource('ensure-panel:no-gear');
                return null;
            }
            try { btn.click(); } catch (_) {}
            for (let i = 0; i < 24; i++) {
                await sleep(50);
                panel = document.querySelector('.op-setting-panel');
                if (panel && (isOpSettingsPanelVisible(panel) || panel.querySelector('.op-setting-item'))) {
                    panel.classList.add('omt-settings-raised');
                    omtDebugSource('ensure-panel:opened', { items: panel.querySelectorAll('.op-setting-item').length });
                    return panel;
                }
            }
            omtDebugSource('ensure-panel:timeout');
            return null;
        });
    }

    async function clickOpSettingBack() {
        // Only navigate back when a submenu is showing (no root rows with nexticon).
        const rootRow = document.querySelector('.op-setting-panel .op-setting-item[op-panel-type] .op-setting-item-nexticon');
        if (rootRow) return; // already on root
        const title = document.querySelector('.op-setting-panel .op-setting-title, .op-setting-panel .op-setting-title-title');
        if (title) {
            try { title.click(); } catch (_) {}
            await sleep(120);
        }
        // Re-open if the host closes the panel when tapping the root title.
        if (!document.querySelector('.op-setting-panel .op-setting-item[op-panel-type]')) {
            await ensureOpSettingsOpen();
        }
    }

    async function scrapeOpSettingOptions(panelType) {
        omtDebugSource('scrape:start', { panelType });
        return withExaminoSettingsLock(() => withClickToggleSuppressed(async () => {
            let panel = await ensureOpSettingsOpen();
            if (!panel) {
                omtDebugSource('scrape:no-panel');
                return { current: null, options: [] };
            }

            // Return to root menu if needed, without closing the panel.
            if (!document.querySelector(`.op-setting-panel .op-setting-item[op-panel-type="${panelType}"]`)) {
                await clickOpSettingBack();
                panel = await ensureOpSettingsOpen();
            }

            const mainItem = document.querySelector(`.op-setting-panel .op-setting-item[op-panel-type="${panelType}"]`);
            if (!mainItem) {
                omtDebugSource('scrape:no-row', { panelType });
                return { current: null, options: [] };
            }

            const current = mainItem.getAttribute('op-data-value') ||
                (mainItem.querySelector('.op-setting-item-value') || {}).textContent || null;

            omtDebugSource('scrape:click-row', { panelType, current, opDataValue: mainItem.getAttribute('op-data-value') });
            try { mainItem.click(); } catch (_) {}

            let options = [];
            for (let i = 0; i < 12; i++) {
                options = [];
                document.querySelectorAll('.op-setting-panel .op-setting-item').forEach((el) => {
                    const value = el.getAttribute('op-data-value');
                    if (!value) return;
                    // Skip root rows that still show a submenu chevron
                    if (el.querySelector('.op-setting-item-nexticon')) return;
                    const label = (el.querySelector('.op-setting-item-title') || el.querySelector('.op-setting-item-value') || el).textContent.trim();
                    if (!options.some((o) => o.value === value)) {
                        options.push({ value, label: label || value });
                    }
                });
                if (options.length >= 2) break;
                await sleep(50);
            }

            // If submenu did not expand, still expose the current value as a single option.
            if (!options.length && current) {
                options.push({ value: current, label: current });
            }
            // Guarantee DVR/VOD choices when scraping Source on Examino.
            if (panelType === 'source') {
                ['DVR', 'VOD'].forEach((v) => {
                    if (!options.some((o) => String(o.value).toUpperCase() === v)) {
                        options.push({ value: v, label: v });
                    }
                });
            }

            // Return to root for the next scrape without closing.
            if (!document.querySelector('.op-setting-panel .op-setting-item[op-panel-type]')) {
                await clickOpSettingBack();
            }
            omtDebugSource('scrape:done', { panelType, current, options });
            return { current, options };
        }));
    }

    async function applyOpSetting(panelType, value) {
        if (!value) return false;
        omtDebugSource('apply:start', { panelType, value, path: location.pathname, v120: OMT_EXAMINO_SOURCE_V120 });
        // Drop a pending post-wire refresh so it cannot steal the submenu.
        if (examinoSettingsRefreshTimer) {
            clearTimeout(examinoSettingsRefreshTimer);
            examinoSettingsRefreshTimer = null;
        }
        return withExaminoSettingsLock(() => withClickToggleSuppressed(async () => {
            let panel = await ensureOpSettingsOpen();
            if (!panel) {
                omtDebugSource('apply:no-panel');
                return false;
            }
            if (!document.querySelector(`.op-setting-panel .op-setting-item[op-panel-type="${panelType}"]`)) {
                await clickOpSettingBack();
                panel = await ensureOpSettingsOpen();
            }
            const mainItem = document.querySelector(`.op-setting-panel .op-setting-item[op-panel-type="${panelType}"]`);
            if (!mainItem) {
                omtDebugSource('apply:no-row', { panelType });
                return false;
            }
            omtDebugSource('apply:click-row', {
                opDataValue: mainItem.getAttribute('op-data-value'),
                opPanelType: mainItem.getAttribute('op-panel-type')
            });
            try { mainItem.click(); } catch (_) {}
            await sleep(200);
            const rawItems = Array.from(document.querySelectorAll('.op-setting-panel .op-setting-item')).map((el) => ({
                opDataValue: el.getAttribute('op-data-value'),
                opPanelType: el.getAttribute('op-panel-type'),
                title: ((el.querySelector('.op-setting-item-title') || {}).textContent || '').trim(),
                hasNext: !!el.querySelector('.op-setting-item-nexticon')
            }));
            const option = Array.from(document.querySelectorAll('.op-setting-panel .op-setting-item'))
                .find((el) => el.getAttribute('op-data-value') === value && !el.querySelector('.op-setting-item-nexticon'));
            if (option) {
                omtDebugSource('apply:click-option', {
                    value,
                    opDataValue: option.getAttribute('op-data-value'),
                    title: ((option.querySelector('.op-setting-item-title') || {}).textContent || '').trim()
                });
                try { option.click(); } catch (_) {}
                await sleep(250);
                concealNativeSettingsButton();
                // v1.2.0: remove raised only — never strip host `.open`.
                document.querySelectorAll('.op-setting-panel').forEach((p) => p.classList.remove('omt-settings-raised'));
                // Post-1.2.0 (kept): VOD→DVR must snap off a carried VOD playhead
                // or the short DVR window freezes. Does not alter the click path.
                if (panelType === 'source') {
                    if (/vod/i.test(String(value))) examinoLastAppliedSource = 'VOD';
                    else if (/dvr/i.test(String(value))) examinoLastAppliedSource = 'DVR';
                    if (/^dvr$/i.test(String(value).trim())) {
                        examinoPendingDvrSettle = true;
                        try {
                            settleExaminoMediaAfterBind(
                                (typeof site.findVideo === 'function' && site.findVideo()) ||
                                document.querySelector('video')
                            );
                        } catch (_) {}
                    }
                }
                omtDebugSource('apply:success', {
                    value,
                    mediaUrl: (typeof window.__omtMockMediaUrl === 'string') ? window.__omtMockMediaUrl : null,
                    duration: vid && vid.duration,
                    omtSource: vid && vid.dataset && vid.dataset.omtSource
                });
                return true;
            }
            // Fallback: leave raised native panel for manual pick
            omtDebugSource('apply:option-not-found', { value, rawItems });
            panel.classList.add('omt-settings-raised');
            return false;
        }));
    }

    // Last successful Source apply + last good option list — survive host
    // panel scrape failures after Auto VOD replaces <video> (field: select
    // showed "Unavailable" and was disabled so DVR could not be chosen).
    let examinoLastAppliedSource = null;
    let examinoLastGoodSourceOptions = [];
    // One-shot settle re-scrape after Auto VOD / thin scrape — do not re-arm on
    // every refresh while VOD (that open/dismiss loop blocks native gear).
    let examinoSourceSettleTimer = null;
    let examinoSourceNeedsSettleRescrape = false;

    /** Infer DVR/VOD from last apply, media URL, or dataset — not from /play/dvr/ path. */
    function inferExaminoSourceLabel() {
        if (examinoLastAppliedSource === 'VOD' || examinoLastAppliedSource === 'DVR') {
            return examinoLastAppliedSource;
        }
        if (examinoManualSourceChoice === 'VOD' || examinoManualSourceChoice === 'DVR') {
            return examinoManualSourceChoice;
        }
        try {
            const url = (typeof window.__omtMockMediaUrl === 'string' && window.__omtMockMediaUrl) ||
                (vid && vid.dataset && vid.dataset.omtMediaUrl) ||
                (vid && (vid.currentSrc || vid.src)) || '';
            if (/chunklist_vod|\bvod\b|\/vod\//i.test(url)) return 'VOD';
            if (/chunklist_dvr|\bdvr\b|\/live\//i.test(url)) return 'DVR';
        } catch (_) {}
        if (vid && vid.dataset && vid.dataset.omtSource) {
            const s = String(vid.dataset.omtSource).toUpperCase();
            if (s === 'VOD' || s === 'DVR') return s;
        }
        if (typeof window.__omtMockSource === 'string') {
            const s = String(window.__omtMockSource).toUpperCase();
            if (s === 'VOD' || s === 'DVR') return s;
        }
        return null;
    }

    function rememberGoodSourceOptions(options) {
        if (!options || options.length < 2) return;
        const hasDvr = options.some((o) => /dvr/i.test(String(o.value)) || /dvr/i.test(String(o.label || '')));
        const hasVod = options.some((o) => /vod/i.test(String(o.value)) || /vod/i.test(String(o.label || '')));
        if (!hasDvr || !hasVod) return;
        examinoLastGoodSourceOptions = options.map((o) => ({
            value: String(o.value),
            label: String(o.label || o.value)
        }));
    }

    function normalizeExaminoSourceScraped(scraped) {
        const options = [];
        const seen = Object.create(null);
        const push = (value, label) => {
            const v = String(value || '');
            if (!v || seen[v]) return;
            seen[v] = true;
            options.push({ value: v, label: label || v });
        };
        const scrapedOpts = scraped && scraped.options ? scraped.options : [];
        scrapedOpts.forEach((o) => {
            if (o && o.value != null) push(o.value, o.label);
        });
        // Scrape empty / thin after <video> replace → reuse last good host options
        // so DVR stays selectable (never disable the control).
        if (options.length < 2 && examinoLastGoodSourceOptions.length) {
            examinoLastGoodSourceOptions.forEach((o) => push(o.value, o.label));
        }
        // Floor: always expose DVR + VOD.
        ['DVR', 'VOD'].forEach((v) => push(v, v));

        let current = scraped && scraped.current != null ? String(scraped.current) : '';
        const inferred = inferExaminoSourceLabel();
        // Prefer media / last-apply when scrape still says DVR after a VOD apply
        // (host path often stays /play/dvr/ while chunklist is VOD).
        if (inferred) {
            const scrapeIsDvr = current && /dvr/i.test(current) && !/vod/i.test(current);
            const scrapeMissing = !current || !options.some((o) => String(o.value) === current);
            if (scrapeMissing || (inferred === 'VOD' && scrapeIsDvr)) {
                current = inferred;
            }
        }
        if (current && !options.some((o) => String(o.value) === current)) {
            push(current, current);
        }
        rememberGoodSourceOptions(options);
        return { current: current || inferred || null, options };
    }

    function fillSelect(selectEl, scraped) {
        if (!selectEl) return;
        const { current, options } = normalizeExaminoSourceScraped(scraped);
        selectEl.innerHTML = '';
        // With DVR/VOD floor + last-good cache, options should never be empty.
        // Keep the control enabled so the analyst can switch back to DVR.
        selectEl.disabled = false;
        if (!options.length) {
            ['DVR', 'VOD'].forEach((v) => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                selectEl.appendChild(opt);
            });
            const inferred = inferExaminoSourceLabel() || 'VOD';
            selectEl.value = inferred;
            omtDebugSource('fill-select:floor-only', { value: selectEl.value });
            return;
        }
        options.forEach((o) => {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            if (current && String(current) === String(o.value)) opt.selected = true;
            selectEl.appendChild(opt);
        });
        if (current) {
            selectEl.value = current;
            if (selectEl.value !== current) {
                const match = Array.from(selectEl.options).find((o) =>
                    String(o.value).toUpperCase() === String(current).toUpperCase());
                if (match) selectEl.value = match.value;
            }
        }
        omtDebugSource('fill-select', {
            current,
            value: selectEl.value,
            disabled: selectEl.disabled,
            options: options.map((o) => o.value),
            inferred: inferExaminoSourceLabel()
        });
    }

    async function refreshExaminoSettingsPanel() {
        if (site.id !== 'examino' || !omtRoot) return;
        const section = q('omt-examino-settings');
        if (section) section.style.display = 'flex';

        omtDebugSource('refresh:start');
        let source = { current: null, options: [] };
        try {
            source = await scrapeOpSettingOptions('source');
        } catch (err) {
            omtDebugSource('refresh:scrape-failed', String(err && err.message || err));
            source = {
                current: inferExaminoSourceLabel(),
                options: examinoLastGoodSourceOptions.slice()
            };
        }
        if (source && source.options && source.options.length >= 2) {
            rememberGoodSourceOptions(source.options);
        }
        const thin = !source || !source.options || source.options.length < 2;
        fillSelect(q('omt-examino-source'), source);

        const autoBox = q('omt-examino-auto-vod');
        if (autoBox) autoBox.checked = storageGetAutoVod();

        dismissOpSettingsChrome();

        // Re-scrape once after settle when Auto VOD asked for it, or scrape was thin.
        const needsSettle = thin || examinoSourceNeedsSettleRescrape;
        if (needsSettle) {
            examinoSourceNeedsSettleRescrape = false;
            omtDebugSource('refresh:reschedule-after-settle');
            if (examinoSourceSettleTimer) clearTimeout(examinoSourceSettleTimer);
            examinoSourceSettleTimer = setTimeout(() => {
                examinoSourceSettleTimer = null;
                scrapeOpSettingOptions('source').then((again) => {
                    if (again && again.options && again.options.length >= 2) {
                        rememberGoodSourceOptions(again.options);
                    }
                    fillSelect(q('omt-examino-source'), again && again.options && again.options.length
                        ? again
                        : {
                            current: inferExaminoSourceLabel(),
                            options: examinoLastGoodSourceOptions.slice()
                        });
                    dismissOpSettingsChrome();
                }).catch(() => {
                    fillSelect(q('omt-examino-source'), {
                        current: inferExaminoSourceLabel(),
                        options: examinoLastGoodSourceOptions.slice()
                    });
                });
            }, 900);
        }
    }

    function wireExaminoSettingsUI() {
        const section = q('omt-examino-settings');
        if (section) section.style.display = 'flex';

        const autoBox = q('omt-examino-auto-vod');
        if (autoBox) {
            autoBox.checked = storageGetAutoVod();
            autoBox.addEventListener('change', () => {
                storageSetAutoVod(!!autoBox.checked);
                mostrarOSD(autoBox.checked ? 'VOD auto-switch ON' : 'VOD auto-switch OFF');
                if (autoBox.checked) maybeAutoSwitchToVod(0).catch(() => {});
            });
        }

        const sourceSel = q('omt-examino-source');
        if (sourceSel) {
            sourceSel.addEventListener('change', async () => {
                const value = sourceSel.value;
                omtDebugSource('ui-change', { value });
                // Manual DVR must stop Auto VOD retries (post-1.2.0 field need;
                // does not change applyOpSetting itself).
                if (/dvr/i.test(String(value))) {
                    examinoManualSourceChoice = 'DVR';
                    examinoAutoVodClicked = true;
                } else if (/vod/i.test(String(value))) {
                    examinoManualSourceChoice = 'VOD';
                }
                const ok = await applyOpSetting('source', value);
                mostrarOSD(ok ? ('Source: ' + value) : 'Source change failed');
                if (ok) {
                    if (/vod/i.test(String(value))) examinoLastAppliedSource = 'VOD';
                    else if (/dvr/i.test(String(value))) examinoLastAppliedSource = 'DVR';
                    // Keep select enabled with DVR+VOD; do not path-refresh to Unavailable.
                    fillSelect(sourceSel, {
                        current: value,
                        options: examinoLastGoodSourceOptions.length
                            ? examinoLastGoodSourceOptions
                            : [{ value: 'DVR', label: 'DVR' }, { value: 'VOD', label: 'VOD' }]
                    });
                }
                // v1.2.0: do not refresh/force select from path after apply.
                omtDebugSource('ui-change:done', {
                    ok,
                    mediaUrl: (typeof window.__omtMockMediaUrl === 'string') ? window.__omtMockMediaUrl : null,
                    duration: (document.querySelector('video') || {}).duration,
                    omtSource: (document.querySelector('video') || {}).dataset
                        ? document.querySelector('video').dataset.omtSource
                        : null,
                    sel: sourceSel.value,
                    disabled: sourceSel.disabled
                });
            });
        }

        // Populate async shortly after mount (OpenPlayer menus may lag) — v1.2.0.
        // Clear any prior timer so a mid-apply Source click is not raced by refresh.
        if (examinoSettingsRefreshTimer) clearTimeout(examinoSettingsRefreshTimer);
        examinoSettingsRefreshTimer = setTimeout(() => {
            examinoSettingsRefreshTimer = null;
            refreshExaminoSettingsPanel().catch(() => {});
        }, 600);
    }

    // At most one Source→VOD click per page (2.0.3 lesson). 1.2.0 retried apply
    // up to 6 times; on hosts that never re-label Source as "VOD" that reloads
    // media repeatedly and blocks VOD from settling. Scrape retries remain.
    let examinoAutoVodClicked = false;

    async function maybeAutoSwitchToVod(attempt = 0) {
        if (site.id !== 'examino') return;
        if (!storageGetAutoVod()) return;
        if (examinoManualSourceChoice === 'DVR') return;
        if (examinoAutoVodClicked) return;
        omtDebugSource('auto-vod:start', { attempt });

        try {
            const source = await scrapeOpSettingOptions('source');
            const current = (source.current || '').toString();
            const hasVod = source.options.some((o) => /vod/i.test(o.value) || /vod/i.test(o.label));
            if (!hasVod) {
                dismissOpSettingsChrome();
                if (attempt < 6) {
                    setTimeout(() => {
                        maybeAutoSwitchToVod(attempt + 1).catch(() => {});
                    }, 700);
                }
                return;
            }
            if (/vod/i.test(current)) {
                dismissOpSettingsChrome();
                fillSelect(q('omt-examino-source'), source);
                omtDebugSource('auto-vod:already-vod', { current });
                return;
            }
            const vod = source.options.find((o) => /vod/i.test(o.value) || /vod/i.test(o.label));
            if (!vod) return;
            console.log('[OMT] Auto-switching Examino source to VOD:', vod.value, '(attempt ' + attempt + ')');
            examinoAutoVodClicked = true;
            rememberGoodSourceOptions(source.options);
            const ok = await applyOpSetting('source', vod.value);
            if (ok) {
                examinoLastAppliedSource = 'VOD';
                mostrarOSD('Switched to VOD');
                // Paint VOD immediately with DVR still available — do not wait on
                // a scrape that can fail while the host rebuilds after replace.
                fillSelect(q('omt-examino-source'), {
                    current: vod.value || 'VOD',
                    options: (source.options && source.options.length)
                        ? source.options
                        : examinoLastGoodSourceOptions
                });
                examinoSourceNeedsSettleRescrape = true;
                setTimeout(() => {
                    refreshExaminoSettingsPanel().catch(() => {});
                }, 1000);
            } else {
                omtDebugSource('auto-vod:apply-false-no-retry-click');
            }
        } catch (err) {
            console.warn('[OMT] Auto-VOD failed:', err && err.message);
            omtDebugSource('auto-vod:exception', String(err && err.message || err));
            if (!examinoAutoVodClicked && attempt < 6) {
                setTimeout(() => {
                    maybeAutoSwitchToVod(attempt + 1).catch(() => {});
                }, 700);
            }
        }
        dismissOpSettingsChrome();
    }

    function initExaminoPlayerFeatures() {
        installExaminoHotkeys();
        installExaminoClickToToggle();
        injectExaminoHideCSS();
        hideExaminoNativeChrome();
        startExaminoNativeChromeObserver();
        // Delay auto-VOD so OpenPlayer settings exist; retries handle late menus
        // and mid-switch <video> replacements. (v1.2.0)
        setTimeout(() => {
            maybeAutoSwitchToVod(0).catch((err) => {
                console.warn('[OMT] Auto-VOD failed:', err && err.message);
            });
        }, 1200);
    }

    // Compatibility stubs for shared callers (pdt.js / wire.js). Not part of
    // the v1.2.0 Source path; do not drive Source UI from these.
    function detectCurrentSource() {
        if (typeof window.__omtMockSource === 'string' && window.__omtMockSource) {
            return String(window.__omtMockSource).toUpperCase() === 'VOD' ? 'VOD'
                : String(window.__omtMockSource).toUpperCase() === 'DVR' ? 'DVR' : null;
        }
        if (vid && vid.dataset && vid.dataset.omtSource) {
            const s = String(vid.dataset.omtSource).toUpperCase();
            if (s === 'VOD' || s === 'DVR') return s;
        }
        return null;
    }

    function settleExaminoMediaAfterBind(mediaEl) {
        // Post-1.2.0 (1.2.2+) VOD→DVR settle — not part of 1.2.0 Source clicks,
        // but required so a carried VOD playhead does not freeze the DVR window.
        if (site.id !== 'examino') return;
        const el = mediaEl || vid ||
            (typeof site.findVideo === 'function' && site.findVideo()) ||
            document.querySelector('video');
        if (!el) return;
        userIntendedTime = null;
        seekLockUntil = 0;
        let settled = false;

        const goLiveEdgeIfNeeded = () => {
            if (settled || !el.isConnected) return;
            try {
                if (!el.seekable || el.seekable.length === 0) return;
                const start = el.seekable.start(0);
                const end = el.seekable.end(el.seekable.length - 1);
                if (!isFinite(start) || !isFinite(end)) return;
                settled = true;
                el.currentTime = Math.max(start, end - 2);
                try { el.play && el.play().catch(() => {}); } catch (_) {}
            } catch (_) {}
        };

        try {
            el.addEventListener('loadedmetadata', goLiveEdgeIfNeeded, { once: true });
        } catch (_) {}
        setTimeout(goLiveEdgeIfNeeded, 50);
        setTimeout(goLiveEdgeIfNeeded, 300);
    }
