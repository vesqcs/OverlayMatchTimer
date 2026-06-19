/* ============================================================
   Overlay MatchTimer — Chrome Extension Content Script
   Runs in MAIN world on inplayip.tv
   Injects the full timer UI over the existing Video.js player.
   ============================================================ */

(function () {
    'use strict';

    // SPA monitor interval handle
    let spaMonitorInterval = null;

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
    let isEditingTimer = false;
    let hasAutomatedDvr = false;
    const isLocalVideo = window.location.protocol === 'file:';
    const isExamino = window.location.hostname.includes('examino');
    const isXeatre = window.location.hostname.includes('xeatre');

    // Docked layout state
    let isDocked = false;
    let omtAnchor = null;
    let dockResizeObserver = null;
    let dockDebounceTimer = null;
    let dockFullscreenHandler = null;

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
       1. BOOT — WAIT FOR VIDEO ELEMENT
       ========================================================= */
    function teardown() {
        // Stop the SPA monitor before re-init to avoid double-starts
        if (spaMonitorInterval) {
            clearInterval(spaMonitorInterval);
            spaMonitorInterval = null;
        }
        // Stop any running timers
        if (mouseMoveTimeout) {
            clearTimeout(mouseMoveTimeout);
            mouseMoveTimeout = null;
        }
        // Disconnect dock engine
        if (dockResizeObserver) {
            dockResizeObserver.disconnect();
            dockResizeObserver = null;
        }
        if (dockDebounceTimer) {
            clearTimeout(dockDebounceTimer);
            dockDebounceTimer = null;
        }
        if (dockFullscreenHandler) {
            document.removeEventListener('fullscreenchange', dockFullscreenHandler);
            window.removeEventListener('resize', dockFullscreenHandler);
            dockFullscreenHandler = null;
        }
        // Clean up ShuttleXpress
        cleanupShuttle();
        if (navigator.hid) {
            try {
                navigator.hid.removeEventListener('disconnect', handleHidDisconnect);
            } catch (e) {}
        }
        // Remove keydown listener
        document.removeEventListener('keydown', handleKeydown, true);
        // Remove the injected HUD from the DOM
        const existingRoot = document.getElementById('omt-root');
        if (existingRoot && existingRoot.parentNode) {
            existingRoot.parentNode.removeChild(existingRoot);
        }
        // Clear references
        omtRoot = null;
        vid = null;
        hlsInstance = null;
        timerUI = null;
        osd = null;
        setupPanel = null;
        controlsPanel = null;
        shuttleToggle = null;
        shuttleCheatsheet = null;
        hasAutomatedDvr = false;
        isDocked = false;
        omtAnchor = null;
    }

    function boot() {
        if (window.location.protocol === 'file:') {
            document.documentElement.classList.add('omt-local-env');
        }
        const v = findVideo();
        if (v) { init(v); return; }

        const obs = new MutationObserver(() => {
            const found = findVideo();
            if (found) { obs.disconnect(); init(found); }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
    }

    function findVideo() {
        // Prefer the Video.js tech element
        const tech = document.querySelector('.vjs-tech');
        if (tech && tech.tagName === 'VIDEO') return tech;
        // Generic fallback
        const any = document.querySelector('video');
        if (any) return any;
        return null;
    }

    function startSPAMonitor() {
        if (spaMonitorInterval) return; // Already running
        spaMonitorInterval = setInterval(() => {
            const currentVid = findVideo();
            const currentRoot = document.getElementById('omt-root');

            if (!currentVid && currentRoot) {
                // Left the stream page — tear down cleanly
                teardown();
                return;
            }

            if (currentVid && !currentRoot) {
                // New stream loaded but HUD is gone — reboot
                teardown();
                init(currentVid);
                return;
            }

            if (currentVid && currentVid !== vid) {
                // Different video element — stream switched
                teardown();
                init(currentVid);
            }
        }, 1500);
    }

    function init(videoEl) {
        vid = videoEl;
        vid.preservesPitch = true;

        if (!isXeatre) {
            vid.classList.add('omt-top-align');
        }

        // Give Video.js time to fully initialise before we grab its internals
        setTimeout(() => {
            hlsInstance = getHlsInstance();
            patchHlsForDvr();
            suppressNativeControls();
            suppressPlatformControls();
            injectUI();
            cacheUIRefs();
            wireEvents();
            restoreState();
            inicializarMetadadosTimeline();
            startSPAMonitor();
            initShuttleXpress();
            automateExaminoDvr();
            initDockedLayoutEngine();
            console.log('[OMT] Overlay MatchTimer extension active.');
        }, 1800);
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

        // Keep overriding in case Video.js re-enables them
        const observer = new MutationObserver(() => {
            if (vid.controls) vid.controls = false;
        });
        observer.observe(vid, { attributes: true, attributeFilter: ['controls'] });

        // Swallow Video.js keyboard events so our handler wins
        document.querySelectorAll('.video-js, .vjs-tech').forEach(el => {
            el.setAttribute('tabindex', '-1');
        });
    }

    /* =========================================================
       3b. SUPPRESS PLATFORM-SPECIFIC NATIVE CONTROLS
           Handles Xeatre and Examino control bars that are
           injected / re-injected dynamically by the host page.
           Runs a single persistent MutationObserver — no polling.
       ========================================================= */
    /* Selectors always hidden on every platform (Xeatre control bars) */
    const XEATRE_SELECTORS = [
        '#ControlBar.overlay-fullscreen',
        '#ControlBar.overlay-normal'
    ];

    /* Selectors hidden ONLY on examino.statsperform.io */
    const EXAMINO_SELECTORS = [
        '.button-bar.svelte-1azck0y',
        '.op-ui.op-clear',
        '.op-progressbar-container.op-clear',
        '.op-button.op-setting-button'
    ];

    /**
     * Hides all currently present matching elements.
     * Skips <video> and #omt-root — guaranteed by the selectors above.
     * Examino-specific selectors are only evaluated when isExamino is true.
     */
    function hidePlatformControls() {
        const selectors = isExamino
            ? [...XEATRE_SELECTORS, ...EXAMINO_SELECTORS]
            : XEATRE_SELECTORS;

        selectors.forEach(selector => {
            try {
                document.querySelectorAll(selector).forEach(el => {
                    if (el.style.display !== 'none') {
                        el.style.display = 'none';
                    }
                });
            } catch (e) { /* malformed selector guard */ }
        });
    }

    /**
     * Injects a <style> block that permanently hides Examino native controls
     * using !important so that Svelte/player CSS cannot override us.
     * Only injected when running on examino.statsperform.io.
     */
    function injectExaminoHideCSS() {
        if (!isExamino) return;
        if (document.getElementById('omt-examino-hide-css')) return; // idempotent
        const style = document.createElement('style');
        style.id = 'omt-examino-hide-css';
        style.textContent = [
            '.button-bar.svelte-1azck0y    { display: none !important; }',
            '.op-ui.op-clear               { display: none !important; }',
            '.op-progressbar-container.op-clear { display: none !important; }',
            '.op-button.op-setting-button  { display: none !important; }'
        ].join('\n');
        (document.head || document.documentElement).appendChild(style);
        console.log('[OMT] Examino CSS hide rules injected.');
    }

    /**
     * Attaches a single MutationObserver on <body> (subtree) that calls
     * hidePlatformControls() whenever new nodes are added to the DOM.
     * Also runs immediately to cover any elements already present.
     * The MutationObserver for Examino-specific controls only runs on Examino.
     */
    function suppressPlatformControls() {
        // Inject CSS !important rules for Examino (belt-and-suspenders)
        injectExaminoHideCSS();

        // Immediate DOM sweep — cover elements already present at init time
        hidePlatformControls();

        // Global observer: covers Xeatre re-injection on all platforms
        const observer = new MutationObserver(mutations => {
            let hasAdditions = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    hasAdditions = true;
                    break;
                }
            }
            // Only act when new nodes actually appeared (skip attribute/text mutations)
            if (hasAdditions) hidePlatformControls();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        console.log('[OMT] Platform control suppressor active' + (isExamino ? ' (Xeatre + Examino).' : ' (Xeatre).'));
    }

    /* =========================================================
       4. INJECT UI INTO THE PAGE
       ========================================================= */
    function injectUI() {
        const isLocal = window.location.protocol === 'file:';
        let anchor;

        if (isLocal) {
            anchor = document.body;
        } else {
            // Find the best container to anchor inside
            anchor = vid.closest('.video-js') ||
                vid.closest('.vjs-player') ||
                vid.parentElement;
        }

        if (!anchor) { console.error('[OMT] Could not find anchor element.'); return; }

        omtAnchor = anchor;

        if (!isLocal) {
            // Ensure relative positioning so absolute children work
            const cs = getComputedStyle(anchor);
            if (cs.position === 'static') anchor.style.position = 'relative';
        }

        omtRoot = document.createElement('div');
        omtRoot.id = 'omt-root';
        // Allow clicks to pass through the transparent overlay root to the native video
        // player underneath. Child elements (our panels/buttons) restore pointer-events.
        omtRoot.style.pointerEvents = 'none';
        if (isLocal) {
            omtRoot.style.position = 'fixed';
            omtRoot.style.zIndex = '999999';
        }
        omtRoot.innerHTML = buildHTML();
        anchor.appendChild(omtRoot);

        // Restore pointer interactivity for every direct child of #omt-root so our
        // panels and controls remain fully clickable while the video stays clickable.
        const omtPointerStyle = document.createElement('style');
        omtPointerStyle.id = 'omt-pointer-events-css';
        omtPointerStyle.textContent = '#omt-root > * { pointer-events: auto !important; }';
        (document.head || document.documentElement).appendChild(omtPointerStyle);
    }

    function buildHTML() {
        return `
<div id="omt-video-spacer"></div>
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
            resetControlsTimeout();
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
            btnMainPlay.innerHTML = '⏸ Pause';
            btnMainPlay.classList.add('playing');
            controlsPanel.classList.add('playing-state');
            resetControlsTimeout();
        });
        vid.addEventListener('pause', () => {
            btnMainPlay.innerHTML = '⏯ Play';
            btnMainPlay.classList.remove('playing');
            controlsPanel.classList.remove('playing-state');
        });

        // --- Drag system for both panels ---
        fazerArrastavel(setupPanel, q('setup-handle'));
        fazerArrastavel(controlsPanel, q('controls-handle'));

        // --- Auto-hide controls on mouse inactivity ---
        vid.addEventListener('mousemove', resetControlsTimeout);
        controlsPanel.addEventListener('mousemove', resetControlsTimeout);
        resetControlsTimeout();

        // --- Keyboard shortcuts (capture phase, highest priority) ---
        document.addEventListener('keydown', handleKeydown, true);

        // Auto-blur our own buttons after click (prevent shortcut hijack)
        omtRoot.addEventListener('click', function (e) {
            const el = e.target.closest('button');
            if (el) setTimeout(() => el.blur(), 50);
        });

        // Show live button if it is a stream, hide if local file
        liveBtn.style.display = isLocalVideo ? 'none' : 'flex';

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
        if (vid.duration && isFinite(vid.duration)) {
            let minVal = 0;
            // Precision zoom: shrink slider to 15 min before kickoff1
            if (kickoff1 !== null) {
                const k1Time = getVideoTimeForPdt(kickoff1);
                if (k1Time !== null) {
                    minVal = Math.max(0, k1Time - 900);
                }
            }
            timelineSlider.min = minVal;
            timelineSlider.max = vid.duration;
            vTimeDuration.innerText = formatarTempoVideo(vid.duration);
            timelineSlider.disabled = false;
            if (parseFloat(timelineSlider.value) < minVal) timelineSlider.value = minVal;

            // --- SE FOR DVR (REVIEW): Mostra os controlos (caso não tenham sido escondidos pelo H) ---
            if (controlsPanel && !isManuallyHidden) {
                controlsPanel.style.display = ''; // Limpa o 'none' e usa o layout padrão do CSS
                resetControlsTimeout();
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
        mostrarOSD('⏱ Timer Synced');
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
        mostrarOSD('✕ Timer Cleared');
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

        const duration = vid.duration;
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
        const isLocal = window.location.protocol === 'file:';
        const container = isLocal ? document.documentElement : (vid.closest('.video-js') || vid.closest('.vjs-player') || vid.parentElement);
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
        osd.innerText = texto;
        osd.classList.remove('visible');
        void osd.offsetWidth; // reflow
        osd.classList.add('visible');
        clearTimeout(osdTimeout);
        osdTimeout = setTimeout(() => osd.classList.remove('visible'), 1800);
    }

    /* =========================================================
       13B. AUTO-HIDE CONTROLS
       ========================================================= */
    function resetControlsTimeout() {
        if (mouseMoveTimeout) {
            clearTimeout(mouseMoveTimeout);
            mouseMoveTimeout = null;
        }

        if (isManuallyHidden) return;

        if (vid && (!vid.duration || !isFinite(vid.duration))) return;

        if (isDocked) {
            if (controlsPanel) {
                controlsPanel.style.opacity = '1';
                controlsPanel.style.pointerEvents = 'auto';
            }
            return;
        }

        if (controlsPanel) {
            controlsPanel.style.opacity = '1';
            controlsPanel.style.pointerEvents = 'auto';
        }

        mouseMoveTimeout = setTimeout(() => {
            if (isDraggingTimeline) {
                resetControlsTimeout();
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
    function handleKeydown(e) {
        // Don't intercept when user is typing in our own inputs
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

        const key = e.key.toLowerCase();
        const controlled = ['arrowright', 'arrowleft', 'arrowup', 'arrowdown', ' ', 'z', 'c', 'x', 'h'];
        if (!controlled.includes(key)) return;

        // Stop the event before Video.js or the browser handles it
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

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
            // Guard: don't allow dragging controls panel if docked
            if (isDocked && panel === controlsPanel) return;

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

    async function handleToggleChange() {
        if (shuttleToggle.checked) {
            localStorage.setItem('shuttleXpressEnabled', 'true');
            try {
                const devices = await navigator.hid.getDevices();
                let device = devices.find(d => d.vendorId === 0x0b33);
                if (!device) {
                    // Chrome blocks WebHID prompts in fullscreen. If in fullscreen, exit it first.
                    if (document.fullscreenElement) {
                        try {
                            mostrarOSD('Exiting fullscreen to pair device...');
                            await document.exitFullscreen();
                            // Wait for the browser to transition out of fullscreen
                            await new Promise(resolve => setTimeout(resolve, 300));
                        } catch (fsErr) {
                            console.error('[OMT] Failed to exit fullscreen for WebHID request:', fsErr);
                        }
                    }
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
       16C. EXAMINO DVR AUTOMATION MODULE
       Runs only on examino.statsperform.io.
       Waits 2.5 s after page load, opens the player settings,
       then clicks the DVR source button after 600 ms.
       ========================================================= */
    function forceDVR() {
        // Guard: only run on Examino, and only once per page load.
        if (!isExamino) return;
        if (hasAutomatedDvr) return;
        hasAutomatedDvr = true;

        console.log('[OMT] Examino: Scheduling DVR automation (2.5 s delay)...');

        setTimeout(() => {
            // Step A — locate and click the settings button
            const settingsBtn = document.querySelector('.op-button.op-setting-button');
            if (!settingsBtn) {
                console.warn('[OMT] Examino: .op-setting-button not found — DVR automation skipped.');
                return;
            }

            settingsBtn.click();
            console.log('[OMT] Examino: Settings button clicked.');

            // Step B — wait 600 ms for the settings menu to render
            setTimeout(() => {
                // Step C — target the DVR source button (op-data-value="1")
                const dvrBtn = document.querySelector('div[op-data-value="1"]');

                if (dvrBtn) {
                    // Step D — click the DVR source button
                    dvrBtn.click();
                    console.log('[OMT] Examino: DVR source button clicked (op-data-value="1").');
                } else {
                    console.warn('[OMT] Examino: DVR button (div[op-data-value="1"]) not found — closing settings.');
                    // Close the panel gracefully if DVR item is absent
                    settingsBtn.click();
                }
            }, 600);
        }, 2500);
    }

    // Alias kept for the existing call-site inside init()
    function automateExaminoDvr() { forceDVR(); }

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

        esconderSetup();
        mostrarOSD('⏱ Timer Restored');
    }

    /* =========================================================
       18. DOCKED LAYOUT ENGINE
       ========================================================= */
    const DOCK_THRESHOLD = 110; // Fixed value with safe margin

    function computeBottomBlackBarHeight() {
        if (!vid) return 0;

        const vidRect = vid.getBoundingClientRect();
        const containerHeight = vidRect.height;
        const containerWidth  = vidRect.width;

        if (containerHeight === 0 || containerWidth === 0) return 0;

        // Native aspect ratio of the video content
        let videoAspectRatio = 16 / 9; // safe default before metadata loads
        if (vid.videoWidth && vid.videoHeight) {
            videoAspectRatio = vid.videoWidth / vid.videoHeight;
        }

        // With object-fit: contain (enforced by omt-top-align), the rendered
        // video image fits within the <video> element box, letter-boxed.
        // The rendered image height = min(element height, element width / aspectRatio)
        const renderedVideoHeight = Math.min(containerHeight, containerWidth / videoAspectRatio);

        // Because omt-top-align forces object-position: top center, the image
        // sits at the top, so ALL leftover space is at the bottom.
        const blackBarHeight = containerHeight - renderedVideoHeight;
        return Math.max(0, blackBarHeight);
    }

    function applyDockedLayout(dock) {
        if (!controlsPanel) return;

        if (dock) {
            if (!isDocked) {
                isDocked = true;

                // Pure CSS flexbox handles positioning — no JS top calculation needed.
                // #omt-root is a flex column: the spacer takes flex:1 (video area),
                // and .controls-docked sits naturally at the bottom in the same frame.
                controlsPanel.style.top    = '';
                controlsPanel.style.bottom = '';
                controlsPanel.style.left   = '';
                controlsPanel.style.transform = '';
                controlsPanel.style.width  = '';

                controlsPanel.classList.add('controls-docked');
                resetControlsTimeout();
            }
        } else {
            if (isDocked) {
                isDocked = false;
                controlsPanel.classList.remove('controls-docked');

                // Restore default CSS-driven positioning
                controlsPanel.style.top    = '';
                controlsPanel.style.bottom = '';
                controlsPanel.style.left   = '';
                controlsPanel.style.transform = '';
                controlsPanel.style.width  = '';

                resetControlsTimeout();
            }
        }
    }

    function scheduleDockRecalc() {
        if (dockDebounceTimer) {
            clearTimeout(dockDebounceTimer);
        }
        dockDebounceTimer = setTimeout(() => {
            dockDebounceTimer = null;

            // Fullscreen — always overlay mode
            if (document.fullscreenElement) {
                applyDockedLayout(false);
                return;
            }

            const blackBarHeight = computeBottomBlackBarHeight();
            const shouldDock = blackBarHeight >= DOCK_THRESHOLD;
            console.log(`[OMT] Dock recalc — blackBar: ${blackBarHeight.toFixed(1)}px, threshold: ${DOCK_THRESHOLD}px, dock: ${shouldDock}`);

            if (shouldDock) {
                // CSS flexbox handles the position natively — no top recalc needed.
                applyDockedLayout(true);
            } else {
                applyDockedLayout(false);
            }
        }, 100);
    }

    function initDockedLayoutEngine() {
        if (!vid) return;

        // 1. Create ResizeObserver — observe the <video> element directly since
        //    computeBottomBlackBarHeight() uses vid.getBoundingClientRect().
        //    Also observe the anchor as a backup for platforms where the video
        //    element itself is fixed-size but the container changes.
        if (window.ResizeObserver) {
            dockResizeObserver = new ResizeObserver(() => {
                scheduleDockRecalc();
            });
            dockResizeObserver.observe(vid);
            if (omtAnchor && omtAnchor !== document.body) {
                dockResizeObserver.observe(omtAnchor);
            }
        }

        // 2. Listen for fullscreen and window resize events
        dockFullscreenHandler = () => {
            scheduleDockRecalc();
        };
        document.addEventListener('fullscreenchange', dockFullscreenHandler);
        window.addEventListener('resize', dockFullscreenHandler);

        // 3. Run initial calculation (video metadata may not be ready yet;
        //    also re-run when metadata loads so aspect ratio is accurate)
        vid.addEventListener('loadedmetadata', scheduleDockRecalc);
        scheduleDockRecalc();
    }

    /* =========================================================
       ENTRY POINT
       ========================================================= */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
