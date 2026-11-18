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
    // v2.2.3: generation + busy reason so settle/refresh cannot overlap an apply
    // or reopen gear while the post-VOD player shell is still mounting.
    let examinoSettingsChain = Promise.resolve();
    let examinoSettingsLockDepth = 0;
    let examinoSettingsBusyReason = null;
    let examinoSettingsGen = 0;
    let examinoSettingsApplyBusy = false;
    let examinoSettingsQuietUntil = 0;
    // Declared early: cancelExaminoSettingsRefreshTimers may run before the Source block.
    let examinoSourceSettleTimer = null;
    let examinoSourceNeedsSettleRescrape = false;

    function withExaminoSettingsLock(fn, reason) {
        const tag = reason || 'work';
        const run = examinoSettingsChain.then(() => runLocked(fn, tag), () => runLocked(fn, tag));
        examinoSettingsChain = run.then(() => {}, () => {});
        return run;
    }

    async function runLocked(fn, tag) {
        examinoSettingsLockDepth++;
        examinoSettingsBusyReason = tag;
        omtDebugSource('lock:enter', { reason: tag, depth: examinoSettingsLockDepth, gen: examinoSettingsGen });
        try {
            return await fn();
        } finally {
            examinoSettingsLockDepth--;
            omtDebugSource('lock:leave', { reason: tag, depth: examinoSettingsLockDepth, gen: examinoSettingsGen });
            if (examinoSettingsLockDepth <= 0) {
                examinoSettingsLockDepth = 0;
                examinoSettingsBusyReason = null;
            }
        }
    }

    function cancelExaminoSettingsRefreshTimers() {
        if (examinoSettingsRefreshTimer) {
            clearTimeout(examinoSettingsRefreshTimer);
            examinoSettingsRefreshTimer = null;
        }
        if (examinoSourceSettleTimer) {
            clearTimeout(examinoSourceSettleTimer);
            examinoSourceSettleTimer = null;
        }
    }

    function bumpExaminoSettingsGen(reason) {
        examinoSettingsGen++;
        cancelExaminoSettingsRefreshTimers();
        omtDebugSource('settings-gen:bump', { gen: examinoSettingsGen, reason: reason || null });
        return examinoSettingsGen;
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

    /** Active OpenPlayer shell for the current <video> (post-VOD rebuild may create a new one). */
    function findExaminoActivePlayer() {
        const media = (vid && vid.isConnected ? vid : null) ||
            (typeof site.findVideo === 'function' && site.findVideo()) ||
            document.querySelector('video');
        if (media && media.closest) {
            const root = media.closest('.op-player') ||
                media.closest('.video-container') ||
                media.closest('.main-container') ||
                media.closest('.top');
            if (root) return root;
        }
        return document.querySelector('.op-player') || document;
    }

    function findExaminoSettingsGear() {
        const player = findExaminoActivePlayer();
        const scope = (player && player.querySelector) ? player : document;
        let holder = scope.querySelector('.setting-holder');
        let btn = scope.querySelector('.op-button.op-setting-button, .op-setting-button, #native-gear');
        // Fall back to document if the active player shell has no gear yet (mount race).
        if (!btn) {
            holder = document.querySelector('.setting-holder');
            btn = document.querySelector('.op-button.op-setting-button, .op-setting-button, #native-gear');
        }
        // Prefer a connected gear that lives under a player that still has a video.
        if (btn && !btn.isConnected) btn = null;
        return { player, holder, btn };
    }

    function describeExaminoSettingsDom() {
        const { player, holder, btn } = findExaminoSettingsGear();
        const panels = Array.from(document.querySelectorAll('.op-setting-panel'));
        const videos = Array.from(document.querySelectorAll('video'));
        const players = Array.from(document.querySelectorAll('.op-player'));
        let btnCs = null;
        let holderCs = null;
        try { if (btn) btnCs = getComputedStyle(btn); } catch (_) {}
        try { if (holder) holderCs = getComputedStyle(holder); } catch (_) {}
        return {
            gearFound: !!btn,
            gearConnected: !!(btn && btn.isConnected),
            gearVisibleClass: !!(btn && btn.classList.contains('omt-settings-temp-visible')),
            gearDisplay: btnCs ? btnCs.display : null,
            gearPE: btnCs ? btnCs.pointerEvents : null,
            gearOpacity: btnCs ? btnCs.opacity : null,
            holderFound: !!holder,
            holderDisplay: holderCs ? holderCs.display : null,
            holderHiddenClass: !!(holder && holder.classList.contains('omt-examino-native-hidden')),
            panelFound: panels.length > 0,
            panelCount: panels.length,
            panelOpen: panels.some((p) => p.classList.contains('open') || p.classList.contains('omt-settings-raised')),
            panelItems: panels.reduce((n, p) => n + p.querySelectorAll('.op-setting-item').length, 0),
            videoCount: videos.length,
            playerCount: players.length,
            activePlayerIsOp: !!(player && player.classList && player.classList.contains('op-player')),
            gearInActivePlayer: !!(btn && player && player.contains && player.contains(btn)),
            playerGen: (typeof window.__omtPlayerGeneration === 'number') ? window.__omtPlayerGeneration : null,
            mediaUrl: (typeof window.__omtMockMediaUrl === 'string') ? window.__omtMockMediaUrl : null
        };
    }

    function revealNativeSettingsButton() {
        const { holder, btn } = findExaminoSettingsGear();
        if (holder) holder.classList.add('omt-settings-temp-visible');
        if (btn) btn.classList.add('omt-settings-temp-visible');
        omtDebugSource('reveal-gear', describeExaminoSettingsDom());
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
        if (panel.querySelector('.op-setting-item')) return true;
        const cs = getComputedStyle(panel);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
    }

    function findOpenOpSettingsPanel() {
        const player = findExaminoActivePlayer();
        const scoped = (player && player.querySelectorAll)
            ? Array.from(player.querySelectorAll('.op-setting-panel'))
            : [];
        const all = scoped.length ? scoped : Array.from(document.querySelectorAll('.op-setting-panel'));
        return all.find((p) => isOpSettingsPanelVisible(p) || p.querySelector('.op-setting-item')) || null;
    }

    async function ensureOpSettingsOpen() {
        // v1.2.0 click path + suppress so click-to-toggle cannot steal gear clicks.
        // v2.2.3: close first (avoid toggle-shut), wait for post-VOD gear, rich timeout logs.
        return withClickToggleSuppressed(async () => {
            // Known-closed start so gear click opens instead of toggling an half-open panel shut.
            document.querySelectorAll('.op-setting-panel').forEach((p) => {
                p.classList.remove('open');
                p.classList.remove('omt-settings-raised');
            });

            let btn = null;
            for (let w = 0; w < 40; w++) {
                btn = revealNativeSettingsButton();
                if (btn && btn.isConnected) break;
                await sleep(50);
            }
            if (!btn) {
                omtDebugSource('ensure-panel:no-gear', describeExaminoSettingsDom());
                return null;
            }

            const clickGear = () => {
                const again = revealNativeSettingsButton() || btn;
                if (!again) return;
                try { again.click(); } catch (_) {}
            };

            clickGear();
            for (let i = 0; i < 24; i++) {
                await sleep(50);
                const panel = findOpenOpSettingsPanel();
                if (panel) {
                    panel.classList.add('omt-settings-raised');
                    omtDebugSource('ensure-panel:opened', {
                        items: panel.querySelectorAll('.op-setting-item').length,
                        ...describeExaminoSettingsDom()
                    });
                    return panel;
                }
                // Mid-wait: gear may have been replaced by a new player shell.
                if (i === 8 || i === 16) clickGear();
            }

            // One hard retry after a short settle (post-VOD player mount).
            await sleep(200);
            clickGear();
            for (let i = 0; i < 16; i++) {
                await sleep(50);
                const panel = findOpenOpSettingsPanel();
                if (panel) {
                    panel.classList.add('omt-settings-raised');
                    omtDebugSource('ensure-panel:opened-retry', {
                        items: panel.querySelectorAll('.op-setting-item').length,
                        ...describeExaminoSettingsDom()
                    });
                    return panel;
                }
            }

            omtDebugSource('ensure-panel:timeout', describeExaminoSettingsDom());
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
        return withExaminoSettingsLock(() => withClickToggleSuppressed(async () => {
            // Log inside the lock so overlapping scrape:start cannot appear for concurrent callers.
            omtDebugSource('scrape:start', {
                panelType,
                gen: examinoSettingsGen,
                busy: examinoSettingsBusyReason,
                applyBusy: examinoSettingsApplyBusy
            });
            let panel = await ensureOpSettingsOpen();
            if (!panel) {
                omtDebugSource('scrape:no-panel', describeExaminoSettingsDom());
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
            // Return to root for the next scrape without closing.
            // (Source DVR/VOD floor + host mapping happen in normalizeExaminoSourceScraped —
            // do not inject synthetic options into the scrape itself.)
            if (!document.querySelector('.op-setting-panel .op-setting-item[op-panel-type]')) {
                await clickOpSettingBack();
            }
            omtDebugSource('scrape:done', { panelType, current, options });
            return { current, options };
        }));
    }

    async function applyOpSetting(panelType, value) {
        if (!value) return false;
        omtDebugSource('apply:start', {
            panelType,
            value,
            path: location.pathname,
            v120: OMT_EXAMINO_SOURCE_V120,
            gen: examinoSettingsGen
        });
        // Drop pending refresh/settle so they cannot steal the submenu or toggle the gear shut.
        bumpExaminoSettingsGen('apply:' + panelType);
        examinoSettingsApplyBusy = true;
        try {
            return await withExaminoSettingsLock(() => withClickToggleSuppressed(async () => {
                let panel = await ensureOpSettingsOpen();
                if (!panel) {
                    omtDebugSource('apply:no-panel', describeExaminoSettingsDom());
                    return false;
                }
                if (!document.querySelector(`.op-setting-panel .op-setting-item[op-panel-type="${panelType}"]`)) {
                    await clickOpSettingBack();
                    panel = await ensureOpSettingsOpen();
                }
                const mainItem = document.querySelector(`.op-setting-panel .op-setting-item[op-panel-type="${panelType}"]`);
                if (!mainItem) {
                    omtDebugSource('apply:no-row', { panelType, ...describeExaminoSettingsDom() });
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
                    // Remember host op-data-value only. Do NOT flip lastApplied / live UI /
                    // DVR settle until media URL confirms (v2.2.3 field: UI raced ahead of stream).
                    if (panelType === 'source') {
                        const kind = classifyExaminoHostSourceOption({ value, label: value }) ||
                            (/vod/i.test(String(value)) ? 'VOD' : /dvr/i.test(String(value)) ? 'DVR' : null);
                        if (kind === 'VOD') examinoHostSourceMap.VOD = String(value);
                        else if (kind === 'DVR') examinoHostSourceMap.DVR = String(value);
                        omtDebugSource('apply:source-kind', {
                            value,
                            kind,
                            map: { DVR: examinoHostSourceMap.DVR, VOD: examinoHostSourceMap.VOD },
                            pendingMediaConfirm: true
                        });
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
            }), 'apply:' + panelType);
        } finally {
            examinoSettingsApplyBusy = false;
            // Quiet window: block settle/refresh gear thrash while the new player mounts.
            examinoSettingsQuietUntil = Date.now() + 1800;
        }
    }

    // Last successful Source apply + host op-data-value map for canonical DVR/VOD.
    // Field: host menu can list duplicates (DVR, DVR, VOD(1), VOD) — overlay shows
    // exactly two choices; apply still clicks the mapped host op-data-value.
    let examinoLastAppliedSource = null;
    let examinoHostSourceMap = { DVR: null, VOD: null }; // host op-data-value strings
    let examinoVodResumeSec = null; // optional restore when leaving DVR back to VOD
    let examinoLastGoodSourceOptions = [
        { value: 'DVR', label: 'DVR' },
        { value: 'VOD', label: 'VOD' }
    ];
    /** Media-URL / dataset only — never lastApplied / manual choice (those may race ahead). */
    function inferExaminoSourceFromMedia() {
        try {
            const el = (vid && vid.isConnected ? vid : null) ||
                (typeof site.findVideo === 'function' && site.findVideo()) ||
                document.querySelector('video');
            const url = (typeof window.__omtMockMediaUrl === 'string' && window.__omtMockMediaUrl) ||
                (el && el.dataset && el.dataset.omtMediaUrl) ||
                (el && (el.currentSrc || el.src)) || '';
            if (/chunklist_vod|\/vod\//i.test(url)) return 'VOD';
            if (/chunklist_dvr|\/live\//i.test(url)) return 'DVR';
            if (el && el.dataset && el.dataset.omtSource) {
                const s = String(el.dataset.omtSource).toUpperCase();
                if (s === 'VOD' || s === 'DVR') return s;
            }
        } catch (_) {}
        if (typeof window.__omtMockSource === 'string') {
            const s = String(window.__omtMockSource).toUpperCase();
            if (s === 'VOD' || s === 'DVR') return s;
        }
        return null;
    }

    /** Prefer confirmed apply, then media — not an in-flight select value. */
    function inferExaminoSourceLabel() {
        if (examinoLastAppliedSource === 'VOD' || examinoLastAppliedSource === 'DVR') {
            return examinoLastAppliedSource;
        }
        const fromMedia = inferExaminoSourceFromMedia();
        if (fromMedia) return fromMedia;
        if (examinoManualSourceChoice === 'VOD' || examinoManualSourceChoice === 'DVR') {
            return examinoManualSourceChoice;
        }
        return null;
    }

    /** Wait until the active media URL/dataset matches kind; adopt replaced <video> if needed. */
    async function waitExaminoMediaKind(kind, timeoutMs) {
        const want = String(kind || '').toUpperCase();
        const budget = typeof timeoutMs === 'number' ? timeoutMs : 5000;
        const started = Date.now();
        while (Date.now() - started < budget) {
            try {
                const el = document.querySelector('video');
                if (el && el !== vid && typeof omtAdoptReplacedVideo === 'function') {
                    omtAdoptReplacedVideo(el);
                }
            } catch (_) {}
            const got = inferExaminoSourceFromMedia();
            if (got === want) {
                omtDebugSource('media-confirm:ok', {
                    kind: want,
                    ms: Date.now() - started,
                    mediaUrl: (typeof window.__omtMockMediaUrl === 'string') ? window.__omtMockMediaUrl : null
                });
                return true;
            }
            await sleep(100);
        }
        omtDebugSource('media-confirm:timeout', {
            kind: want,
            got: inferExaminoSourceFromMedia(),
            mediaUrl: (typeof window.__omtMockMediaUrl === 'string') ? window.__omtMockMediaUrl : null,
            ...describeExaminoSettingsDom()
        });
        return false;
    }

    function commitExaminoSourceSuccess(canonical) {
        examinoLastAppliedSource = canonical;
        examinoManualSourceChoice = canonical;
        if (canonical === 'DVR') {
            examinoPendingDvrSettle = true;
            try {
                settleExaminoMediaAfterBind(
                    (typeof site.findVideo === 'function' && site.findVideo()) ||
                    document.querySelector('video')
                );
            } catch (_) {}
        } else if (canonical === 'VOD') {
            if (typeof examinoVodResumeSec === 'number' && isFinite(examinoVodResumeSec)) {
                const resumeAt = examinoVodResumeSec;
                examinoVodResumeSec = null;
                setTimeout(() => {
                    try {
                        const el = (typeof site.findVideo === 'function' && site.findVideo()) ||
                            document.querySelector('video');
                        if (!el) return;
                        const end = (el.seekable && el.seekable.length)
                            ? el.seekable.end(el.seekable.length - 1)
                            : (el.duration || resumeAt);
                        el.currentTime = Math.max(0, Math.min(resumeAt, end));
                    } catch (_) {}
                }, 80);
            }
        }
        if (typeof atualizarEstadoLive === 'function') {
            try { atualizarEstadoLive(); } catch (_) {}
        }
    }

    /** Classify a host Source row by op-data-value (primary) / label — not display duplicates. */
    function classifyExaminoHostSourceOption(o) {
        if (!o || o.value == null) return null;
        const value = String(o.value).trim();
        const label = String(o.label != null ? o.label : o.value).trim();
        if (/^dvr$/i.test(value)) return 'DVR';
        if (/^vod$/i.test(value)) return 'VOD';
        if (/^dvr$/i.test(label) && !/vod/i.test(value)) return 'DVR';
        if (/^vod$/i.test(label)) return 'VOD';
        // Loose: value wins over label; ignore decoys that are neither.
        if (/dvr/i.test(value) && !/vod/i.test(value)) return 'DVR';
        if (/vod/i.test(value)) return 'VOD';
        if (/dvr/i.test(label) && !/vod/i.test(label)) return 'DVR';
        if (/vod/i.test(label)) return 'VOD';
        return null;
    }

    function examinoHostOptionExactness(o, kind) {
        const value = String(o && o.value || '').trim();
        const label = String(o && o.label || '').trim();
        if (kind === 'DVR') {
            if (/^dvr$/i.test(value)) return 3;
            if (/^dvr$/i.test(label)) return 2;
            if (/dvr/i.test(value)) return 1;
            return 0;
        }
        if (/^vod$/i.test(value)) return 3;
        if (/^vod$/i.test(label)) return 2;
        if (/vod/i.test(value) && !/\(/i.test(value)) return 1; // prefer VOD over VOD(1)
        if (/vod/i.test(value) || /vod/i.test(label)) return 0;
        return -1;
    }

    function pickPreferredHostSourceOption(options, kind) {
        const list = (options || []).filter((o) => classifyExaminoHostSourceOption(o) === kind);
        if (!list.length) return null;
        list.sort((a, b) => examinoHostOptionExactness(b, kind) - examinoHostOptionExactness(a, kind));
        return list[0];
    }

    /**
     * Update canonical→host op-data-value map from a scrape.
     * DVR = page-default / first exact DVR; VOD = Auto-VOD target (exact VOD preferred).
     * Locked entries stick across scrapes so duplicates never reappear in the select.
     */
    function updateExaminoHostSourceMap(scraped) {
        const scrapedOpts = (scraped && scraped.options) ? scraped.options : [];
        omtDebugSource('source-map:scraped-host', scrapedOpts.map((o) => ({
            value: o.value,
            label: o.label,
            kind: classifyExaminoHostSourceOption(o)
        })));

        const pickDvr = pickPreferredHostSourceOption(scrapedOpts, 'DVR');
        const pickVod = pickPreferredHostSourceOption(scrapedOpts, 'VOD');
        const current = scraped && scraped.current != null ? String(scraped.current) : '';
        const currentKind = classifyExaminoHostSourceOption({ value: current, label: current });

        // DVR: prefer page-open / current host value when it is DVR-like.
        if (!examinoHostSourceMap.DVR) {
            if (currentKind === 'DVR') examinoHostSourceMap.DVR = current;
            else if (pickDvr) examinoHostSourceMap.DVR = String(pickDvr.value);
        } else if (pickDvr && examinoHostOptionExactness(pickDvr, 'DVR') >= 3 &&
            examinoHostSourceMap.DVR !== String(pickDvr.value)) {
            // Upgrade to exact "DVR" if we only had a fuzzy host id.
            const curExact = examinoHostOptionExactness(
                { value: examinoHostSourceMap.DVR, label: examinoHostSourceMap.DVR }, 'DVR');
            if (curExact < 3) examinoHostSourceMap.DVR = String(pickDvr.value);
        }

        // VOD: keep Auto-VOD / last successful VOD host value; else prefer exact "VOD".
        if (!examinoHostSourceMap.VOD) {
            if (pickVod) examinoHostSourceMap.VOD = String(pickVod.value);
        } else if (pickVod && examinoHostOptionExactness(pickVod, 'VOD') >= 3) {
            const curExact = examinoHostOptionExactness(
                { value: examinoHostSourceMap.VOD, label: examinoHostSourceMap.VOD }, 'VOD');
            if (curExact < 3) examinoHostSourceMap.VOD = String(pickVod.value);
        }

        // Floor host map so apply always has something to click.
        if (!examinoHostSourceMap.DVR) examinoHostSourceMap.DVR = 'DVR';
        if (!examinoHostSourceMap.VOD) examinoHostSourceMap.VOD = 'VOD';

        omtDebugSource('source-map:chosen', {
            map: { DVR: examinoHostSourceMap.DVR, VOD: examinoHostSourceMap.VOD },
            scrapedCurrent: current,
            inferred: inferExaminoSourceLabel()
        });
    }

    function resolveExaminoHostSourceValue(canonical) {
        const kind = /^vod/i.test(String(canonical)) ? 'VOD'
            : /^dvr/i.test(String(canonical)) ? 'DVR' : null;
        if (!kind) return canonical;
        return examinoHostSourceMap[kind] || kind;
    }

    function rememberGoodSourceOptions() {
        // Overlay always exposes exactly the canonical pair.
        examinoLastGoodSourceOptions = [
            { value: 'DVR', label: 'DVR' },
            { value: 'VOD', label: 'VOD' }
        ];
    }

    /** Overlay select: exactly DVR + VOD. Host duplicates mapped via examinoHostSourceMap. */
    function normalizeExaminoSourceScraped(scraped) {
        updateExaminoHostSourceMap(scraped || { current: null, options: [] });
        rememberGoodSourceOptions();

        let current = scraped && scraped.current != null ? String(scraped.current) : '';
        const currentKind = classifyExaminoHostSourceOption({ value: current, label: current });
        const inferred = inferExaminoSourceLabel();
        let canonical = inferred || currentKind || 'DVR';
        if (inferred === 'VOD' || currentKind === 'VOD') canonical = 'VOD';
        else if (inferred === 'DVR' || currentKind === 'DVR') canonical = 'DVR';
        // Prefer last apply / media when scrape still reports DVR after VOD.
        if (inferred === 'VOD') canonical = 'VOD';

        return {
            current: canonical,
            options: [
                { value: 'DVR', label: 'DVR' },
                { value: 'VOD', label: 'VOD' }
            ]
        };
    }

    function fillSelect(selectEl, scraped) {
        if (!selectEl) return;
        const { current, options } = normalizeExaminoSourceScraped(scraped);
        selectEl.innerHTML = '';
        selectEl.disabled = false;
        options.forEach((o) => {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            if (current && String(current) === String(o.value)) opt.selected = true;
            selectEl.appendChild(opt);
        });
        if (current) selectEl.value = current;
        omtDebugSource('fill-select', {
            current,
            value: selectEl.value,
            disabled: selectEl.disabled,
            options: options.map((o) => o.value),
            hostMap: { DVR: examinoHostSourceMap.DVR, VOD: examinoHostSourceMap.VOD },
            inferred: inferExaminoSourceLabel()
        });
    }

    async function refreshExaminoSettingsPanel() {
        if (site.id !== 'examino' || !omtRoot) return;
        if (examinoSettingsApplyBusy) {
            omtDebugSource('refresh:skipped-apply-busy');
            return;
        }
        if (Date.now() < examinoSettingsQuietUntil) {
            omtDebugSource('refresh:skipped-quiet', {
                remainMs: examinoSettingsQuietUntil - Date.now()
            });
            return;
        }
        const section = q('omt-examino-settings');
        if (section) section.style.display = 'flex';

        const genAtStart = examinoSettingsGen;
        omtDebugSource('refresh:start', { gen: genAtStart });
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
        if (genAtStart !== examinoSettingsGen || examinoSettingsApplyBusy) {
            omtDebugSource('refresh:aborted-stale', { genAtStart, gen: examinoSettingsGen });
            return;
        }
        rememberGoodSourceOptions();
        // Thin scrape = host returned fewer than 2 real rows before mapping.
        const thin = !source || !source.options || source.options.length < 2;
        fillSelect(q('omt-examino-source'), source);

        const autoBox = q('omt-examino-auto-vod');
        if (autoBox) autoBox.checked = storageGetAutoVod();

        dismissOpSettingsChrome();

        // Re-scrape once after settle when Auto VOD asked for it, or scrape was thin.
        // Never stack settle scrapes while apply/quiet is active (field: gear thrash).
        const needsSettle = thin || examinoSourceNeedsSettleRescrape;
        if (needsSettle) {
            examinoSourceNeedsSettleRescrape = false;
            omtDebugSource('refresh:reschedule-after-settle', { gen: examinoSettingsGen });
            if (examinoSourceSettleTimer) clearTimeout(examinoSourceSettleTimer);
            const settleGen = examinoSettingsGen;
            examinoSourceSettleTimer = setTimeout(() => {
                examinoSourceSettleTimer = null;
                if (settleGen !== examinoSettingsGen || examinoSettingsApplyBusy ||
                    Date.now() < examinoSettingsQuietUntil) {
                    omtDebugSource('refresh:settle-skipped', {
                        settleGen,
                        gen: examinoSettingsGen,
                        applyBusy: examinoSettingsApplyBusy
                    });
                    return;
                }
                scrapeOpSettingOptions('source').then((again) => {
                    if (settleGen !== examinoSettingsGen || examinoSettingsApplyBusy) return;
                    rememberGoodSourceOptions();
                    fillSelect(q('omt-examino-source'), again && again.options && again.options.length
                        ? again
                        : {
                            current: inferExaminoSourceLabel(),
                            options: examinoLastGoodSourceOptions.slice()
                        });
                    dismissOpSettingsChrome();
                }).catch(() => {
                    if (settleGen !== examinoSettingsGen) return;
                    fillSelect(q('omt-examino-source'), {
                        current: inferExaminoSourceLabel(),
                        options: examinoLastGoodSourceOptions.slice()
                    });
                });
            }, 1200);
        }
    }

    function wireExaminoSettingsUI() {
        const section = q('omt-examino-settings');
        if (section) section.style.display = 'flex';

        const autoBox = q('omt-examino-auto-vod');
        // Bind once per DOM node (teardown/boot builds a new select after player swap).
        if (autoBox && autoBox.dataset.omtWired !== '1') {
            autoBox.dataset.omtWired = '1';
            autoBox.checked = storageGetAutoVod();
            autoBox.addEventListener('change', () => {
                storageSetAutoVod(!!autoBox.checked);
                mostrarOSD(autoBox.checked ? 'VOD auto-switch ON' : 'VOD auto-switch OFF');
                if (autoBox.checked) maybeAutoSwitchToVod(0).catch(() => {});
            });
        } else if (autoBox) {
            autoBox.checked = storageGetAutoVod();
        }

        const sourceSel = q('omt-examino-source');
        if (sourceSel && sourceSel.dataset.omtWired !== '1') {
            sourceSel.dataset.omtWired = '1';
            sourceSel.addEventListener('change', async () => {
                const canonical = /^vod/i.test(String(sourceSel.value)) ? 'VOD'
                    : /^dvr/i.test(String(sourceSel.value)) ? 'DVR'
                    : String(sourceSel.value);
                const hostValue = resolveExaminoHostSourceValue(canonical);
                const prevMedia = inferExaminoSourceFromMedia() || examinoLastAppliedSource || 'VOD';
                omtDebugSource('ui-change', {
                    value: sourceSel.value,
                    canonical,
                    hostValue,
                    prevMedia,
                    map: { DVR: examinoHostSourceMap.DVR, VOD: examinoHostSourceMap.VOD }
                });
                // Stop Auto VOD retries without flipping liveMode (manual choice waits
                // for media URL confirm — field 2.2.2: UI went live while stream stayed VOD).
                if (canonical === 'DVR') {
                    try {
                        const el = (typeof site.findVideo === 'function' && site.findVideo()) ||
                            document.querySelector('video');
                        if (el && (inferExaminoSourceFromMedia() === 'VOD' ||
                            /vod/i.test(String(el.dataset && el.dataset.omtSource || '')))) {
                            examinoVodResumeSec = Number(el.currentTime) || 0;
                        }
                    } catch (_) {}
                    examinoAutoVodClicked = true;
                }
                // Keep working v1.2.0 apply path — click host op-data-value, not the label.
                const okClick = await applyOpSetting('source', hostValue);
                let mediaOk = false;
                if (okClick && (canonical === 'VOD' || canonical === 'DVR')) {
                    mediaOk = await waitExaminoMediaKind(canonical, 5500);
                }
                const ok = !!(okClick && mediaOk);
                // Player shell / HUD may have been rebuilt during media wait — re-query select.
                const selNow = q('omt-examino-source') || sourceSel;
                if (ok) {
                    commitExaminoSourceSuccess(canonical);
                    fillSelect(selNow, {
                        current: canonical,
                        options: [
                            { value: 'DVR', label: 'DVR' },
                            { value: 'VOD', label: 'VOD' }
                        ]
                    });
                    mostrarOSD('Source: ' + canonical);
                } else {
                    // Revert select + keep prior confirmed source (do not leave live UI stuck).
                    fillSelect(selNow, {
                        current: prevMedia === 'DVR' || prevMedia === 'VOD'
                            ? prevMedia
                            : (inferExaminoSourceLabel() || 'VOD'),
                        options: [
                            { value: 'DVR', label: 'DVR' },
                            { value: 'VOD', label: 'VOD' }
                        ]
                    });
                    mostrarOSD('Source change failed');
                    if (typeof atualizarEstadoLive === 'function') {
                        try { atualizarEstadoLive(); } catch (_) {}
                    }
                }
                omtDebugSource('ui-change:done', {
                    ok,
                    okClick,
                    mediaOk,
                    canonical,
                    hostValue,
                    prevMedia,
                    mediaUrl: (typeof window.__omtMockMediaUrl === 'string') ? window.__omtMockMediaUrl : null,
                    duration: (document.querySelector('video') || {}).duration,
                    omtSource: (document.querySelector('video') || {}).dataset
                        ? document.querySelector('video').dataset.omtSource
                        : null,
                    sel: selNow ? selNow.value : null,
                    disabled: selNow ? selNow.disabled : null,
                    lastApplied: examinoLastAppliedSource,
                    manual: examinoManualSourceChoice
                });
            });
        }

        // Populate async shortly after mount (OpenPlayer menus may lag) — v1.2.0.
        // Clear any prior timer so a mid-apply Source click is not raced by refresh.
        cancelExaminoSettingsRefreshTimers();
        const wireGen = examinoSettingsGen;
        examinoSettingsRefreshTimer = setTimeout(() => {
            examinoSettingsRefreshTimer = null;
            if (wireGen !== examinoSettingsGen || examinoSettingsApplyBusy) return;
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
            // Build host map from this scrape (locks exact VOD over VOD(1)).
            updateExaminoHostSourceMap(source);
            const currentKind = classifyExaminoHostSourceOption({ value: current, label: current });
            if (currentKind === 'VOD' || /vod/i.test(current)) {
                dismissOpSettingsChrome();
                fillSelect(q('omt-examino-source'), source);
                omtDebugSource('auto-vod:already-vod', { current });
                return;
            }
            const vod = pickPreferredHostSourceOption(source.options, 'VOD');
            if (!vod) return;
            console.log('[OMT] Auto-switching Examino source to VOD:', vod.value, '(attempt ' + attempt + ')');
            examinoAutoVodClicked = true;
            examinoHostSourceMap.VOD = String(vod.value);
            rememberGoodSourceOptions();
            omtDebugSource('auto-vod:chosen', {
                hostValue: vod.value,
                label: vod.label,
                map: { DVR: examinoHostSourceMap.DVR, VOD: examinoHostSourceMap.VOD },
                scraped: source.options.map((o) => ({ value: o.value, label: o.label }))
            });
            // Keep working v1.2.0 apply path — click the preferred host op-data-value.
            const okClick = await applyOpSetting('source', vod.value);
            const mediaOk = okClick ? await waitExaminoMediaKind('VOD', 5500) : false;
            if (okClick && mediaOk) {
                commitExaminoSourceSuccess('VOD');
                mostrarOSD('Switched to VOD');
                // Paint canonical VOD with DVR still available — never dump host duplicates.
                fillSelect(q('omt-examino-source'), {
                    current: 'VOD',
                    options: [
                        { value: 'DVR', label: 'DVR' },
                        { value: 'VOD', label: 'VOD' }
                    ]
                });
                // One delayed refresh after quiet window — do not stack settle scrapes.
                examinoSourceNeedsSettleRescrape = true;
                const autoGen = examinoSettingsGen;
                setTimeout(() => {
                    if (autoGen !== examinoSettingsGen || examinoSettingsApplyBusy) return;
                    refreshExaminoSettingsPanel().catch(() => {});
                }, 2000);
            } else {
                examinoAutoVodClicked = false;
                omtDebugSource('auto-vod:apply-or-media-failed', { okClick, mediaOk });
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
    // v2.2.3: prefer real media URL so liveMode cannot flip before the stream does.
    function detectCurrentSource() {
        const fromMedia = inferExaminoSourceFromMedia();
        if (fromMedia) return fromMedia;
        if (examinoLastAppliedSource === 'VOD' || examinoLastAppliedSource === 'DVR') {
            return examinoLastAppliedSource;
        }
        return null;
    }

    function settleExaminoMediaAfterBind(mediaEl) {
        // Post-1.2.0 (1.2.2+) VOD→DVR settle — not part of 1.2.0 Source clicks,
        // but required so a carried VOD playhead does not freeze the short DVR window.
        // Prefer adaptive live safe point (same as LIVE jump); fall back to end−2.
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
                let target = (typeof omtLiveSafePointSec === 'function')
                    ? omtLiveSafePointSec()
                    : Math.max(start, end - 2);
                if (!(target > 0) || target < start || target > end) {
                    target = Math.max(start, end - 2);
                }
                // Clamp into the DVR window so a deep VOD playhead cannot stall.
                target = Math.max(start, Math.min(end, target));
                settled = true;
                el.currentTime = target;
                omtDebugSource('settle-dvr', {
                    start,
                    end,
                    target,
                    usedSafePoint: typeof omtLiveSafePointSec === 'function'
                });
                try { el.play && el.play().catch(() => {}); } catch (_) {}
            } catch (_) {}
        };

        try {
            el.addEventListener('loadedmetadata', goLiveEdgeIfNeeded, { once: true });
        } catch (_) {}
        setTimeout(goLiveEdgeIfNeeded, 50);
        setTimeout(goLiveEdgeIfNeeded, 300);
        setTimeout(goLiveEdgeIfNeeded, 800);
    }
