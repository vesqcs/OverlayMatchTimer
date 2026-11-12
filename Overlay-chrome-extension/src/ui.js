/* Inject Overlay MatchTimer HUD, cache element refs, compact layout, fullscreen reparent. */
    /* =========================================================
       4. INJECT UI INTO THE PAGE
       In-video chrome stays minimal: match clock + offset nudge,
       kick-off sync, Examino Source, and the bottom transport bar.
       Branding / Personalizar / Shuttle live in the toolbar popup.
       ========================================================= */
    function injectUI() {
        const anchor = site.findAnchor(vid);

        if (!anchor) { console.error('[OMT] Could not find anchor element.'); return; }

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
<div id="match-timer-wrap">
    <div id="match-timer">00:00</div>
    <div class="omt-offset-nudge" title="Nudge kick-off offset">
        <button type="button" class="omt-offset-btn" id="omt-offset-m5" title="Offset -5s">${omtIcon('chevrons-left', 12)}5</button>
        <button type="button" class="omt-offset-btn" id="omt-offset-m1" title="Offset -1s">-1</button>
        <button type="button" class="omt-offset-btn" id="omt-offset-p1" title="Offset +1s">+1</button>
        <button type="button" class="omt-offset-btn" id="omt-offset-p5" title="Offset +5s">5${omtIcon('chevrons-right', 12)}</button>
    </div>
</div>
<div id="osd-message">MatchTimer</div>

<!-- Compact kick-off strip (always reachable while watching) -->
<div id="omt-kickoff-bar" class="omt-hud-chip">
    <select id="omt-half-select" title="Match half">
        <option value="1">1st</option>
        <option value="2">2nd</option>
        <option value="custom1">C1</option>
        <option value="custom2">C2</option>
    </select>
    <div id="omt-custom-c1" class="omt-custom-minute" style="display:none;">
        <input type="number" id="omt-custom-minute-c1" placeholder="min" min="0" title="Custom 1 start minute">
    </div>
    <div id="omt-custom-c2" class="omt-custom-minute" style="display:none;">
        <input type="number" id="omt-custom-minute-c2" placeholder="min" min="0" title="Custom 2 start minute">
    </div>
    <button type="button" class="btn-sync" id="omt-btn-set-kickoff" title="Set kick-off at current frame">Kick-off</button>
    <button type="button" id="omt-btn-clear-timer" class="btn-clear-timer" title="Clear timer">${omtIcon('x', 13)}</button>
</div>

<!-- Examino Source (shown only on Examino) -->
<div id="omt-examino-settings" class="omt-hud-chip omt-source-chip" style="display:none;">
    <label for="omt-examino-source">Source</label>
    <select id="omt-examino-source">
        <option value="DVR">DVR</option>
        <option value="VOD">VOD</option>
    </select>
    <label class="omt-toggle-row" for="omt-examino-auto-vod" title="Auto-switch to VOD">
        <span>Auto VOD</span>
        <input type="checkbox" id="omt-examino-auto-vod" checked>
    </label>
</div>

<!-- Hidden whistle-time fields: kept for iniciarTimer / restore (no visible UI) -->
<div id="omt-hidden-sync" hidden aria-hidden="true">
    <input type="number" id="omt-sync-hr" value="">
    <input type="number" id="omt-sync-min" value="">
    <input type="number" id="omt-sync-sec" value="">
</div>

<!-- Legacy id kept so restore/teardown null-guards stay safe; panel unused in-video -->
<div id="setup-panel" class="glass-panel" style="display:none;" hidden></div>
<div id="omt-shuttle-cheatsheet" style="display:none;" hidden></div>
<input type="checkbox" id="omt-shuttle-enable-toggle" style="display:none;" hidden>

<!-- CONTROLS PANEL (YouTube-like bottom bar) -->
<div id="controls-panel" class="glass-panel omt-panel omt-controls">
    <div class="drag-handle" id="controls-handle">
        <div class="drag-side-left">
            <select id="omt-speed-select" class="top-select" title="Playback speed">
                <option value="0.25">0.25x</option>
                <option value="0.5">0.50x</option>
                <option value="1.0" selected>1.00x</option>
                <option value="1.5">1.50x</option>
                <option value="2.0">2.00x</option>
            </select>
        </div>
        <div class="drag-center-grip">${omtIcon('grip-horizontal', 14, 'omt-grip')}</div>
        <div class="drag-side-right">
            <div class="omt-live-volume">
                <button id="omt-live-btn" type="button" title="Go to Live Edge">
                    <span class="live-dot"></span><span class="live-label">LIVE</span>
                </button>
                <span class="omt-live-spacer" aria-hidden="true"></span>
                <button class="handle-btn" id="omt-volume-icon-btn" type="button" title="Mute/Unmute">${omtIcon('volume-2', 15)}</button>
                <input type="range" id="omt-volume-range" min="0" max="1" step="0.05" value="1">
            </div>
            <button class="handle-btn" id="omt-btn-fullscreen" type="button" title="Fullscreen">${omtIcon('maximize', 15)}</button>
        </div>
    </div>

    <div class="timeline-container">
        <div class="timeline-badges-row" id="omt-kickoff-jumps">
            <button id="omt-jump-k1"  class="kickoff-badge k1"  style="display:none;" type="button" title="Jump to 1st Half Kickoff">1st</button>
            <button id="omt-jump-k2"  class="kickoff-badge k2"  style="display:none;" type="button" title="Jump to 2nd Half Kickoff">2nd</button>
            <button id="omt-jump-kc1" class="kickoff-badge kc1" style="display:none;" type="button" title="Jump to Custom 1 Kickoff">C1</button>
            <button id="omt-jump-kc2" class="kickoff-badge kc2" style="display:none;" type="button" title="Jump to Custom 2 Kickoff">C2</button>
        </div>
        <div class="timeline-slider-row">
            <span id="omt-v-time-current">00:00:00</span>
            <div class="omt-timeline-track">
                <input type="range" id="omt-timeline-slider" class="timeline-slider" min="0" max="100" value="0" step="0.01">
                <div id="omt-timeline-markers"></div>
            </div>
            <span id="omt-v-time-duration">00:00:00</span>
        </div>
    </div>

    <div class="controls-content">
        <div class="ctrl-group-left">
            <button class="ctrl-btn" id="omt-m120" type="button" title="-2 min">${omtIconBtnLabel('rewind', '2m')}</button>
            <button class="ctrl-btn" id="omt-m10" type="button" title="-10 s">${omtIconBtnLabel('skip-back', '10s')}</button>
            <button class="ctrl-btn" id="omt-m2" type="button" title="-2 s">${omtIconBtnLabel('skip-back', '2s')}</button>
        </div>
        <div class="ctrl-group-center">
            <div class="separator"></div>
            <button class="ctrl-btn btn-frame" id="omt-prev-frame" type="button" title="Previous Frame">${omtIcon('step-back', 15)}</button>
            <button class="ctrl-btn btn-play" id="omt-btn-play" type="button">${omtIconBtnLabel('play', 'Play', 16)}</button>
            <button class="ctrl-btn btn-frame" id="omt-next-frame" type="button" title="Next Frame">${omtIcon('step-forward', 15)}</button>
            <div class="separator"></div>
        </div>
        <div class="ctrl-group-right">
            <button class="ctrl-btn" id="omt-p2" type="button" title="+2 s">${omtIconBtnLabel('skip-forward', '2s')}</button>
            <button class="ctrl-btn" id="omt-p10" type="button" title="+10 s">${omtIconBtnLabel('skip-forward', '10s')}</button>
            <button class="ctrl-btn" id="omt-p120" type="button" title="+2 min">${omtIconBtnLabel('fast-forward', '2m')}</button>
        </div>
    </div>
</div>`;
    }

    /* =========================================================
       5. CACHE UI ELEMENT REFERENCES
       ========================================================= */
    function q(id) { return omtRoot ? omtRoot.querySelector('#' + id) : null; }

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
