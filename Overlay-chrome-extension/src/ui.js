/* Inject Overlay MatchTimer HUD, cache element refs, compact layout, fullscreen reparent. */
    /* =========================================================
       4. INJECT UI INTO THE PAGE
       Plain match clock top-left. Floating draggable control panel
       (v1.2.2 structure, dark restyle). Timeline alone at the video
       bottom edge. Expandable more panel lives inside the floating box.
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

    function tip(text) {
        return ' data-tip="' + String(text).replace(/"/g, '&quot;') + '"';
    }

    function buildHTML() {
        return `
<div id="match-timer-wrap">
    <div id="match-timer">00:00</div>
</div>
<div id="osd-message">MatchTimer</div>

<!-- Hidden whistle-time fields: kept for iniciarTimer / restore (no visible UI) -->
<div id="omt-hidden-sync" hidden aria-hidden="true">
    <input type="number" id="omt-sync-hr" value="">
    <input type="number" id="omt-sync-min" value="">
    <input type="number" id="omt-sync-sec" value="">
</div>

<!-- Legacy ids kept for null-guards / restore -->
<div id="setup-panel" class="glass-panel" style="display:none;" hidden></div>
<div id="omt-shuttle-cheatsheet" style="display:none;" hidden></div>

<!-- Kick-off jump targets stay in DOM for wire/markers; no visible chip row -->
<div id="omt-kickoff-jumps" hidden aria-hidden="true">
    <button id="omt-jump-k1" type="button" style="display:none;"></button>
    <button id="omt-jump-k2" type="button" style="display:none;"></button>
    <button id="omt-jump-kc1" type="button" style="display:none;"></button>
    <button id="omt-jump-kc2" type="button" style="display:none;"></button>
</div>

<!-- Timeline alone: full-width thin bar at the very bottom of the video -->
<div id="omt-timeline-bar" class="omt-timeline-bar">
    <div class="omt-timeline-track">
        <input type="range" id="omt-timeline-slider" class="timeline-slider omt-tip" min="0" max="100" value="0" step="0.01"${tip('Seek timeline')}>
        <div id="omt-timeline-markers"></div>
    </div>
    <div class="omt-timeline-times">
        <span id="omt-v-time-current" class="omt-time-text omt-tip"${tip('Current video time')}>00:00:00</span>
        <span class="omt-time-sep" aria-hidden="true">/</span>
        <span id="omt-v-time-duration" class="omt-time-text omt-tip"${tip('Duration / live edge')}>00:00:00</span>
    </div>
</div>

<!-- Floating draggable control panel (Option A transport + speed row) -->
<div id="controls-panel" class="glass-panel">
    <div class="drag-handle" id="controls-handle">
        <div class="drag-side-left">
            <button type="button" id="omt-more-toggle" class="omt-more-toggle handle-btn omt-tip" aria-expanded="false"${tip('Match controls')}>
                <span class="omt-more-icon-collapsed">${omtIcon('chevrons-up', 16)}</span>
                <span class="omt-more-icon-expanded" hidden>${omtIcon('chevrons-down', 16)}</span>
            </button>
            <select id="omt-speed-select" class="top-select omt-tip"${tip('Playback speed (Z / C / X)')}>
                <option value="0.25">0.25x</option>
                <option value="0.5">0.50x</option>
                <option value="1.0" selected>1.00x</option>
                <option value="1.5">1.50x</option>
                <option value="2.0">2.00x</option>
            </select>
            <button type="button" id="omt-hide-panel" class="handle-btn omt-tip"${tip('Hide controls (H)')}>
                ${omtIcon('eye-off', 16)}
            </button>
        </div>
        <div class="drag-center-grip" aria-hidden="true">${omtIcon('grip-horizontal', 16)}</div>
        <div class="drag-side-right">
            <button id="omt-live-btn" class="omt-tip" type="button"${tip('Go to live edge (L)')}>
                <span class="live-dot"></span><span class="live-label">LIVE</span>
            </button>
            <span class="omt-live-spacer" aria-hidden="true"></span>
            <button class="handle-btn omt-tip" id="omt-volume-icon-btn" type="button"${tip('Mute / Unmute')}>${omtIcon('volume-2', 16)}</button>
            <input type="range" id="omt-volume-range" class="omt-tip" min="0" max="1" step="0.05" value="1"${tip('Volume')}>
            <button class="handle-btn omt-tip" id="omt-btn-fullscreen" type="button"${tip('Fullscreen')}>${omtIcon('maximize', 16)}</button>
        </div>
    </div>

    <div id="omt-more-panel" class="omt-more-panel" aria-hidden="true">
        <div id="omt-kickoff-bar" class="omt-more-block">
            <label class="omt-more-label" for="omt-half-select">Period</label>
            <select id="omt-half-select" class="omt-tip" title="Match period"${tip('Match period')}>
                <option value="1">1st Half</option>
                <option value="2">2nd Half</option>
                <option value="custom1">Custom 1</option>
                <option value="custom2">Custom 2</option>
            </select>
            <div id="omt-custom-c1" class="omt-custom-minute" style="display:none;">
                <label class="omt-more-label" for="omt-custom-minute-c1">Start min</label>
                <input type="number" id="omt-custom-minute-c1" class="omt-tip" placeholder="e.g. 90" min="0"${tip('Custom 1 start minute')}>
            </div>
            <div id="omt-custom-c2" class="omt-custom-minute" style="display:none;">
                <label class="omt-more-label" for="omt-custom-minute-c2">Start min</label>
                <input type="number" id="omt-custom-minute-c2" class="omt-tip" placeholder="e.g. 105" min="0"${tip('Custom 2 start minute')}>
            </div>
            <button type="button" class="btn-sync omt-tip" id="omt-btn-set-kickoff"${tip('Set kick-off at current frame (K)')}>Kick-off</button>
            <button type="button" id="omt-btn-clear-timer" class="btn-clear-timer omt-tip"${tip('Clear match timer')}>${omtIcon('x', 13)}</button>
            <div class="omt-offset-nudge" aria-label="Kick-off offset">
                <button type="button" class="omt-offset-btn omt-tip" id="omt-offset-m5"${tip('Offset −5 seconds')}>${omtIcon('chevrons-left', 12)}5</button>
                <button type="button" class="omt-offset-btn omt-tip" id="omt-offset-m1"${tip('Offset −1 second')}>−1</button>
                <button type="button" class="omt-offset-btn omt-tip" id="omt-offset-p1"${tip('Offset +1 second')}>+1</button>
                <button type="button" class="omt-offset-btn omt-tip" id="omt-offset-p5"${tip('Offset +5 seconds')}>5${omtIcon('chevrons-right', 12)}</button>
            </div>
        </div>

        <div id="omt-examino-settings" class="omt-more-block omt-source-block" style="display:none;">
            <label class="omt-more-label" for="omt-examino-source">Source</label>
            <select id="omt-examino-source" class="omt-tip"${tip('Examino stream source')}>
                <option value="DVR">DVR</option>
                <option value="VOD">VOD</option>
            </select>
            <div class="omt-toggle-row omt-tip"${tip('Auto-switch to VOD when available')}>
                <span>Auto VOD</span>
                <label class="omt-switch" for="omt-examino-auto-vod">
                    <input type="checkbox" id="omt-examino-auto-vod" checked>
                    <span class="omt-switch-slider"></span>
                </label>
            </div>
        </div>

        <div class="omt-more-block omt-shuttle-block">
            <div class="omt-toggle-row omt-tip"${tip('Enable ShuttleXpress pairing on this browser')}>
                <span>ShuttleXpress</span>
                <label class="omt-switch" for="omt-shuttle-enable-toggle">
                    <input type="checkbox" id="omt-shuttle-enable-toggle">
                    <span class="omt-switch-slider"></span>
                </label>
            </div>
        </div>
    </div>

    <div class="controls-content">
        <div class="omt-transport-seg" role="group" aria-label="Playback transport">
            <button class="ctrl-btn omt-tip" id="omt-m120" type="button"${tip('Skip −2 minutes (Ctrl + ←)')}>${omtIcon('rewind', 18)}<span class="omt-btn-label">2m</span></button>
            <button class="ctrl-btn omt-tip" id="omt-m10" type="button"${tip('Skip −10 seconds (Shift + ←)')}>${omtIcon('skip-back', 18)}<span class="omt-btn-label">10s</span></button>
            <button class="ctrl-btn omt-tip" id="omt-m2" type="button"${tip('Skip −2 seconds (←)')}>${omtIcon('skip-back', 17)}<span class="omt-btn-label">2s</span></button>
            <span class="omt-seg-divider" aria-hidden="true"></span>
            <button class="ctrl-btn btn-frame omt-tip" id="omt-prev-frame" type="button"${tip('Previous frame (↓)')}>${omtIcon('step-back', 18)}</button>
            <button class="ctrl-btn btn-play omt-tip" id="omt-btn-play" type="button"${tip('Play / Pause (Space)')}>${omtIcon('play', 22)}</button>
            <button class="ctrl-btn btn-frame omt-tip" id="omt-next-frame" type="button"${tip('Next frame (↑)')}>${omtIcon('step-forward', 18)}</button>
            <span class="omt-seg-divider" aria-hidden="true"></span>
            <button class="ctrl-btn omt-tip" id="omt-p2" type="button"${tip('Skip +2 seconds (→)')}><span class="omt-btn-label">2s</span>${omtIcon('skip-forward', 17)}</button>
            <button class="ctrl-btn omt-tip" id="omt-p10" type="button"${tip('Skip +10 seconds (Shift + →)')}><span class="omt-btn-label">10s</span>${omtIcon('skip-forward', 18)}</button>
            <button class="ctrl-btn omt-tip" id="omt-p120" type="button"${tip('Skip +2 minutes (Ctrl + →)')}><span class="omt-btn-label">2m</span>${omtIcon('fast-forward', 18)}</button>
        </div>
        <div class="omt-speed-row" role="group" aria-label="Playback speed">
            <button type="button" class="omt-speed-chip omt-tip" data-speed="0.5"${tip('Speed 0.5x')}>0.5x</button>
            <button type="button" class="omt-speed-chip omt-tip is-active" data-speed="1.0"${tip('Speed 1x (X)')}>1x</button>
            <button type="button" class="omt-speed-chip omt-tip" data-speed="1.5"${tip('Speed 1.5x')}>1.5x</button>
            <button type="button" class="omt-speed-chip omt-tip" data-speed="2.0"${tip('Speed 2x')}>2x</button>
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

    function setMorePanelOpen(open) {
        const panel = q('omt-more-panel');
        const btn = q('omt-more-toggle');
        if (!panel || !btn) return;
        const next = !!open;
        panel.classList.toggle('is-open', next);
        panel.setAttribute('aria-hidden', next ? 'false' : 'true');
        btn.setAttribute('aria-expanded', next ? 'true' : 'false');
        btn.classList.toggle('is-open', next);
        const collapsedIcon = btn.querySelector('.omt-more-icon-collapsed');
        const expandedIcon = btn.querySelector('.omt-more-icon-expanded');
        if (collapsedIcon) collapsedIcon.hidden = next;
        if (expandedIcon) expandedIcon.hidden = !next;
        if (controlsPanel) controlsPanel.classList.toggle('omt-more-open', next);
    }

    function toggleMorePanel() {
        const panel = q('omt-more-panel');
        if (!panel) return;
        setMorePanelOpen(!panel.classList.contains('is-open'));
    }
