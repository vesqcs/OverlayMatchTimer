/* ============================================================
   Overlay MatchTimer — Chrome Extension Content Script
   Runs in MAIN world on InplayIP / Examino (OpenPlayer).
   Site-specific selectors & positioning live in SITE ADAPTERS;
   shared timer/HUD logic is shared below.
   ============================================================ */

(function () {
    'use strict';

    // SPA monitor interval handle
    let spaMonitorInterval = null;
    let bootObserver = null;
    let fullscreenHooked = false;
    let nativeChromeObserver = null;
    let examinoHotkeysInstalled = false;
    let examinoSettingsRefreshTimer = null;

    /* =========================================================
       MODULE STATE
       ========================================================= */
    let vid = null;           // The <video> element on the page
    let omtRoot = null;       // Our injected container div
    let hlsInstance = null;   // The hls.js / VHS instance (if found)

    // Timer state
    let offsetEmSegundos = 0;
    let tempoBase = 0;
    let timerAtivo = false;
    let osdTimeout = null;
    let isDraggingTimeline = false;
    let isManuallyHidden = false;
    let mouseMoveTimeout = null;
    let controlsObserver = null; // MutationObserver watching the video 'controls' attribute
    let isEditingTimer = false;
    const isLocalVideo = false; // Extension always targets a live/DVR stream

    // Kickoff markers (persisted in localStorage)
    let kickoff1 = localStorage.getItem('matchTimerKickoff1') !== null ? parseFloat(localStorage.getItem('matchTimerKickoff1')) : null;
    let kickoff2 = localStorage.getItem('matchTimerKickoff2') !== null ? parseFloat(localStorage.getItem('matchTimerKickoff2')) : null;
    let kickoffC1 = localStorage.getItem('matchTimerKickoffC1') !== null ? parseFloat(localStorage.getItem('matchTimerKickoffC1')) : null;
    let kickoffC2 = localStorage.getItem('matchTimerKickoffC2') !== null ? parseFloat(localStorage.getItem('matchTimerKickoffC2')) : null;
    let previousHalf = localStorage.getItem('matchTimerHalf') || '1';

    // Anti-live-snap: track where the user *intended* to be
    let userIntendedTime = null;
    let seekLockUntil = 0; // epoch ms until which we protect the seek position

    // Volume
    let ultimoVolume = 1;

    // Cached UI element refs (populated after injection)
    let timerUI, osd, setupPanel, controlsPanel, timelineSlider,
        vTimeCurrent, vTimeDuration, liveBtn, btnMainPlay, speedSelect,
        volumeRange, volumeIconBtn, shuttleToggle, shuttleCheatsheet;

    /* =========================================================
       SITE ADAPTERS
       Isolate host-specific DOM / mode / fullscreen behaviour so
       InplayIP keeps its proven Review/Live SPA logic while Examino
       uses OpenPlayer-aware wait/anchor/suppress rules.
       ========================================================= */
    const SITE_INPLAYIP = {
        id: 'inplayip',
        rootClass: 'omt-inplayip',

        findVideo() {
            // Prefer the Video.js tech element
            const tech = document.querySelector('.vjs-tech');
            if (tech && tech.tagName === 'VIDEO') return tech;
            const any = document.querySelector('video');
            return any || null;
        },

        findAnchor(videoEl) {
            return videoEl.closest('.video-js') ||
                videoEl.closest('.vjs-player') ||
                videoEl.parentElement;
        },

        findFullscreenTarget(videoEl) {
            return videoEl.closest('.video-js') || videoEl.parentElement || videoEl;
        },

        // Exact Inplay Review/Live signals from the known-good baseline.
        isReviewStream() {
            return !!document.querySelector('.vjs-progress-control');
        },

        isLiveStream() {
            const bodyText = document.body ? document.body.innerText : '';
            if (/\b(hd|sd)\s+live\b/i.test(bodyText)) return true;
            const hasLiveUI = !!document.querySelector('.vjs-live-control, .vjs-live-display');
            const hasProgress = !!document.querySelector('.vjs-progress-control');
            if (hasLiveUI && !hasProgress) return true;
            return false;
        },

        suppressHostControls(videoEl) {
            document.querySelectorAll('.video-js, .vjs-tech').forEach(el => {
                el.setAttribute('tabindex', '-1');
            });
        },

        // MSE DVR on Inplay Review exposes a finite duration — keep baseline gate.
        mediaReady(videoEl) {
            return !!(videoEl && videoEl.duration && isFinite(videoEl.duration));
        },

        effectiveDuration(videoEl) {
            if (videoEl && videoEl.duration && isFinite(videoEl.duration)) return videoEl.duration;
            return NaN;
        }
    };

    const SITE_EXAMINO = {
        id: 'examino',
        rootClass: 'omt-examino',

        findVideo() {
            const inOp = document.querySelector('.op-media-element-container video, .op-player video');
            if (inOp) return inOp;
            const any = document.querySelector('video');
            return any || null;
        },

        findAnchor(videoEl) {
            // Prefer the OpenPlayer root that typically owns fullscreen, then
            // fall back to the media container / parent.
            return videoEl.closest('.op-player') ||
                videoEl.closest('.video-container') ||
                videoEl.closest('.op-media-element-container') ||
                videoEl.parentElement;
        },

        findFullscreenTarget(videoEl) {
            return videoEl.closest('.op-player') ||
                videoEl.closest('.video-container') ||
                videoEl.closest('.op-media-element-container') ||
                videoEl.parentElement ||
                videoEl;
        },

        // Examino /play/dvr/ pages are already DVR — no Live/Review fork.
        isReviewStream() { return true; },
        isLiveStream() { return false; },

        suppressHostControls(videoEl) {
            injectExaminoHideCSS();
            hideExaminoNativeChrome();
            startExaminoNativeChromeObserver();
            // Soften OpenPlayer keyboard/focus capture so our capture-phase
            // hotkeys win; CSS hides the chrome.
            const root = this.findAnchor(videoEl) || document;
            root.querySelectorAll(
                '.op-controls, .op-ui, .op-progressbar-container, .button-bar, .examino-bottom-controls, video, button, [tabindex]'
            ).forEach(el => {
                if (el.id === 'omt-root' || (omtRoot && omtRoot.contains(el))) return;
                try { el.setAttribute('tabindex', '-1'); } catch (_) {}
            });
        },

        // OpenPlayer MSE often reports duration=Infinity; seekable end is enough.
        mediaReady(videoEl) {
            if (!videoEl) return false;
            if (videoEl.duration && isFinite(videoEl.duration)) return true;
            try {
                return !!(videoEl.seekable && videoEl.seekable.length > 0);
            } catch (_) {
                return false;
            }
        },

        effectiveDuration(videoEl) {
            if (!videoEl) return NaN;
            if (videoEl.duration && isFinite(videoEl.duration)) return videoEl.duration;
            try {
                if (videoEl.seekable && videoEl.seekable.length > 0) {
                    return videoEl.seekable.end(videoEl.seekable.length - 1);
                }
            } catch (_) {}
            return NaN;
        }
    };

    // Xeatre works differently (URL paste into the HTML app). Out of scope —
    // leave a stub so a future adapter can plug in without another rewrite.
    const SITE_XEATRE = {
        id: 'xeatre',
        rootClass: 'omt-xeatre',
        findVideo() { return null; },
        findAnchor() { return null; },
        findFullscreenTarget() { return null; },
        isReviewStream() { return false; },
        isLiveStream() { return false; },
        suppressHostControls() {},
        mediaReady() { return false; },
        effectiveDuration() { return NaN; },
        // TODO(xeatre): dedicated adapter when Xeatre DVR is reachable again.
        stub: true
    };

    function detectSite() {
        const host = (location.hostname || '').toLowerCase();
        const path = location.pathname || '';
        const forced = (document.documentElement.dataset.omtSite || '').toLowerCase();

        if (forced === 'examino' || host.includes('examino') || /examino/i.test(path)) {
            return SITE_EXAMINO;
        }
        // TODO(xeatre): enable when bringing Xeatre injection back
        if (forced === 'xeatre' || host.includes('xeatre')) {
            return SITE_XEATRE;
        }
        if (forced === 'inplayip' || host.includes('inplayip') || /inplay/i.test(path)) {
            return SITE_INPLAYIP;
        }
        // Local Playwright fixtures served from 127.0.0.1 / localhost
        if (host === 'localhost' || host === '127.0.0.1') {
            if (/examino/i.test(path)) return SITE_EXAMINO;
            if (/inplay/i.test(path)) return SITE_INPLAYIP;
        }
        return null;
    }

    const site = detectSite();
    if (!site) {
        console.log('[OMT] No matching site adapter — content script idle.');
        return;
    }
    if (site.stub) {
        console.log('[OMT] Xeatre adapter is a stub (out of scope) — content script idle.');
        return;
    }
    console.log('[OMT] Site adapter:', site.id);

    /* =========================================================
       1. BOOT — WAIT FOR VIDEO ELEMENT
       ========================================================= */
    function teardown() {
        // Stop the SPA monitor before re-init to avoid double-starts
        if (spaMonitorInterval) {
            clearInterval(spaMonitorInterval);
            spaMonitorInterval = null;
        }
        if (bootObserver) {
            bootObserver.disconnect();
            bootObserver = null;
        }
        // Stop any running timers
        if (mouseMoveTimeout) {
            clearTimeout(mouseMoveTimeout);
            mouseMoveTimeout = null;
        }
        if (osdTimeout) {
            clearTimeout(osdTimeout);
            osdTimeout = null;
        }
        // Clean up ShuttleXpress
        cleanupShuttle();
        if (navigator.hid) {
            try {
                navigator.hid.removeEventListener('disconnect', handleHidDisconnect);
            } catch (e) {}
        }
        // Disconnect the controls-attribute observer (started in suppressNativeControls)
        if (controlsObserver) {
            controlsObserver.disconnect();
            controlsObserver = null;
        }
        if (nativeChromeObserver) {
            nativeChromeObserver.disconnect();
            nativeChromeObserver = null;
        }
        if (examinoSettingsRefreshTimer) {
            clearTimeout(examinoSettingsRefreshTimer);
            examinoSettingsRefreshTimer = null;
        }
        // InplayIP: remove document capture listener. Examino keeps a persistent
        // window capture listener installed at document_start.
        if (site.id !== 'examino') {
            document.removeEventListener('keydown', handleKeydown, true);
        }
        // Remove the injected HUD from the DOM
        const existingRoot = document.getElementById('omt-root');
        if (existingRoot && existingRoot.parentNode) {
            existingRoot.parentNode.removeChild(existingRoot);
        }
        // Clear element references
        omtRoot = null;
        vid = null;
        hlsInstance = null;
        timerUI = null;
        osd = null;
        setupPanel = null;
        controlsPanel = null;
        shuttleToggle = null;
        shuttleCheatsheet = null;
        liveBtn = null;
        btnMainPlay = null;
        timelineSlider = null;
        vTimeCurrent = null;
        vTimeDuration = null;
        speedSelect = null;
        volumeRange = null;
        volumeIconBtn = null;

        // --- TOTAL LIFECYCLE RESET (Bug 1 fix) ---
        // Every SPA navigation must begin with a completely clean slate so that
        // going Live -> Review (or any other transition) re-evaluates everything
        // from scratch without stale flags blocking re-injection.
        isManuallyHidden = false;
        isDraggingTimeline = false;
        isEditingTimer = false;
        userIntendedTime = null;
        seekLockUntil = 0;
        timerAtivo = false;
        offsetEmSegundos = 0;
        tempoBase = 0;
    }

    /* =========================================================
       1A. STREAM MODE DETECTION — delegated to site adapter
       =========================================================
       InplayIP: Review vs Live via VJS control-bar / text badges
       (byte-equivalent to the known-good baseline).
       Examino: /play/dvr/ is always treated as Review/DVR.
    */
    function isReviewStream() { return site.isReviewStream(); }
    function isLiveStream() { return site.isLiveStream(); }

    /* =========================================================
       1B. BOOT — OBSERVE FOR PLAYER, THEN ROUTE BY MODE
       =========================================================
       boot() is the single entry point for all (re-)initializations.
       InplayIP waits for the VJS control bar before deciding mode.
       Examino waits for a (possibly late / replaced) <video> via
       MutationObserver — OpenPlayer mounts after document_idle.
    */
    function boot() {
        if (bootObserver) {
            bootObserver.disconnect();
            bootObserver = null;
        }

        // --- Immediate check: player may already be in the DOM ---
        if (isReviewStream()) {
            const v = findVideo();
            if (v) { init(v); return; }
            // Review/DVR signal present (or Examino always-DVR) but <video> not
            // mounted yet — fall through to the MutationObserver below.
        } else if (site.id === 'inplayip' && isLiveStream()) {
            console.log('[OMT] Live stream — extension inactive. Watching for next session.');
            startSPAMonitor();
            return;
        }

        // --- Player / video not ready yet: observe DOM mutations ---
        bootObserver = new MutationObserver(() => {
            if (site.id === 'inplayip') {
                if (isReviewStream()) {
                    const v = findVideo();
                    if (!v) return; // Video element itself not yet attached — keep watching.
                    bootObserver.disconnect();
                    bootObserver = null;
                    init(v);
                    return;
                }
                if (isLiveStream()) {
                    bootObserver.disconnect();
                    bootObserver = null;
                    console.log('[OMT] Live stream — extension inactive. Watching for next session.');
                    startSPAMonitor();
                }
                return;
            }

            // Examino (and other always-DVR adapters): any video is enough.
            const v = findVideo();
            if (!v) return;
            bootObserver.disconnect();
            bootObserver = null;
            init(v);
        });
        bootObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function findVideo() {
        return site.findVideo();
    }

    /* =========================================================
       1C. SPA MONITOR — DETECT VIDEO REMOVAL / STREAM SWITCH
       =========================================================
       Runs every 1500 ms once a session (Live or Review) is active.
       Detects three events and responds to each with teardown()+boot():

         • Video element removed  → user exited the player back to schedule.
         • Video present, HUD gone → stream was swapped (Review→Live or vice versa).
         • Video element replaced  → a new player instance was mounted.

       In all cases teardown() wipes all state, and boot() starts fresh
       observation so the next session is correctly detected and handled.
    */
    function startSPAMonitor() {
        if (spaMonitorInterval) return; // Already running — do not double-start.
        spaMonitorInterval = setInterval(() => {
            const currentVid = findVideo();
            const currentRoot = document.getElementById('omt-root');

            if (!currentVid) {
                // Video element gone — player was closed. Clean up and go back
                // to watching state so the next session triggers correctly.
                teardown();
                boot();
                return;
            }

            if (currentVid && !currentRoot) {
                // A new stream loaded but our HUD is missing — stream was swapped.
                // Full teardown, then re-evaluate mode from scratch.
                teardown();
                boot();
                return;
            }

            if (currentVid && currentVid !== vid) {
                // The video element itself was replaced by a new one.
                teardown();
                boot();
            }
        }, 1500);
    }

    function init(videoEl) {
        vid = videoEl;
        vid.preservesPitch = true;

        // Inject synchronously — control-bar detection already confirmed
        // this is a Review/DVR session with a seekable timeline.
        hlsInstance = getHlsInstance();
        patchHlsForDvr();
        suppressNativeControls();
        injectUI();
        cacheUIRefs();
        wireEvents();
        restoreState();
        startSPAMonitor();
        initShuttleXpress();
        if (site.id === 'examino') {
            initExaminoPlayerFeatures();
        }
        console.log('[OMT] Overlay MatchTimer active — Review/DVR mode.');
    }

    /* =========================================================
       2. HLS INSTANCE DISCOVERY & DVR PATCH
       ========================================================= */
    function getHlsInstance() {
        // ---- Try Video.js player registry ----
        if (window.videojs) {
            try {
                const players = videojs.getPlayers ? videojs.getPlayers() : {};
                for (const id in players) {
                    const player = players[id];
                    if (!player) continue;
                    // Access tech without triggering deprecation warning
                    const tech = player.tech_ || (player.tech && player.tech({ IWillNotUseThisInPlugins: true }));
                    if (!tech) continue;
                    if (tech.vhs) return tech.vhs;        // Video.js VHS
                    if (tech.hls) return tech.hls;        // older videojs-contrib-hls
                    if (tech.hlsProvider && tech.hlsProvider.hls) return tech.hlsProvider.hls;
                    if (tech.hls_) return tech.hls_;
                }
            } catch (e) { /* ignore */ }
        }
        // ---- Fallback: hls.js attached directly to the element ----
        if (vid._hls) return vid._hls;
        if (vid.hls) return vid.hls;
        return null;
    }

    function patchHlsForDvr() {
        if (!hlsInstance) return;
        try {
            // hls.js config object
            if (hlsInstance.config) {
                hlsInstance.config.liveMaxLatencyDuration = 86400;
                hlsInstance.config.liveSyncDuration = 5;
                console.log('[OMT] HLS DVR patch applied.');
            }
            // VHS: update playlist controller if available
            if (hlsInstance.masterPlaylistController_) {
                const mpc = hlsInstance.masterPlaylistController_;
                if (mpc.hls_ && mpc.hls_.config) {
                    mpc.hls_.config.liveMaxLatencyDuration = 86400;
                }
            }
        } catch (e) {
            console.log('[OMT] HLS patch skipped:', e.message);
        }
    }

    /* =========================================================
       3. SUPPRESS NATIVE VIDEO.JS CONTROLS
       ========================================================= */
    function suppressNativeControls() {
        vid.controls = false;

        // Video.js / OpenPlayer may re-enable native controls during startup.
        // We watch for that race condition and immediately override it.
        // Performance contract:
        //   - The callback is debounced (10 ms) so rapid consecutive mutations
        //     collapse into a single correction instead of firing per-attribute-write.
        //   - The observer automatically disconnects after 10 s — more than enough
        //     time to win any VJS startup race — so it never polls continuously.
        //   - The module-level `controlsObserver` reference lets teardown() clean
        //     it up immediately on SPA navigation without waiting for the timer.
        let debounceTimer = null;
        controlsObserver = new MutationObserver(() => {
            if (debounceTimer) return; // already scheduled, collapse this mutation
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                if (vid && vid.controls) vid.controls = false;
            }, 10);
        });
        controlsObserver.observe(vid, { attributes: true, attributeFilter: ['controls'] });

        // Auto-disconnect once the VJS startup window has passed.
        const autoDisconnectMs = 10000;
        setTimeout(() => {
            if (controlsObserver) {
                controlsObserver.disconnect();
                controlsObserver = null;
                console.log('[OMT] controls-attribute observer disconnected (startup window elapsed).');
            }
        }, autoDisconnectMs);

        // Site-specific native chrome / focus suppression (Inplay VJS or OpenPlayer).
        site.suppressHostControls(vid);
    }

    /* =========================================================
       4. INJECT UI INTO THE PAGE
       ========================================================= */
    function injectUI() {
        const anchor = site.findAnchor(vid);

        if (!anchor) { console.error('[OMT] Could not find anchor element.'); return; }

        // Ensure relative positioning so absolute children work
        const cs = getComputedStyle(anchor);
        if (cs.position === 'static') anchor.style.position = 'relative';

        omtRoot = document.createElement('div');
        omtRoot.id = 'omt-root';
        omtRoot.classList.add(site.rootClass);
        omtRoot.innerHTML = buildHTML();
        anchor.appendChild(omtRoot);

        updateCompactLayout();
        ensureFullscreenHook();
    }

    function updateCompactLayout() {
        if (!omtRoot) return;
        // Examino popup players are often ~465×261 — shrink chrome so the HUD fits.
        const anchor = omtRoot.parentElement;
        const w = (anchor && anchor.clientWidth) || window.innerWidth;
        const h = (anchor && anchor.clientHeight) || window.innerHeight;
        const compact = site.id === 'examino' && (w < 720 || h < 420);
        omtRoot.classList.toggle('omt-compact', compact);
    }

    function ensureFullscreenHook() {
        if (fullscreenHooked) return;
        fullscreenHooked = true;
        document.addEventListener('fullscreenchange', () => {
            if (!vid || !omtRoot) return;
            updateCompactLayout();
            // If OpenPlayer (or the browser) fullscreens a parent that does not
            // contain our root, reparent so the overlay stays visible.
            const fs = document.fullscreenElement;
            if (fs && fs.contains(vid) && !fs.contains(omtRoot)) {
                fs.appendChild(omtRoot);
                const cs = getComputedStyle(fs);
                if (cs.position === 'static') fs.style.position = 'relative';
            } else if (!fs && vid.isConnected) {
                const anchor = site.findAnchor(vid);
                if (anchor && omtRoot.parentElement !== anchor) {
                    anchor.appendChild(omtRoot);
                }
            }
        });
        window.addEventListener('resize', () => updateCompactLayout());
    }

    function buildHTML() {
        return `
<div id="match-timer">00:00</div>
<div id="osd-message">MatchTimer</div>

<!-- SETUP PANEL -->
<div id="setup-panel" class="glass-panel">
    <div class="drag-handle" id="setup-handle">
        <div class="drag-side-left">
            <button class="handle-btn" style="cursor:default;opacity:0.6;">⚙️</button>
        </div>
        <div class="drag-center-grip">≡</div>
        <div class="drag-side-right">
            <button class="handle-btn" id="omt-btn-close-setup" style="color:#ff4444;font-weight:bold;" title="Close">✕</button>
        </div>
    </div>
    <div class="setup-content">

        <div class="brand-container">
            <svg width="260" height="50" viewBox="0 0 260 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g transform="translate(5,4)">
                    <circle cx="20" cy="23" r="17" fill="#151515" stroke="#66b3ff" stroke-width="2.5"/>
                    <rect x="16" y="2" width="8" height="4" rx="1" fill="#66b3ff"/>
                    <path d="M33 9 L36 6" stroke="#66b3ff" stroke-width="2.5" stroke-linecap="round"/>
                    <rect x="10" y="15" width="20" height="14" rx="1" stroke="#00ff88" stroke-width="1.2" fill="none"/>
                    <line x1="20" y1="15" x2="20" y2="29" stroke="#00ff88" stroke-width="1.2"/>
                    <circle cx="20" cy="22" r="3" stroke="#00ff88" stroke-width="1.2" fill="none"/>
                    <line x1="20" y1="22" x2="26" y2="15" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
                    <circle cx="20" cy="22" r="2" fill="#ffffff"/>
                </g>
                <text x="56" y="25" fill="#ffffff" font-family="'Segoe UI',sans-serif" font-size="16" font-weight="800" letter-spacing="1">OVERLAY</text>
                <text x="138" y="25" fill="#00ff88" font-family="'Segoe UI',sans-serif" font-size="16" font-weight="800" letter-spacing="1">MATCHTIMER</text>
                <text x="56" y="39" fill="#888" font-family="'Segoe UI',sans-serif" font-size="9" font-weight="600" letter-spacing="0.5">DEVELOPED BY VASCO OLIVEIRA</text>
            </svg>
        </div>

        <div class="control-group" id="omt-examino-settings" style="display:none;border:1px solid rgba(0,255,136,0.18);border-radius:6px;padding:10px;background:rgba(0,255,136,0.04);">
            <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span>0. Examino Player</span>
                <button type="button" class="handle-btn" id="omt-btn-native-settings" title="Open native OpenPlayer settings" style="font-size:12px;">⚙️ Native</button>
            </label>
            <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px;">
                <label style="font-size:11px;color:#aaa;">Source
                    <select id="omt-examino-source" style="width:100%;margin-top:3px;box-sizing:border-box;padding:6px;background:rgba(0,0,0,0.35);border:1px solid #444;color:white;border-radius:4px;font-size:12px;"></select>
                </label>
                <label style="font-size:11px;color:#aaa;">Audio
                    <select id="omt-examino-audio" style="width:100%;margin-top:3px;box-sizing:border-box;padding:6px;background:rgba(0,0,0,0.35);border:1px solid #444;color:white;border-radius:4px;font-size:12px;"></select>
                </label>
                <label style="font-size:11px;color:#aaa;">Speed
                    <select id="omt-examino-speed" style="width:100%;margin-top:3px;box-sizing:border-box;padding:6px;background:rgba(0,0,0,0.35);border:1px solid #444;color:white;border-radius:4px;font-size:12px;"></select>
                </label>
                <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:#ddd;margin-top:4px;">
                    <span>Auto-switch to VOD</span>
                    <input type="checkbox" id="omt-examino-auto-vod" checked>
                </label>
                <button type="button" id="omt-examino-refresh-settings" style="background:rgba(102,179,255,0.12);color:#9cf;border:1px solid rgba(102,179,255,0.35);padding:6px;border-radius:4px;cursor:pointer;font-size:11px;">Refresh player menus</button>
            </div>
        </div>

        <div class="control-group">
            <label>1. Match Half</label>
            <select id="omt-half-select">
                <option value="1">1st Half (Starts at 00:00)</option>
                <option value="2">2nd Half (Starts at 45:00)</option>
                <option value="custom1">Custom 1 &mdash; 1st Extra Time / Youth 2nd Half</option>
                <option value="custom2">Custom 2 &mdash; 2nd Extra Time</option>
            </select>
            <div id="omt-custom-c1" style="display:none;margin-top:5px;">
                <input type="number" id="omt-custom-minute-c1" placeholder="Starting minute for Custom 1 (e.g. 90)" min="0"
                    style="width:100%;box-sizing:border-box;padding:8px;background:rgba(0,0,0,0.3);border:1px solid #444;color:white;border-radius:4px;font-size:12px;outline:none;">
            </div>
            <div id="omt-custom-c2" style="display:none;margin-top:5px;">
                <input type="number" id="omt-custom-minute-c2" placeholder="Starting minute for Custom 2 (e.g. 105)" min="0"
                    style="width:100%;box-sizing:border-box;padding:8px;background:rgba(0,0,0,0.3);border:1px solid #444;color:white;border-radius:4px;font-size:12px;outline:none;">
            </div>
        </div>

        <div class="control-group">
            <label>2. Whistle Time (Hr : Min : Sec)</label>
            <div class="time-inputs">
                <input type="number" id="omt-sync-hr"  placeholder="0" min="0"> :
                <input type="number" id="omt-sync-min" placeholder="0" min="0"> :
                <input type="number" id="omt-sync-sec" placeholder="0" min="0" max="59">
            </div>
        </div>

        <div style="display:flex;gap:5px;">
            <button class="btn-sync" id="omt-btn-set-kickoff" style="flex:1;">SET KICK-OFF TIME</button>
            <button id="omt-btn-clear-timer"
                style="background:rgba(255,68,68,0.15);color:#ff4444;border:1px solid rgba(255,68,68,0.3);
                       padding:10px;font-weight:bold;border-radius:4px;cursor:pointer;transition:0.2s;
                       margin-top:5px;display:flex;align-items:center;justify-content:center;font-family:inherit;"
                title="Clear/Disable Timer">✕</button>
        </div>

        <div class="control-group" id="omt-shuttle-toggle-group" style="margin-top:10px;border-top:1px solid rgba(255,255,255,0.08);padding-top:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
                <span style="font-size:11px;color:#ddd;user-select:none;">Enable ShuttleXpress</span>
                <label class="omt-shuttle-switch" style="position:relative;display:inline-block;width:38px;height:20px;margin:0;">
                    <input type="checkbox" id="omt-shuttle-enable-toggle" style="opacity:0;width:0;height:0;margin:0;position:absolute;">
                    <span class="omt-shuttle-slider"></span>
                </label>
            </div>
        </div>

        <div class="cheatsheet" id="omt-shuttle-cheatsheet" style="display:none;margin-top:10px;">
            <div class="cheatsheet-title" style="color:#00ff88;border-bottom-color:rgba(0,255,136,0.15);">ShuttleXpress Controls</div>
            <div class="shortcut-item"><span>Button 1 (Far Left)</span><span class="shortcut-key">-2 min</span></div>
            <div class="shortcut-item"><span>Button 2</span><span class="shortcut-key">-10 sec</span></div>
            <div class="shortcut-item"><span>Button 3 (Center)</span><span class="shortcut-key">Play / Pause</span></div>
            <div class="shortcut-item"><span>Button 4</span><span class="shortcut-key">+10 sec</span></div>
            <div class="shortcut-item"><span>Button 5 (Far Right)</span><span class="shortcut-key">+2 min</span></div>
            <div class="shortcut-item"><span>Inner Wheel</span><span class="shortcut-key">Frame by Frame</span></div>
            <div class="shortcut-item"><span>Outer Ring</span><span class="shortcut-key">Fast Fwd / Rewind</span></div>
        </div>

        <div class="cheatsheet">
            <div class="cheatsheet-title">Shortcuts</div>
            <div class="shortcut-item"><span>Play / Pause</span><span class="shortcut-key">Space</span></div>
            <div class="shortcut-item"><span>Skip ±2s</span><span class="shortcut-key">← / →</span></div>
            <div class="shortcut-item"><span>Skip ±10s</span><span class="shortcut-key">Shift + →</span></div>
            <div class="shortcut-item"><span>Skip ±2m</span><span class="shortcut-key">Ctrl + →</span></div>
            <div class="shortcut-item"><span>Frame by Frame</span><span class="shortcut-key">↑ / ↓</span></div>
            <div class="shortcut-item"><span>Speed ±</span><span class="shortcut-key">Z / C</span></div>
            <div class="shortcut-item"><span>Speed 1.0x</span><span class="shortcut-key">X</span></div>
            <div class="shortcut-item"><span>Hide/Show Controls</span><span class="shortcut-key">H</span></div>
        </div>
    </div>
</div>

<!-- CONTROLS PANEL -->
<div id="controls-panel" class="glass-panel">
    <div class="drag-handle" id="controls-handle">
        <div class="drag-side-left">
            <button class="handle-btn" id="omt-btn-show-setup" title="Settings">⚙️</button>
            <select id="omt-speed-select" class="top-select">
                <option value="0.25">0.25x</option>
                <option value="0.5">0.50x</option>
                <option value="1.0" selected>1.00x</option>
                <option value="1.5">1.50x</option>
                <option value="2.0">2.00x</option>
            </select>
        </div>
        <div class="drag-center-grip">≡</div>
        <div class="drag-side-right">
            <div style="display:flex;align-items:center;gap:6px;margin-right:10px;">
                <button id="omt-live-btn" title="Go to Live Edge">
                    <span class="live-dot"></span> LIVE
                </button>
                <button class="handle-btn" id="omt-volume-icon-btn" title="Mute/Unmute" style="font-size:12px;padding:0 2px;">🔊</button>
                <input type="range" id="omt-volume-range" min="0" max="1" step="0.05" value="1" style="-webkit-appearance: none; appearance: none; width: 60px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.2); outline: none; cursor: pointer;">
            </div>
            <button class="handle-btn" id="omt-btn-fullscreen" title="Fullscreen">⛶</button>
        </div>
    </div>

    <div class="timeline-container">
        <div class="timeline-badges-row" id="omt-kickoff-jumps">
            <button id="omt-jump-k1"  class="kickoff-badge k1"  style="display:none;" title="Jump to 1st Half Kickoff">⚽ 1st</button>
            <button id="omt-jump-k2"  class="kickoff-badge k2"  style="display:none;" title="Jump to 2nd Half Kickoff">⚽ 2nd</button>
            <button id="omt-jump-kc1" class="kickoff-badge kc1" style="display:none;" title="Jump to Custom 1 Kickoff">⚽ C1</button>
            <button id="omt-jump-kc2" class="kickoff-badge kc2" style="display:none;" title="Jump to Custom 2 Kickoff">⚽ C2</button>
        </div>
        <div class="timeline-slider-row">
            <span id="omt-v-time-current">00:00:00</span>
            <div style="position:relative;flex:1;display:flex;align-items:center;">
                <input type="range" id="omt-timeline-slider" class="timeline-slider" min="0" max="100" value="0" step="0.01">
                <div id="omt-timeline-markers" style="position:absolute;left:6px;right:6px;height:6px;top:50%;transform:translateY(-50%);pointer-events:none;"></div>
            </div>
            <span id="omt-v-time-duration">00:00:00</span>
        </div>
    </div>

    <div class="controls-content">
        <div class="ctrl-group-left">
            <button class="ctrl-btn" id="omt-m120">2m ⏪</button>
            <button class="ctrl-btn" id="omt-m10">10s ⏪</button>
            <button class="ctrl-btn" id="omt-m2">2s ◀</button>
        </div>
        <div class="ctrl-group-center">
            <div class="separator"></div>
            <button class="ctrl-btn btn-frame" id="omt-prev-frame" title="Previous Frame">|⏴</button>
            <button class="ctrl-btn btn-play"  id="omt-btn-play">⏯ Play</button>
            <button class="ctrl-btn btn-frame" id="omt-next-frame" title="Next Frame">⏵|</button>
            <div class="separator"></div>
        </div>
        <div class="ctrl-group-right">
            <button class="ctrl-btn" id="omt-p2">2s ▶</button>
            <button class="ctrl-btn" id="omt-p10">10s ⏩</button>
            <button class="ctrl-btn" id="omt-p120">2m ⏩</button>
        </div>
    </div>
</div>`;
    }

    /* =========================================================
       5. CACHE UI ELEMENT REFERENCES
       ========================================================= */
    function q(id) { return omtRoot.querySelector('#' + id); }

    function cacheUIRefs() {
        timerUI = q('match-timer');
        osd = q('osd-message');
        setupPanel = q('setup-panel');
        controlsPanel = q('controls-panel');
        timelineSlider = q('omt-timeline-slider');
        vTimeCurrent = q('omt-v-time-current');
        vTimeDuration = q('omt-v-time-duration');
        liveBtn = q('omt-live-btn');
        btnMainPlay = q('omt-btn-play');
        speedSelect = q('omt-speed-select');
        volumeRange = q('omt-volume-range');
        volumeIconBtn = q('omt-volume-icon-btn');
        shuttleToggle = q('omt-shuttle-enable-toggle');
        shuttleCheatsheet = q('omt-shuttle-cheatsheet');
    }

    /* =========================================================
       6. WIRE ALL EVENTS
       ========================================================= */
    function wireEvents() {
        // --- Setup panel buttons ---
        q('omt-btn-close-setup').addEventListener('click', esconderSetup);
        q('omt-btn-set-kickoff').addEventListener('click', () => { iniciarTimer(); });
        q('omt-btn-clear-timer').addEventListener('click', () => { limparTimer(); });
        q('omt-btn-show-setup').addEventListener('click', mostrarSetup);
        q('omt-btn-fullscreen').addEventListener('click', toggleFullScreen);

        // --- Half selector memory ---
        q('omt-half-select').addEventListener('change', function () {
            const newHalf = this.value;
            const hrVal = q('omt-sync-hr').value;
            const minVal = q('omt-sync-min').value;
            const secVal = q('omt-sync-sec').value;
            if (hrVal !== '' || minVal !== '' || secVal !== '') {
                localStorage.setItem('matchTimerWhistle_' + previousHalf, JSON.stringify({ h: hrVal, m: minVal, s: secVal }));
            }
            const saved = localStorage.getItem('matchTimerWhistle_' + newHalf);
            if (saved) {
                const t = JSON.parse(saved);
                q('omt-sync-hr').value = t.h;
                q('omt-sync-min').value = t.m;
                q('omt-sync-sec').value = t.s;
            } else {
                q('omt-sync-hr').value = q('omt-sync-min').value = q('omt-sync-sec').value = '';
            }
            q('omt-custom-c1').style.display = (newHalf === 'custom1') ? 'block' : 'none';
            q('omt-custom-c2').style.display = (newHalf === 'custom2') ? 'block' : 'none';
            previousHalf = newHalf;
            this.blur();
        });

        // Enter key in whistle inputs
        ['omt-sync-hr', 'omt-sync-min', 'omt-sync-sec', 'omt-custom-minute-c1', 'omt-custom-minute-c2'].forEach(id => {
            const el = q(id);
            if (el) {
                el.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') { e.preventDefault(); iniciarTimer(); this.blur(); }
                });
            }
        });

        // --- Playback controls ---
        q('omt-m120').addEventListener('click', () => saltarVideo(-120));
        q('omt-m10').addEventListener('click', () => saltarVideo(-10));
        q('omt-m2').addEventListener('click', () => saltarVideo(-2));
        q('omt-p2').addEventListener('click', () => saltarVideo(2));
        q('omt-p10').addEventListener('click', () => saltarVideo(10));
        q('omt-p120').addEventListener('click', () => saltarVideo(120));
        q('omt-btn-play').addEventListener('click', togglePlay);
        q('omt-prev-frame').addEventListener('click', retrocederFrame);
        q('omt-next-frame').addEventListener('click', avancarFrame);

        // --- Kickoff jump buttons ---
        q('omt-jump-k1').addEventListener('click', () => jumpToKickoff('1'));
        q('omt-jump-k2').addEventListener('click', () => jumpToKickoff('2'));
        q('omt-jump-kc1').addEventListener('click', () => jumpToKickoff('custom1'));
        q('omt-jump-kc2').addEventListener('click', () => jumpToKickoff('custom2'));

        // --- Speed selector ---
        speedSelect.addEventListener('change', selecionarVelocidade);

        // --- Live button ---
        liveBtn.addEventListener('click', irParaLive);

        // --- Volume ---
        const volGuardado = localStorage.getItem('matchTimerVolume');
        if (volGuardado !== null) {
            vid.volume = parseFloat(volGuardado);
            volumeRange.value = volGuardado;
            atualizarIconeVolume(vid.volume);
            if (vid.volume > 0) {
                vid.muted = false;
            }
        }
        volumeRange.addEventListener('input', function () {
            vid.volume = this.value;
            if (vid.volume > 0) {
                vid.muted = false;
            }
            atualizarIconeVolume(vid.volume);
            localStorage.setItem('matchTimerVolume', vid.volume);
        });
        volumeRange.addEventListener('change', () => volumeRange.blur());
        volumeIconBtn.addEventListener('click', toggleMute);

        vid.addEventListener('volumechange', () => {
            if (vid.muted || vid.volume === 0) {
                volumeRange.value = 0;
                atualizarIconeVolume(0);
            } else {
                volumeRange.value = vid.volume;
                atualizarIconeVolume(vid.volume);
            }
        });

        // --- Timeline slider ---
        timelineSlider.addEventListener('input', function () {
            isDraggingTimeline = true;
            vTimeCurrent.innerText = formatarTempoVideo(parseFloat(this.value));
        });
        timelineSlider.addEventListener('change', function () {
            const t = parseFloat(this.value);
            seekTo(t);
            isDraggingTimeline = false;
            this.blur();
            resetControlsTimeout(false);
        });

        // --- Video element events ---
        vid.addEventListener('loadedmetadata', inicializarMetadadosTimeline);
        vid.addEventListener('durationchange', inicializarMetadadosTimeline);

        vid.addEventListener('timeupdate', () => {
            // Anti-live-snap: if HLS pushed us forward unexpectedly, pull back
            antiLiveSnap();

            if (!isDraggingTimeline) {
                timelineSlider.value = vid.currentTime;
                vTimeCurrent.innerText = formatarTempoVideo(vid.currentTime);
            }
            atualizarRelogio();
            atualizarEstadoLive();

            // Re-calibrate slider min when PDT becomes available after a kickoff was set
            if (kickoff1 !== null) {
                const k1Time = getVideoTimeForPdt(kickoff1);
                if (k1Time !== null) {
                    const expectedMin = Math.max(0, k1Time - 900);
                    if (parseFloat(timelineSlider.min) !== expectedMin) {
                        inicializarMetadadosTimeline();
                    }
                }
            }
        });

        vid.addEventListener('play', () => {
            if (!btnMainPlay || !controlsPanel) return; // null-guard: UI may have been torn down
            btnMainPlay.innerHTML = '⏸ Pause';
            btnMainPlay.classList.add('playing');
            controlsPanel.classList.add('playing-state');
            // Don't reveal the panel — ShuttleXpress triggers play() silently.
            resetControlsTimeout(false);
        });
        vid.addEventListener('pause', () => {
            if (!btnMainPlay || !controlsPanel) return; // null-guard: UI may have been torn down
            btnMainPlay.innerHTML = '⏯ Play';
            btnMainPlay.classList.remove('playing');
            controlsPanel.classList.remove('playing-state');
        });

        // --- Drag system for both panels ---
        fazerArrastavel(setupPanel, q('setup-handle'));
        fazerArrastavel(controlsPanel, q('controls-handle'));

        // --- Auto-hide controls on mouse inactivity ---
        // Only real mouse movement over the canvas/panel reveals the controls.
        vid.addEventListener('mousemove', () => resetControlsTimeout(true));
        controlsPanel.addEventListener('mousemove', () => resetControlsTimeout(true));
        resetControlsTimeout(false); // bootstrap: start timer, don't force-show

        // --- Keyboard shortcuts (capture phase, highest priority) ---
        // Examino: persistent window listener installed at document_start.
        // InplayIP: document capture listener (baseline behaviour).
        if (site.id === 'examino') {
            installExaminoHotkeys();
            wireExaminoSettingsUI();
        } else {
            document.addEventListener('keydown', handleKeydown, true);
        }

        // Auto-blur our own buttons after click (prevent shortcut hijack)
        omtRoot.addEventListener('click', function (e) {
            const el = e.target.closest('button');
            if (el) setTimeout(() => el.blur(), 50);
        });

        // Show live button immediately (always a stream)
        liveBtn.style.display = 'flex';

        // Click listener for interactive timer
        timerUI.addEventListener('click', iniciarEdicaoTimer);

        // ShuttleXpress toggle change listener
        if (shuttleToggle) {
            shuttleToggle.addEventListener('change', handleToggleChange);
            shuttleToggle.addEventListener('click', () => shuttleToggle.blur());
        }
    }

    /* =========================================================
       7. ANTI-LIVE-SNAP ENGINE
       Prevents the HLS player from auto-advancing the playhead
       back to the live edge after a user-initiated seek.
       ========================================================= */
    function seekTo(time) {
        userIntendedTime = time;
        seekLockUntil = Date.now() + 4000; // 4-second protection window
        vid.currentTime = time;
    }

    function antiLiveSnap() {
        if (!userIntendedTime || Date.now() > seekLockUntil) return;

        const drift = vid.currentTime - userIntendedTime;
        // If the stream has pulled us more than 8s forward from where we wanted to be, snap back
        if (drift > 8) {
            vid.currentTime = userIntendedTime;
        } else {
            // Update intended time naturally as playback progresses normally
            userIntendedTime = vid.currentTime;
        }
    }

    /* =========================================================
       8. PDT HELPERS (Absolute Timestamp Synchronisation)
       ========================================================= */
    function isPdtTimestamp(val) {
        return val !== null && val > 1_000_000; // epoch ms values are huge
    }

    function getProgramDateTime() {
        if (!hlsInstance) return null;

        // --- hls.js standard API ---
        try {
            if (hlsInstance.levels && hlsInstance.currentLevel !== undefined && hlsInstance.currentLevel !== -1) {
                const details = hlsInstance.levels[hlsInstance.currentLevel]?.details;
                if (details && details.fragments && details.fragments.length) {
                    const ct = vid.currentTime;
                    const frag = details.fragments.find(f => ct >= f.start && ct <= (f.start + f.duration))
                        || details.fragments[0];
                    if (frag && frag.programDateTime) {
                        const pdtMs = (frag.programDateTime instanceof Date)
                            ? frag.programDateTime.getTime()
                            : Number(frag.programDateTime);
                        const offsetWithinFrag = ct - frag.start;
                        return pdtMs + offsetWithinFrag * 1000;
                    }
                }
            }
        } catch (_) { }

        // --- Video.js VHS segments API ---
        try {
            if (hlsInstance.playlists) {
                const media = (typeof hlsInstance.playlists.media === 'function')
                    ? hlsInstance.playlists.media()
                    : null;
                if (media && media.segments && media.segments.length) {
                    const ct = vid.currentTime;
                    const seg = media.segments.find(s => ct >= s.start && ct <= (s.start + s.duration))
                        || media.segments[0];
                    if (seg && seg.dateTimeObject) {
                        return seg.dateTimeObject.getTime() + (ct - seg.start) * 1000;
                    }
                }
            }
        } catch (_) { }

        return null;
    }

    function getPdtForVideoTime(targetVideoTime) {
        const currentPdt = getProgramDateTime();
        if (currentPdt === null) return null;
        return currentPdt + (targetVideoTime - vid.currentTime) * 1000;
    }

    function getVideoTimeForPdt(pdtVal) {
        if (pdtVal === null || pdtVal === undefined) return null;
        if (!isPdtTimestamp(pdtVal)) return pdtVal; // Backwards compat: legacy relative seconds
        const currentPdt = getProgramDateTime();
        if (currentPdt === null) return null;
        return vid.currentTime + (pdtVal - currentPdt) / 1000;
    }

    /* =========================================================
       9. TIMELINE METADATA & SLIDER
       ========================================================= */
    function formatarTempoVideo(segundos) {
        if (isNaN(segundos) || !isFinite(segundos)) return '00:00:00';
        const h = Math.floor(segundos / 3600).toString().padStart(2, '0');
        const m = Math.floor((segundos % 3600) / 60).toString().padStart(2, '0');
        const s = Math.floor(segundos % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    function inicializarMetadadosTimeline() {
        const mediaDuration = site.effectiveDuration(vid);
        // InplayIP path: only enters when duration is finite (effectiveDuration === vid.duration).
        // Examino path: also accepts seekable-end when MSE reports Infinity.
        if (mediaDuration && isFinite(mediaDuration)) {
            let minVal = 0;
            // Precision zoom: shrink slider to 15 min before kickoff1
            if (kickoff1 !== null) {
                const k1Time = getVideoTimeForPdt(kickoff1);
                if (k1Time !== null) {
                    minVal = Math.max(0, k1Time - 900);
                }
            }
            timelineSlider.min = minVal;
            timelineSlider.max = mediaDuration;
            vTimeDuration.innerText = formatarTempoVideo(mediaDuration);
            timelineSlider.disabled = false;
            if (parseFloat(timelineSlider.value) < minVal) timelineSlider.value = minVal;

            // --- SE FOR DVR (REVIEW): Mostra os controlos (caso não tenham sido escondidos pelo H) ---
            if (controlsPanel && !isManuallyHidden) {
                controlsPanel.style.display = ''; // Limpa o 'none' e usa o layout padrão do CSS
                resetControlsTimeout(false);
            }
        } else {
            timelineSlider.min = 0;
            timelineSlider.max = 100;
            vTimeDuration.innerText = 'LIVE';
            timelineSlider.disabled = true;

            // --- SE FOR LIVE PURO (HD): Esconde os controlos automaticamente ---
            if (controlsPanel) {
                controlsPanel.style.display = 'none';
            }
        }
        atualizarMarcadores();
    }

    /* =========================================================
       10. TIMER / CLOCK LOGIC
       ========================================================= */
    function iniciarTimer() {
        let hInput = q('omt-sync-hr').value;
        let mInput = q('omt-sync-min').value;
        let sInput = q('omt-sync-sec').value;

        // Auto-capture current frame if inputs are empty
        if (hInput === '' && mInput === '' && sInput === '') {
            const ct = vid.currentTime || 0;
            hInput = Math.floor(ct / 3600).toString();
            mInput = Math.floor((ct % 3600) / 60).toString();
            sInput = Math.floor(ct % 60).toString();
            q('omt-sync-hr').value = hInput;
            q('omt-sync-min').value = mInput;
            q('omt-sync-sec').value = sInput;
            mostrarOSD('🎯 Captured: ' + formatarTempoVideo(ct));
        }

        const h = parseInt(hInput) || 0;
        const m = parseInt(mInput) || 0;
        const s = parseInt(sInput) || 0;
        const parte = q('omt-half-select').value;

        if (parte === '2') { tempoBase = 45 * 60; }
        else if (parte === 'custom1') { tempoBase = (parseInt(q('omt-custom-minute-c1').value) || 0) * 60; }
        else if (parte === 'custom2') { tempoBase = (parseInt(q('omt-custom-minute-c2').value) || 0) * 60; }
        else { tempoBase = 0; }

        const rawOffset = (h * 3600) + (m * 60) + s;

        // For streams: try to store an absolute PDT timestamp for drift-proof sync
        let kickoffVal = rawOffset;
        const pdtAtOffset = getPdtForVideoTime(rawOffset);
        if (pdtAtOffset !== null) kickoffVal = pdtAtOffset;

        offsetEmSegundos = kickoffVal;
        timerAtivo = true;
        timerUI.style.display = 'block';
        previousHalf = parte;

        // Persist
        localStorage.setItem('matchTimerAtivo', 'true');
        localStorage.setItem('matchTimerOffset', offsetEmSegundos);
        localStorage.setItem('matchTimerTempoBase', tempoBase);
        localStorage.setItem('matchTimerSyncHr', h);
        localStorage.setItem('matchTimerSyncMin', m);
        localStorage.setItem('matchTimerSyncSec', s);
        localStorage.setItem('matchTimerHalf', parte);
        localStorage.setItem('matchTimerWhistle_' + parte, JSON.stringify({ h, m, s }));
        if (parte === 'custom1') localStorage.setItem('matchTimerCustomMinC1', q('omt-custom-minute-c1').value);
        if (parte === 'custom2') localStorage.setItem('matchTimerCustomMinC2', q('omt-custom-minute-c2').value);

        // Save kickoff marker
        if (parte === '1') { kickoff1 = offsetEmSegundos; localStorage.setItem('matchTimerKickoff1', kickoff1); }
        else if (parte === '2') { kickoff2 = offsetEmSegundos; localStorage.setItem('matchTimerKickoff2', kickoff2); }
        else if (parte === 'custom1') { kickoffC1 = offsetEmSegundos; localStorage.setItem('matchTimerKickoffC1', kickoffC1); }
        else if (parte === 'custom2') { kickoffC2 = offsetEmSegundos; localStorage.setItem('matchTimerKickoffC2', kickoffC2); }

        inicializarMetadadosTimeline();
        atualizarMarcadores();
        atualizarRelogio();
        esconderSetup();
        // Mark the button as permanently active (stays green until cleared).
        // Class + inline style together beat any host-page CSS override.
        const _kickoffBtn = q('omt-btn-set-kickoff');
        _kickoffBtn.classList.add('kickoff-set');
        _kickoffBtn.style.setProperty('background', '#00cc6a', 'important');
        _kickoffBtn.style.setProperty('color', '#000', 'important');
        _kickoffBtn.style.setProperty('opacity', '1', 'important');
        _kickoffBtn.style.setProperty('box-shadow', '0 0 14px rgba(0,255,136,0.5)', 'important');
        _kickoffBtn.style.setProperty('border', '1px solid rgba(0,255,136,0.4)', 'important');
        mostrarOSD('\u23f1 Timer Synced');
    }

    function limparTimer() {
        timerAtivo = false;
        timerUI.style.display = 'none';
        offsetEmSegundos = 0;
        tempoBase = 0;
        previousHalf = '1';

        ['matchTimerAtivo', 'matchTimerOffset', 'matchTimerTempoBase', 'matchTimerSyncHr',
            'matchTimerSyncMin', 'matchTimerSyncSec', 'matchTimerHalf', 'matchTimerCustomMinC1',
            'matchTimerCustomMinC2', 'matchTimerWhistle_1', 'matchTimerWhistle_2',
            'matchTimerWhistle_custom1', 'matchTimerWhistle_custom2',
            'matchTimerKickoff1', 'matchTimerKickoff2', 'matchTimerKickoffC1', 'matchTimerKickoffC2'
        ].forEach(k => localStorage.removeItem(k));

        kickoff1 = kickoff2 = kickoffC1 = kickoffC2 = null;

        q('omt-sync-hr').value = '';
        q('omt-sync-min').value = '';
        q('omt-sync-sec').value = '';
        q('omt-half-select').value = '1';
        q('omt-custom-c1').style.display = 'none';
        q('omt-custom-c2').style.display = 'none';
        q('omt-custom-minute-c1').value = '';
        q('omt-custom-minute-c2').value = '';

        inicializarMetadadosTimeline();
        atualizarMarcadores();
        // Remove the active state from the kick-off button and clear inline overrides
        const _kickoffBtnClear = q('omt-btn-set-kickoff');
        _kickoffBtnClear.classList.remove('kickoff-set');
        _kickoffBtnClear.style.removeProperty('background');
        _kickoffBtnClear.style.removeProperty('color');
        _kickoffBtnClear.style.removeProperty('opacity');
        _kickoffBtnClear.style.removeProperty('box-shadow');
        _kickoffBtnClear.style.removeProperty('border');
        mostrarOSD('\u2715 Timer Cleared');
    }

    function atualizarRelogio() {
        if (!timerAtivo || isEditingTimer) return;

        const tAtual = vid.currentTime;

        const k1 = getVideoTimeForPdt(kickoff1);
        const k2 = getVideoTimeForPdt(kickoff2);
        const kC1 = getVideoTimeForPdt(kickoffC1);
        const kC2 = getVideoTimeForPdt(kickoffC2);

        let resolvedOffset = getVideoTimeForPdt(offsetEmSegundos);
        if (resolvedOffset === null) {
            // PDT not yet available — wait silently
            if (isPdtTimestamp(offsetEmSegundos)) return;
            resolvedOffset = 0;
        }

        let kickoffUsar = resolvedOffset;
        let baseUsar = tempoBase;

        if (kC2 !== null && tAtual >= kC2) { kickoffUsar = kC2; baseUsar = (parseInt(localStorage.getItem('matchTimerCustomMinC2')) || 105) * 60; }
        else if (kC1 !== null && tAtual >= kC1) { kickoffUsar = kC1; baseUsar = (parseInt(localStorage.getItem('matchTimerCustomMinC1')) || 90) * 60; }
        else if (k2 !== null && tAtual >= k2) { kickoffUsar = k2; baseUsar = 45 * 60; }
        else if (k1 !== null) { kickoffUsar = k1; baseUsar = 0; }

        // Before first kickoff
        if (k1 !== null && tAtual < k1) {
            timerUI.innerText = 'Pre-Match';
            timerUI.style.color = '#ffcc00';
            return;
        }

        const totalSeconds = (tAtual - kickoffUsar) + baseUsar;
        timerUI.style.color = 'white';
        timerUI.innerText = `${Math.floor(totalSeconds / 60).toString().padStart(2, '0')}:${Math.floor(totalSeconds % 60).toString().padStart(2, '0')}`;
    }

    function obterMinutoAtualJogo() {
        if (!timerAtivo) return 0;
        const tAtual = vid.currentTime;
        const k1 = getVideoTimeForPdt(kickoff1);
        const k2 = getVideoTimeForPdt(kickoff2);
        const kC1 = getVideoTimeForPdt(kickoffC1);
        const kC2 = getVideoTimeForPdt(kickoffC2);

        let resolvedOffset = getVideoTimeForPdt(offsetEmSegundos);
        if (resolvedOffset === null) resolvedOffset = 0;

        let kickoffUsar = resolvedOffset;
        let baseUsar = tempoBase;

        if (kC2 !== null && tAtual >= kC2) {
            kickoffUsar = kC2;
            const customMinC2 = parseInt(localStorage.getItem('matchTimerCustomMinC2')) || 105;
            baseUsar = customMinC2 * 60;
        } else if (kC1 !== null && tAtual >= kC1) {
            kickoffUsar = kC1;
            const customMinC1 = parseInt(localStorage.getItem('matchTimerCustomMinC1')) || 90;
            baseUsar = customMinC1 * 60;
        } else if (k2 !== null && tAtual >= k2) {
            kickoffUsar = k2;
            baseUsar = 45 * 60;
        } else if (k1 !== null) {
            kickoffUsar = k1;
            baseUsar = 0;
        }

        const tempoDeJogoRelativo = tAtual - kickoffUsar;
        const tempoDeJogoTotal = tempoDeJogoRelativo + baseUsar;
        if (k1 !== null && tAtual < k1) return 0;
        return Math.floor(tempoDeJogoTotal / 60);
    }

    function navegarParaMinutoDeJogo(minutoAlvo) {
        if (!vid) return;

        const tAtual = vid.currentTime;
        const k1 = getVideoTimeForPdt(kickoff1);
        const k2 = getVideoTimeForPdt(kickoff2);
        const kC1 = getVideoTimeForPdt(kickoffC1);
        const kC2 = getVideoTimeForPdt(kickoffC2);

        const c1Min = parseInt(localStorage.getItem('matchTimerCustomMinC1')) || 90;
        const c2Min = parseInt(localStorage.getItem('matchTimerCustomMinC2')) || 105;

        let activePeriod = '1';
        if (kC2 !== null && tAtual >= kC2) activePeriod = 'custom2';
        else if (kC1 !== null && tAtual >= kC1) activePeriod = 'custom1';
        else if (k2 !== null && tAtual >= k2) activePeriod = '2';

        let targetVideoTime = null;

        // Determine the target period based on minutoAlvo, activePeriod, and the kickoffs
        let targetPeriod = null;

        // Exact match checks for nominal kickoff minutes
        if (minutoAlvo === c2Min && kC2 !== null && activePeriod !== 'custom1') {
            targetPeriod = 'custom2';
        } else if (minutoAlvo === c1Min && kC1 !== null && activePeriod !== '2') {
            targetPeriod = 'custom1';
        } else if (minutoAlvo === 45 && k2 !== null) {
            targetPeriod = '2';
        } else {
            // General logic based on the active period
            if (activePeriod === '1') {
                const baseOffset = k1 !== null ? k1 : (getVideoTimeForPdt(offsetEmSegundos) || 0);
                const tentativeTime = baseOffset + minutoAlvo * 60;
                
                if (kC2 !== null && tentativeTime >= kC2) {
                    targetPeriod = 'custom2';
                } else if (kC1 !== null && tentativeTime >= kC1) {
                    targetPeriod = 'custom1';
                } else if (k2 !== null && tentativeTime >= k2) {
                    targetPeriod = '2';
                } else {
                    targetPeriod = '1';
                }
            } else if (activePeriod === '2') {
                if (minutoAlvo < 45) {
                    targetPeriod = '1';
                } else {
                    const tentativeTime = k2 + (minutoAlvo - 45) * 60;
                    
                    if (kC2 !== null && tentativeTime >= kC2) {
                        targetPeriod = 'custom2';
                    } else if (kC1 !== null && tentativeTime >= kC1) {
                        targetPeriod = 'custom1';
                    } else {
                        targetPeriod = '2';
                    }
                }
            } else if (activePeriod === 'custom1') {
                if (minutoAlvo < 45) {
                    targetPeriod = '1';
                } else if (minutoAlvo < c1Min) {
                    targetPeriod = '2';
                } else {
                    const tentativeTime = kC1 + (minutoAlvo - c1Min) * 60;
                    
                    if (kC2 !== null && tentativeTime >= kC2) {
                        targetPeriod = 'custom2';
                    } else {
                        targetPeriod = 'custom1';
                    }
                }
            } else if (activePeriod === 'custom2') {
                if (minutoAlvo < 45) {
                    targetPeriod = '1';
                } else if (minutoAlvo < c1Min) {
                    targetPeriod = '2';
                } else if (minutoAlvo < c2Min) {
                    targetPeriod = 'custom1';
                } else {
                    targetPeriod = 'custom2';
                }
            }
        }

        // Calculate the target time based on the resolved target period
        if (targetPeriod === 'custom2') {
            targetVideoTime = kC2 + (minutoAlvo - c2Min) * 60;
        } else if (targetPeriod === 'custom1') {
            const tentativeTime = kC1 + (minutoAlvo - c1Min) * 60;
            if (kC2 !== null && tentativeTime >= kC2) {
                targetVideoTime = kC2 + (minutoAlvo - c2Min) * 60;
            } else {
                targetVideoTime = tentativeTime;
            }
        } else if (targetPeriod === '2') {
            const tentativeTime = k2 + (minutoAlvo - 45) * 60;
            if (kC2 !== null && tentativeTime >= kC2) {
                targetVideoTime = kC2 + (minutoAlvo - c2Min) * 60;
            } else if (kC1 !== null && tentativeTime >= kC1) {
                targetVideoTime = kC1 + (minutoAlvo - c1Min) * 60;
            } else {
                targetVideoTime = tentativeTime;
            }
        } else {
            const baseOffset = k1 !== null ? k1 : (getVideoTimeForPdt(offsetEmSegundos) || 0);
            const tentativeTime = baseOffset + minutoAlvo * 60;
            if (kC2 !== null && tentativeTime >= kC2) {
                targetVideoTime = kC2 + (minutoAlvo - c2Min) * 60;
            } else if (kC1 !== null && tentativeTime >= kC1) {
                targetVideoTime = kC1 + (minutoAlvo - c1Min) * 60;
            } else if (k2 !== null && tentativeTime >= k2) {
                targetVideoTime = k2 + (minutoAlvo - 45) * 60;
            } else {
                targetVideoTime = tentativeTime;
            }
        }

        if (targetVideoTime !== null && targetVideoTime >= 0) {
            if (vid.duration && isFinite(vid.duration)) {
                targetVideoTime = Math.min(targetVideoTime, vid.duration);
            }
            seekTo(targetVideoTime);
            mostrarOSD(`↪️ Jumped to Min ${minutoAlvo}`);
        }
    }

    function iniciarEdicaoTimer() {
        if (isEditingTimer || !timerAtivo) return;

        const minAtual = obterMinutoAtualJogo();
        isEditingTimer = true;

        timerUI.innerHTML = `<input type="text" id="timer-edit-input" value="${minAtual}" style="width: 70px; background: transparent; border: none; color: white; font-size: inherit; font-family: inherit; font-weight: inherit; text-align: center; outline: none; padding: 0; margin: 0; display: inline-block; vertical-align: middle;">`;

        const input = omtRoot.querySelector('#timer-edit-input');
        if (input) {
            input.focus();
            input.select();

            let isCommitted = false;

            function salvarEdicao() {
                if (isCommitted) return;
                isCommitted = true;
                const val = input.value.trim();
                if (val !== '') {
                    const targetMin = parseFloat(val);
                    if (!isNaN(targetMin) && targetMin >= 0) {
                        navegarParaMinutoDeJogo(targetMin);
                    }
                }
                isEditingTimer = false;
                atualizarRelogio();
            }

            function cancelarEdicao() {
                if (isCommitted) return;
                isCommitted = true;
                isEditingTimer = false;
                atualizarRelogio();
            }

            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    salvarEdicao();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelarEdicao();
                }
            });

            input.addEventListener('blur', function () {
                setTimeout(salvarEdicao, 150);
            });
        }
    }

    /* =========================================================
       11. TIMELINE MARKERS
       ========================================================= */
    function atualizarMarcadores() {
        const markerContainer = q('omt-timeline-markers');
        const btnK1 = q('omt-jump-k1');
        const btnK2 = q('omt-jump-k2');
        const btnKC1 = q('omt-jump-kc1');
        const btnKC2 = q('omt-jump-kc2');

        if (!markerContainer) return;
        markerContainer.innerHTML = '';

        const duration = site.effectiveDuration(vid);
        if (!duration || !isFinite(duration)) {
            [btnK1, btnK2, btnKC1, btnKC2].forEach(b => { if (b) b.style.display = 'none'; });
            return;
        }

        const k1Val = getVideoTimeForPdt(kickoff1);
        const k2Val = getVideoTimeForPdt(kickoff2);
        const kC1Val = getVideoTimeForPdt(kickoffC1);
        const kC2Val = getVideoTimeForPdt(kickoffC2);

        const markers = [
            { val: k1Val, btn: btnK1, cls: 'k1', label: '1st Half Kickoff' },
            { val: k2Val, btn: btnK2, cls: 'k2', label: '2nd Half Kickoff' },
            { val: kC1Val, btn: btnKC1, cls: 'kc1', label: 'Custom 1 Kickoff' },
            { val: kC2Val, btn: btnKC2, cls: 'kc2', label: 'Custom 2 Kickoff' },
        ];

        const minVal = parseFloat(timelineSlider.min) || 0;
        const maxVal = parseFloat(timelineSlider.max) || duration;
        const range = maxVal - minVal;

        markers.forEach(({ val, btn, cls, label }) => {
            if (!btn) return;
            if (val !== null && val >= minVal && val <= maxVal && range > 0) {
                btn.style.display = 'inline-flex';
                const pct = ((val - minVal) / range) * 100;
                markerContainer.innerHTML += `<div class="timeline-marker-tick ${cls}" style="left:${pct}%;" title="${label}"></div>`;
            } else {
                btn.style.display = 'none';
            }
        });
    }

    function jumpToKickoff(half) {
        const map = { '1': kickoff1, '2': kickoff2, 'custom1': kickoffC1, 'custom2': kickoffC2 };
        const labels = { '1': '1st Half', '2': '2nd Half', 'custom1': 'Custom 1', 'custom2': 'Custom 2' };
        const raw = map[half];
        if (raw == null) return;
        const t = getVideoTimeForPdt(raw);
        if (t !== null && t >= 0) {
            seekTo(t);
            mostrarOSD(`⚽ Jumped to ${labels[half]} Kickoff`);
        }
    }

    /* =========================================================
       12. PLAYBACK CONTROLS
       ========================================================= */
    function saltarVideo(segundos) {
        seekTo(vid.currentTime + segundos);
        mostrarOSD(`${segundos > 0 ? '⏩' : '⏪'} ${segundos > 0 ? '+' : ''}${segundos}s`);
    }

    function togglePlay() {
        if (vid.paused) { vid.play(); mostrarOSD('▶ Play'); }
        else { vid.pause(); mostrarOSD('⏸ Pause'); }
    }

    function avancarFrame() {
        vid.pause();
        vid.currentTime += 0.04;
        mostrarOSD('🎞 +1 Frame');
    }

    function retrocederFrame() {
        vid.pause();
        vid.currentTime -= 0.04;
        mostrarOSD('🎞 -1 Frame');
    }

    function selecionarVelocidade() {
        const valor = parseFloat(speedSelect.value);
        vid.playbackRate = valor;
        mostrarOSD('⚡ Speed: ' + valor.toFixed(2) + 'x');
        speedSelect.blur();
    }

    function irParaLive() {
        // Try to read the live sync position from hls.js directly
        if (hlsInstance && typeof hlsInstance.liveSyncPosition === 'number') {
            seekTo(hlsInstance.liveSyncPosition);
        } else if (vid.seekable && vid.seekable.length > 0) {
            seekTo(vid.seekable.end(vid.seekable.length - 1) - 3);
        } else if (vid.duration && isFinite(vid.duration)) {
            seekTo(vid.duration - 3);
        }
        // After going live, clear seek lock so stream can advance normally
        setTimeout(() => { userIntendedTime = null; seekLockUntil = 0; }, 3000);
        mostrarOSD('📡 Going Live');
        liveBtn.blur();
    }

    function atualizarEstadoLive() {
        if (!vid || !liveBtn) return; // null-guard: called from timeupdate, may fire after teardown
        let liveEdge = 0;
        if (vid.seekable && vid.seekable.length > 0) {
            liveEdge = vid.seekable.end(vid.seekable.length - 1);
        } else if (vid.duration && isFinite(vid.duration)) {
            liveEdge = vid.duration;
        }
        const dist = liveEdge - vid.currentTime;
        liveBtn.classList.toggle('is-live', liveEdge > 0 && dist <= 8);
    }

    function toggleFullScreen() {
        const container = site.findFullscreenTarget(vid);
        if (!document.fullscreenElement) {
            (container || vid).requestFullscreen().catch(() => vid.requestFullscreen().catch(() => { }));
        } else {
            document.exitFullscreen();
        }
    }

    function toggleMute() {
        if (vid.volume > 0 && !vid.muted) {
            ultimoVolume = vid.volume;
            vid.volume = 0;
            vid.muted = true;
            volumeRange.value = 0;
        } else {
            vid.volume = ultimoVolume > 0 ? ultimoVolume : 1;
            vid.muted = false;
            volumeRange.value = vid.volume;
        }
        atualizarIconeVolume(vid.volume);
        localStorage.setItem('matchTimerVolume', vid.volume);
        volumeIconBtn.blur();
    }

    function atualizarIconeVolume(vol) {
        volumeIconBtn.innerText = vol === 0 ? '🔇' : vol < 0.5 ? '🔉' : '🔊';
    }

    /* =========================================================
       13. OSD NOTIFICATION
       ========================================================= */
    function mostrarOSD(texto) {
        if (!osd) return; // null-guard: may be called after teardown (e.g. deferred OSD timeouts)
        osd.innerText = texto;
        osd.classList.remove('visible');
        void osd.offsetWidth; // reflow
        osd.classList.add('visible');
        clearTimeout(osdTimeout);
        osdTimeout = setTimeout(() => { if (osd) osd.classList.remove('visible'); }, 1800);
    }

    /* =========================================================
       13B. AUTO-HIDE CONTROLS
       ========================================================= */
    // showPanel=true  → show the panel immediately (mouse hover path).
    // showPanel=false → only reset/maintain the auto-hide countdown without
    //                   making the panel visible (non-mouse paths: play event,
    //                   loadedmetadata, timeline change, ShuttleXpress, etc.).
    function resetControlsTimeout(showPanel = true) {
        if (mouseMoveTimeout) {
            clearTimeout(mouseMoveTimeout);
            mouseMoveTimeout = null;
        }

        if (isManuallyHidden) return;

        // InplayIP: identical finite-duration gate. Examino: allow seekable MSE.
        if (vid && !site.mediaReady(vid)) return;

        if (showPanel && controlsPanel) {
            controlsPanel.style.opacity = '1';
            controlsPanel.style.pointerEvents = 'auto';
        }

        // Only schedule the hide timer when the panel is already visible.
        if (!controlsPanel || controlsPanel.style.opacity !== '1') return;

        mouseMoveTimeout = setTimeout(() => {
            if (isDraggingTimeline) {
                resetControlsTimeout(false);
                return;
            }
            if (controlsPanel) {
                controlsPanel.style.opacity = '0';
                controlsPanel.style.pointerEvents = 'none';
            }
        }, 2500);
    }

    /* =========================================================
       14. KEYBOARD SHORTCUTS (capture phase — intercepts Video.js)
       ========================================================= */
    function isEditableKeyTarget(target) {
        if (!target) return false;
        if (target.isContentEditable) return true;
        const el = target.nodeType === 1 ? target : target.parentElement;
        if (!el) return false;
        if (el.closest && el.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"]')) {
            return true;
        }
        const tag = (el.tagName || '').toUpperCase();
        return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    }

    function handleKeydown(e) {
        // Don't intercept when user is typing in inputs / contenteditable
        if (isEditableKeyTarget(e.target)) return;

        const key = e.key.toLowerCase();
        const controlled = ['arrowright', 'arrowleft', 'arrowup', 'arrowdown', ' ', 'z', 'c', 'x', 'h'];
        if (!controlled.includes(key)) return;

        // Stop the event before Video.js / OpenPlayer / Examino handles it
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (!vid) return;

        switch (key) {
            case 'arrowright':
                if (e.ctrlKey) saltarVideo(120);
                else if (e.shiftKey) saltarVideo(10);
                else saltarVideo(2);
                break;
            case 'arrowleft':
                if (e.ctrlKey) saltarVideo(-120);
                else if (e.shiftKey) saltarVideo(-10);
                else saltarVideo(-2);
                break;
            case 'arrowup': avancarFrame(); break;
            case 'arrowdown': retrocederFrame(); break;
            case ' ': togglePlay(); break;
            case 'z': {
                const allowedRates = [0.25, 0.5, 1.0, 1.5, 2.0];
                const currentRate = vid.playbackRate;
                const closestRate = allowedRates.reduce((prev, curr) => 
                    Math.abs(curr - currentRate) < Math.abs(prev - currentRate) ? curr : prev
                );
                const currentIndex = allowedRates.indexOf(closestRate);
                const newIndex = Math.max(0, currentIndex - 1);
                vid.playbackRate = allowedRates[newIndex];
                syncSpeedSelect();
                mostrarOSD('⚡ Speed: ' + vid.playbackRate.toFixed(2) + 'x');
                break;
            }
            case 'c': {
                const allowedRates = [0.25, 0.5, 1.0, 1.5, 2.0];
                const currentRate = vid.playbackRate;
                const closestRate = allowedRates.reduce((prev, curr) => 
                    Math.abs(curr - currentRate) < Math.abs(prev - currentRate) ? curr : prev
                );
                const currentIndex = allowedRates.indexOf(closestRate);
                const newIndex = Math.min(allowedRates.length - 1, currentIndex + 1);
                vid.playbackRate = allowedRates[newIndex];
                syncSpeedSelect();
                mostrarOSD('⚡ Speed: ' + vid.playbackRate.toFixed(2) + 'x');
                break;
            }
            case 'x':
                vid.playbackRate = 1.0;
                syncSpeedSelect();
                mostrarOSD('⚡ Speed: 1.00x');
                break;
            case 'h':
                if (controlsPanel) {
                    if (isManuallyHidden) {
                        isManuallyHidden = false;
                        resetControlsTimeout();
                        mostrarOSD('🖥️ Controls Visible');
                    } else {
                        isManuallyHidden = true;
                        if (mouseMoveTimeout) {
                            clearTimeout(mouseMoveTimeout);
                            mouseMoveTimeout = null;
                        }
                        controlsPanel.style.opacity = '0';
                        controlsPanel.style.pointerEvents = 'none';
                        mostrarOSD('🙈 Controls Hidden');
                    }
                }
                break;

        }
    }

    function syncSpeedSelect() {
        const currentRate = vid.playbackRate;
        const allowedRates = [0.25, 0.5, 1.0, 1.5, 2.0];
        const closestRate = allowedRates.reduce((prev, curr) => 
            Math.abs(curr - currentRate) < Math.abs(prev - currentRate) ? curr : prev
        );
        const rateStrings = { 0.25: "0.25", 0.5: "0.5", 1.0: "1.0", 1.5: "1.5", 2.0: "2.0" };
        if (speedSelect) {
            speedSelect.value = rateStrings[closestRate] || closestRate.toString();
        }
    }

    /* =========================================================
       15. PANEL DRAG SYSTEM
       ========================================================= */
    function fazerArrastavel(panel, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        handle.onmousedown = function (e) {
            // Ignore clicks on interactive child elements
            if (e.target.closest('button, select, input')) return;
            e.preventDefault();

            // Anchor the panel at its current rendered position before clearing transforms
            const rect = panel.getBoundingClientRect();
            const rootRect = omtRoot.getBoundingClientRect();
            panel.style.top = (rect.top - rootRect.top) + 'px';
            panel.style.left = (rect.left - rootRect.left) + 'px';
            panel.style.transform = 'none';
            panel.style.bottom = 'auto';

            pos3 = e.clientX;
            pos4 = e.clientY;

            document.onmousemove = drag;
            document.onmouseup = stopDrag;
        };

        function drag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;

            let newTop = panel.offsetTop - pos2;
            let newLeft = panel.offsetLeft - pos1;

            newTop = Math.max(0, Math.min(newTop, window.innerHeight - panel.offsetHeight));
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - panel.offsetWidth));

            panel.style.top = newTop + 'px';
            panel.style.left = newLeft + 'px';
        }

        function stopDrag() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    /* =========================================================
       16. SETUP PANEL VISIBILITY
       ========================================================= */
    function esconderSetup() { setupPanel.style.display = 'none'; }
    function mostrarSetup() { setupPanel.style.display = 'flex'; }

    /* =========================================================
       16B. CONTOUR SHUTTLEXPRESS WEBHID MODULE
       ========================================================= */
    let shuttleDevice = null;
    let lastJogValue = null;
    let prevBytes3 = 0;
    let prevBytes4 = 0;
    let shuttleInterval = null;
    let currentShuttleSpeed = 0;

    function getShuttleSpeedFactor(b0) {
        if (b0 >= 1 && b0 <= 7) {
            const factors = [0.2, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0];
            return factors[b0 - 1];
        } else if (b0 >= 249 && b0 <= 255) {
            const factors = [-0.2, -0.5, -1.0, -2.0, -4.0, -8.0, -16.0];
            const index = 255 - b0;
            return factors[index];
        }
        return 0;
    }

    function showShuttleCheatsheet(visible) {
        if (shuttleCheatsheet) {
            shuttleCheatsheet.style.display = visible ? 'block' : 'none';
        }
    }

    function updateToggleUI(checked) {
        if (shuttleToggle) {
            shuttleToggle.checked = checked;
        }
    }

    function cleanupShuttle() {
        if (shuttleInterval) {
            clearInterval(shuttleInterval);
            shuttleInterval = null;
        }
        currentShuttleSpeed = 0;

        if (shuttleDevice) {
            try {
                shuttleDevice.removeEventListener('inputreport', handleInputReport);
                if (shuttleDevice.opened) {
                    shuttleDevice.close();
                }
            } catch (e) {
                console.error('[OMT] Error closing ShuttleXpress device:', e);
            }
            shuttleDevice = null;
        }
        lastJogValue = null;
        prevBytes3 = 0;
        prevBytes4 = 0;

        updateToggleUI(false);
        localStorage.setItem('shuttleXpressEnabled', 'false');
        showShuttleCheatsheet(false);
    }

    function handleInputReport(event) {
        const { data } = event;
        const bytes = new Uint8Array(data.buffer);

        // A) 5 Buttons edge detection
        if (bytes[3] === 16 && prevBytes3 !== 16) {
            vid.currentTime -= 120;
            mostrarOSD('⏪ Skip -2m');
        } else if (bytes[3] === 32 && prevBytes3 !== 32) {
            vid.currentTime -= 10;
            mostrarOSD('⏪ Skip -10s');
        } else if (bytes[3] === 64 && prevBytes3 !== 64) {
            if (vid.paused) {
                vid.play().catch(e => {});
                mostrarOSD('▶ Play');
            } else {
                vid.pause();
                mostrarOSD('⏸ Pause');
            }
        } else if (bytes[3] === 128 && prevBytes3 !== 128) {
            vid.currentTime += 10;
            mostrarOSD('⏩ Skip +10s');
        }

        if (bytes[4] === 1 && prevBytes4 !== 1) {
            vid.currentTime += 120;
            mostrarOSD('⏩ Skip +2m');
        }

        prevBytes3 = bytes[3];
        prevBytes4 = bytes[4];

        // B) Inner Jog Wheel (Frame-by-frame)
        const currentJog = bytes[1];
        if (lastJogValue !== null && currentJog !== lastJogValue) {
            if (!vid.paused) vid.pause();

            let delta = currentJog - lastJogValue;
            if (delta > 128) delta -= 256;
            else if (delta < -128) delta += 256;

            if (delta !== 0) {
                vid.currentTime += delta * 0.04;
                mostrarOSD(delta > 0 ? `🎞 +${delta} Frame${delta > 1 ? 's' : ''}` : `🎞 ${delta} Frame${delta < -1 ? 's' : ''}`);
            }
        }
        lastJogValue = currentJog;

        // C) Outer Shuttle Ring
        const b0 = bytes[0];
        if (b0 === 0) {
            if (shuttleInterval) {
                clearInterval(shuttleInterval);
                shuttleInterval = null;
            }
            currentShuttleSpeed = 0;
        } else {
            currentShuttleSpeed = getShuttleSpeedFactor(b0);
            if (currentShuttleSpeed !== 0 && !shuttleInterval) {
                vid.pause();
                shuttleInterval = setInterval(() => {
                    let nextTime = vid.currentTime + currentShuttleSpeed * 0.05;
                    if (nextTime < 0) nextTime = 0;
                    if (nextTime > vid.duration) nextTime = vid.duration;
                    vid.currentTime = nextTime;
                    mostrarOSD(`Scrub: ${currentShuttleSpeed > 0 ? '+' : ''}${currentShuttleSpeed.toFixed(1)}x`);
                }, 50);
            }
        }
    }

    async function connectDevice(device) {
        if (!device) return;
        try {
            if (!device.opened) {
                await device.open();
            }
            shuttleDevice = device;
            shuttleDevice.addEventListener('inputreport', handleInputReport);
            lastJogValue = null;
            prevBytes3 = 0;
            prevBytes4 = 0;

            showShuttleCheatsheet(true);
            updateToggleUI(true);
            console.log('[OMT] ShuttleXpress connected:', device.productName);
        } catch (err) {
            console.error('[OMT] Failed to open ShuttleXpress:', err);
            updateToggleUI(false);
            showShuttleCheatsheet(false);
        }
    }

    function handleHidDisconnect(event) {
        if (shuttleDevice && event.device === shuttleDevice) {
            cleanupShuttle();
            console.log('[OMT] ShuttleXpress disconnected');
        }
    }

    /**
     * If the document is currently in native fullscreen, exit it and wait
     * until the browser has fully unwound the fullscreen layout before
     * resolving. This is required so that browser-modal prompts (e.g. the
     * WebHID device-picker) can open without glitching the UI.
     *
     * Resolution order:
     *  1. The `fullscreenchange` event fires  → resolves immediately.
     *  2. Fallback: 400 ms safety timeout     → resolves unconditionally.
     */
    function exitFullscreenSafely() {
        return new Promise(resolve => {
            if (!document.fullscreenElement) {
                resolve();
                return;
            }

            let settled = false;
            const settle = () => {
                if (settled) return;
                settled = true;
                document.removeEventListener('fullscreenchange', onChanged);
                resolve();
            };

            const onChanged = () => settle();
            document.addEventListener('fullscreenchange', onChanged, { once: true });

            // Safety net: if fullscreenchange never fires, unblock after 400 ms.
            setTimeout(settle, 400);

            document.exitFullscreen().catch(() => {
                // exitFullscreen can throw if the document is not the
                // fullscreen owner (e.g. inside an iframe). Settle anyway.
                settle();
            });
        });
    }

    async function handleToggleChange() {
        if (shuttleToggle.checked) {
            localStorage.setItem('shuttleXpressEnabled', 'true');
            try {
                const devices = await navigator.hid.getDevices();
                let device = devices.find(d => d.vendorId === 0x0b33);
                if (!device) {
                    // Exit fullscreen first so the device-picker popup can
                    // open cleanly without freezing or glitching the UI.
                    await exitFullscreenSafely();
                    const requested = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x0b33 }] });
                    if (requested && requested.length > 0) {
                        device = requested[0];
                    }
                }
                if (device) {
                    await connectDevice(device);
                } else {
                    updateToggleUI(false);
                    localStorage.setItem('shuttleXpressEnabled', 'false');
                }
            } catch (err) {
                console.error('[OMT] Failed to request ShuttleXpress:', err);
                updateToggleUI(false);
                localStorage.setItem('shuttleXpressEnabled', 'false');
            }
        } else {
            localStorage.setItem('shuttleXpressEnabled', 'false');
            cleanupShuttle();
        }
    }

    async function initShuttleXpress() {
        if (!navigator.hid) {
            console.warn('[OMT] WebHID is not supported in this browser.');
            if (shuttleToggle) {
                shuttleToggle.disabled = true;
                shuttleToggle.parentElement.title = 'WebHID is not supported in this browser.';
            }
            return;
        }

        navigator.hid.addEventListener('disconnect', handleHidDisconnect);

        if (localStorage.getItem('shuttleXpressEnabled') === 'true') {
            try {
                const devices = await navigator.hid.getDevices();
                const device = devices.find(d => d.vendorId === 0x0b33);
                if (device) {
                    await connectDevice(device);
                }
            } catch (err) {
                console.error('[OMT] Failed to auto-connect ShuttleXpress:', err);
            }
        }
    }

    /* =========================================================
       17. RESTORE PERSISTED STATE AFTER PAGE LOAD
       ========================================================= */
    function restoreState() {
        const timerAtivoGuardado = localStorage.getItem('matchTimerAtivo');
        if (timerAtivoGuardado !== 'true') return;

        timerAtivo = true;
        offsetEmSegundos = parseFloat(localStorage.getItem('matchTimerOffset')) || 0;
        tempoBase = parseFloat(localStorage.getItem('matchTimerTempoBase')) || 0;
        timerUI.style.display = 'block';

        q('omt-sync-hr').value = localStorage.getItem('matchTimerSyncHr') || '';
        q('omt-sync-min').value = localStorage.getItem('matchTimerSyncMin') || '';
        q('omt-sync-sec').value = localStorage.getItem('matchTimerSyncSec') || '';

        const savedHalf = localStorage.getItem('matchTimerHalf');
        if (savedHalf) {
            q('omt-half-select').value = savedHalf;
            q('omt-custom-c1').style.display = (savedHalf === 'custom1') ? 'block' : 'none';
            q('omt-custom-c2').style.display = (savedHalf === 'custom2') ? 'block' : 'none';
        }

        const savedCMin1 = localStorage.getItem('matchTimerCustomMinC1');
        const savedCMin2 = localStorage.getItem('matchTimerCustomMinC2');
        if (savedCMin1) q('omt-custom-minute-c1').value = savedCMin1;
        if (savedCMin2) q('omt-custom-minute-c2').value = savedCMin2;

        // Restore the permanent active state on the kick-off button
        const _kickoffBtnRestore = q('omt-btn-set-kickoff');
        _kickoffBtnRestore.classList.add('kickoff-set');
        _kickoffBtnRestore.style.setProperty('background', '#00cc6a', 'important');
        _kickoffBtnRestore.style.setProperty('color', '#000', 'important');
        _kickoffBtnRestore.style.setProperty('opacity', '1', 'important');
        _kickoffBtnRestore.style.setProperty('box-shadow', '0 0 14px rgba(0,255,136,0.5)', 'important');
        _kickoffBtnRestore.style.setProperty('border', '1px solid rgba(0,255,136,0.4)', 'important');
        esconderSetup();
        mostrarOSD('\u23f1 Timer Restored');
    }

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

    function storageGetAutoVod() {
        const v = localStorage.getItem('omtAutoSwitchVod');
        if (v === null || v === undefined || v === '') return true; // default ON
        return v === 'true';
    }

    function storageSetAutoVod(enabled) {
        localStorage.setItem('omtAutoSwitchVod', enabled ? 'true' : 'false');
        try {
            window.postMessage({
                source: 'omt-page',
                type: 'OMT_STORAGE_SET',
                key: 'omtAutoSwitchVod',
                value: !!enabled
            }, '*');
        } catch (_) {}
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
        let panel = await ensureOpSettingsOpen();
        if (!panel) return { current: null, options: [] };

        // Return to root menu if needed, without closing the panel.
        if (!document.querySelector(`.op-setting-panel .op-setting-item[op-panel-type="${panelType}"]`)) {
            await clickOpSettingBack();
            panel = await ensureOpSettingsOpen();
        }

        const mainItem = document.querySelector(`.op-setting-panel .op-setting-item[op-panel-type="${panelType}"]`);
        if (!mainItem) return { current: null, options: [] };

        const current = mainItem.getAttribute('op-data-value') ||
            (mainItem.querySelector('.op-setting-item-value') || {}).textContent || null;

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
        return { current, options };
    }

    async function applyOpSetting(panelType, value) {
        if (!value) return false;
        let panel = await ensureOpSettingsOpen();
        if (!panel) return false;
        if (!document.querySelector(`.op-setting-panel .op-setting-item[op-panel-type="${panelType}"]`)) {
            await clickOpSettingBack();
            panel = await ensureOpSettingsOpen();
        }
        const mainItem = document.querySelector(`.op-setting-panel .op-setting-item[op-panel-type="${panelType}"]`);
        if (!mainItem) return false;
        try { mainItem.click(); } catch (_) {}
        await sleep(200);
        const option = Array.from(document.querySelectorAll('.op-setting-panel .op-setting-item'))
            .find((el) => el.getAttribute('op-data-value') === value && !el.querySelector('.op-setting-item-nexticon'));
        if (option) {
            try { option.click(); } catch (_) {}
            await sleep(250);
            concealNativeSettingsButton();
            document.querySelectorAll('.op-setting-panel').forEach((p) => p.classList.remove('omt-settings-raised'));
            return true;
        }
        // Fallback: leave raised native panel for manual pick
        panel.classList.add('omt-settings-raised');
        return false;
    }

    function fillSelect(selectEl, scraped) {
        if (!selectEl) return;
        const { current, options } = scraped || { current: null, options: [] };
        selectEl.innerHTML = '';
        if (!options.length) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'Unavailable';
            selectEl.appendChild(opt);
            selectEl.disabled = true;
            return;
        }
        selectEl.disabled = false;
        options.forEach((o) => {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            if (current && String(current) === String(o.value)) opt.selected = true;
            selectEl.appendChild(opt);
        });
        if (current) selectEl.value = current;
    }

    async function refreshExaminoSettingsPanel() {
        if (site.id !== 'examino' || !omtRoot) return;
        const section = q('omt-examino-settings');
        if (section) section.style.display = 'block';

        const source = await scrapeOpSettingOptions('source');
        const audio = await scrapeOpSettingOptions('audioTrack');
        let speed = await scrapeOpSettingOptions('speed');
        // Speed submenu may be missing on some builds — fall back to common rates.
        if (!speed.options.length) {
            speed = {
                current: (vid && vid.playbackRate ? (vid.playbackRate + 'x') : '1x'),
                options: ['0.1x', '0.25x', '0.5x', '1x', '1.5x', '2x'].map((v) => ({ value: v, label: v }))
            };
        }

        fillSelect(q('omt-examino-source'), source);
        fillSelect(q('omt-examino-audio'), audio);
        fillSelect(q('omt-examino-speed'), speed);

        const autoBox = q('omt-examino-auto-vod');
        if (autoBox) autoBox.checked = storageGetAutoVod();

        concealNativeSettingsButton();
        document.querySelectorAll('.op-setting-panel').forEach((p) => {
            // Close panel if still open by clicking outside via Escape-like title click
            p.classList.remove('omt-settings-raised');
        });
    }

    function wireExaminoSettingsUI() {
        const section = q('omt-examino-settings');
        if (section) section.style.display = 'block';

        const autoBox = q('omt-examino-auto-vod');
        if (autoBox) {
            autoBox.checked = storageGetAutoVod();
            autoBox.addEventListener('change', () => {
                storageSetAutoVod(!!autoBox.checked);
                mostrarOSD(autoBox.checked ? 'VOD auto-switch ON' : 'VOD auto-switch OFF');
                if (autoBox.checked) maybeAutoSwitchToVod();
            });
        }

        const refreshBtn = q('omt-examino-refresh-settings');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                refreshExaminoSettingsPanel().then(() => mostrarOSD('Menus refreshed'));
            });
        }

        const nativeBtn = q('omt-btn-native-settings');
        if (nativeBtn) {
            nativeBtn.addEventListener('click', async () => {
                const panel = await ensureOpSettingsOpen();
                if (panel) {
                    panel.classList.add('omt-settings-raised');
                    mostrarOSD('Native settings');
                } else {
                    mostrarOSD('Settings unavailable');
                }
            });
        }

        const sourceSel = q('omt-examino-source');
        if (sourceSel) {
            sourceSel.addEventListener('change', async () => {
                const ok = await applyOpSetting('source', sourceSel.value);
                mostrarOSD(ok ? ('Source: ' + sourceSel.value) : 'Source change failed');
                // Video may reload — kick-off keys stay in localStorage for restoreState.
            });
        }
        const audioSel = q('omt-examino-audio');
        if (audioSel) {
            audioSel.addEventListener('change', async () => {
                const ok = await applyOpSetting('audioTrack', audioSel.value);
                mostrarOSD(ok ? ('Audio: ' + audioSel.value) : 'Audio change failed');
            });
        }
        const speedSel = q('omt-examino-speed');
        if (speedSel) {
            speedSel.addEventListener('change', async () => {
                const raw = speedSel.value;
                const ok = await applyOpSetting('speed', raw);
                const rate = parseFloat(String(raw).replace(/x/i, ''));
                if (!Number.isNaN(rate) && vid) {
                    vid.playbackRate = rate;
                    syncSpeedSelect();
                }
                mostrarOSD(ok || !Number.isNaN(rate) ? ('Speed: ' + raw) : 'Speed change failed');
            });
        }

        // Populate async shortly after mount (OpenPlayer menus may lag).
        examinoSettingsRefreshTimer = setTimeout(() => {
            refreshExaminoSettingsPanel().catch(() => {});
        }, 600);
    }

    async function maybeAutoSwitchToVod(attempt = 0) {
        if (site.id !== 'examino') return;
        if (!storageGetAutoVod()) return;

        try {
            const source = await scrapeOpSettingOptions('source');
            const current = (source.current || '').toString();
            const hasVod = source.options.some((o) => /vod/i.test(o.value) || /vod/i.test(o.label));
            if (!hasVod) {
                concealNativeSettingsButton();
                if (attempt < 6) {
                    setTimeout(() => {
                        maybeAutoSwitchToVod(attempt + 1).catch(() => {});
                    }, 700);
                }
                return;
            }
            if (/vod/i.test(current)) {
                concealNativeSettingsButton();
                return;
            }
            const vod = source.options.find((o) => /vod/i.test(o.value) || /vod/i.test(o.label));
            if (!vod) return;
            console.log('[OMT] Auto-switching Examino source to VOD:', vod.value, '(attempt ' + attempt + ')');
            const ok = await applyOpSetting('source', vod.value);
            if (ok) {
                mostrarOSD('Switched to VOD');
                setTimeout(() => {
                    refreshExaminoSettingsPanel().catch(() => {});
                }, 800);
            } else if (attempt < 6) {
                setTimeout(() => {
                    maybeAutoSwitchToVod(attempt + 1).catch(() => {});
                }, 700);
            }
        } catch (err) {
            console.warn('[OMT] Auto-VOD failed:', err && err.message);
            if (attempt < 6) {
                setTimeout(() => {
                    maybeAutoSwitchToVod(attempt + 1).catch(() => {});
                }, 700);
            }
        }
        concealNativeSettingsButton();
    }

    function initExaminoPlayerFeatures() {
        installExaminoHotkeys();
        injectExaminoHideCSS();
        hideExaminoNativeChrome();
        startExaminoNativeChromeObserver();
        // Delay auto-VOD so OpenPlayer settings exist; retries handle late menus
        // and mid-switch <video> replacements.
        setTimeout(() => {
            maybeAutoSwitchToVod(0).catch((err) => {
                console.warn('[OMT] Auto-VOD failed:', err && err.message);
            });
        }, 1200);
    }

    /* =========================================================
       ENTRY POINT
       ========================================================= */
    if (site.id === 'examino') {
        installExaminoHotkeys();
        injectExaminoHideCSS();
        // Hide chrome as soon as nodes appear, even before <video>.
        if (document.documentElement) {
            startExaminoNativeChromeObserver();
            hideExaminoNativeChrome();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
