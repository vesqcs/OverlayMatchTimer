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
        omtContainHudStacking(anchor);

        omtRoot = document.createElement('div');
        omtRoot.id = 'omt-root';
        omtRoot.classList.add(site.rootClass);
        omtRoot.innerHTML = buildHTML();
        anchor.appendChild(omtRoot);

        updateCompactLayout();
        ensureFullscreenHook();
        updateFullscreenButton();
    }

    /**
     * #omt-root uses a huge z-index to beat the player's own layers. Without a
     * stacking context on the player box that z-index escapes to the page and
     * paints over host UI stacked above the player (InPlay schedule curtain
     * z-index 3, its arrow z-index 4). isolation:isolate keeps the HUD inside
     * the player's layer; it does not move, resize or hide the host node.
     */
    let omtIsolatedAnchor = null;
    let omtIsolatedAnchorPrev = '';

    function omtContainHudStacking(anchor) {
        omtReleaseHudStacking();
        if (!anchor || !anchor.style) return;
        try {
            omtIsolatedAnchorPrev = anchor.style.getPropertyValue('isolation') || '';
            anchor.style.setProperty('isolation', 'isolate');
            omtIsolatedAnchor = anchor;
        } catch (_) {}
    }

    function omtReleaseHudStacking() {
        if (!omtIsolatedAnchor) return;
        try {
            if (omtIsolatedAnchorPrev) omtIsolatedAnchor.style.setProperty('isolation', omtIsolatedAnchorPrev);
            else omtIsolatedAnchor.style.removeProperty('isolation');
        } catch (_) {}
        omtIsolatedAnchor = null;
        omtIsolatedAnchorPrev = '';
    }

    /** Host-chrome hide CSS is gated on this; set on mount, cleared on teardown only.
     *  Also stamps omt-host-<site> so Examino :has() rules never match on InPlay. */
    function omtSetHudMounted(on) {
        try {
            const root = document.documentElement;
            root.classList.toggle('omt-hud-on', !!on);
            ['examino', 'inplayip', 'local', 'xeatre'].forEach((id) => {
                root.classList.toggle('omt-host-' + id, !!(on && site && site.id === id));
            });
        } catch (_) {}
    }

    function updateCompactLayout() {
        if (!omtRoot) return;
        // Xeatre: viewport-fit owns compact/micro + player sizing (v2.2.10).
        if (site && site.id === 'xeatre') {
            if (typeof omtXeatreFitViewport === 'function') omtXeatreFitViewport();
            // Fit path also refreshes clock picture inset.
            return;
        }
        // Examino v2.2.16: #omt-root is viewport-fixed — compact from the tab,
        // not the shorter .op-player box.
        let w;
        let h;
        if (site && site.id === 'examino') {
            w = window.innerWidth || 0;
            h = window.innerHeight || 0;
        } else {
            const anchor = omtRoot.parentElement;
            w = (anchor && anchor.clientWidth) || window.innerWidth;
            h = (anchor && anchor.clientHeight) || window.innerHeight;
        }
        const compact = site.id === 'examino' && (w < 720 || h < 420);
        omtRoot.classList.toggle('omt-compact', compact);
        if (typeof omtUpdateClockPictureInset === 'function') omtUpdateClockPictureInset();
    }

    /**
     * v2.2.12 / v2.2.21: Anchor #match-timer-wrap to the video *picture*
     * (InPlay + Xeatre + Examino). Read-only on the <video> — never writes
     * size/position/transform on the media element or host layout.
     * Examino's #omt-root is viewport-fixed (v2.2.16); the clock follows the
     * video's real on-screen rect (incl. object-fit letterboxing). Panel/bar
     * stay full-tab. No polling — resize / fullscreenchange / loadedmetadata.
     */
    function omtVideoContentRect(videoEl) {
        if (!videoEl || !videoEl.getBoundingClientRect) return null;
        const r = videoEl.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return null;
        const vw = videoEl.videoWidth || 0;
        const vh = videoEl.videoHeight || 0;
        let fit = 'fill';
        try {
            fit = (getComputedStyle(videoEl).objectFit || 'fill').toLowerCase();
        } catch (_) {}
        // object-fit:contain / scale-down — letterbox inside the element box.
        if (vw > 0 && vh > 0 && (fit === 'contain' || fit === 'scale-down')) {
            const scale = Math.min(r.width / vw, r.height / vh);
            const w = vw * scale;
            const h = vh * scale;
            return {
                left: r.left + (r.width - w) / 2,
                top: r.top + (r.height - h) / 2,
                width: w,
                height: h,
                right: r.left + (r.width - w) / 2 + w,
                bottom: r.top + (r.height - h) / 2 + h
            };
        }
        // cover — picture fills the box; element rect is the visible frame.
        // fill / none / metadata missing — use the element box as-is.
        return {
            left: r.left, top: r.top, width: r.width, height: r.height,
            right: r.right, bottom: r.bottom
        };
    }

    function omtUpdateClockPictureInset() {
        if (!omtRoot) return;
        const id = site && site.id;
        if (id !== 'inplayip' && id !== 'xeatre' && id !== 'examino') {
            try {
                omtRoot.classList.remove('omt-clock-in-picture');
                ['--omt-pic-top', '--omt-pic-left', '--omt-pic-right', '--omt-pic-bottom',
                    '--omt-pic-width', '--omt-pic-height'].forEach((k) => {
                    try { omtRoot.style.removeProperty(k); } catch (_) {}
                });
            } catch (_) {}
            return;
        }
        // READ ONLY — never assign videoEl.style / host layout here (v2.2.21).
        const videoEl = vid || (site && typeof site.findVideo === 'function' && site.findVideo());
        const rootRect = omtRoot.getBoundingClientRect();
        const pic = omtVideoContentRect(videoEl);
        if (!pic || rootRect.width < 2 || rootRect.height < 2) {
            try { omtRoot.classList.remove('omt-clock-in-picture'); } catch (_) {}
            return;
        }
        const top = Math.max(0, pic.top - rootRect.top);
        const left = Math.max(0, pic.left - rootRect.left);
        const right = Math.max(0, rootRect.right - pic.right);
        const bottom = Math.max(0, rootRect.bottom - pic.bottom);
        try {
            omtRoot.style.setProperty('--omt-pic-top', top + 'px');
            omtRoot.style.setProperty('--omt-pic-left', left + 'px');
            omtRoot.style.setProperty('--omt-pic-right', right + 'px');
            omtRoot.style.setProperty('--omt-pic-bottom', bottom + 'px');
            omtRoot.style.setProperty('--omt-pic-width', pic.width + 'px');
            omtRoot.style.setProperty('--omt-pic-height', pic.height + 'px');
            omtRoot.classList.add('omt-clock-in-picture');
        } catch (_) {}
    }
    try { window.__omtUpdateClockPictureInset = omtUpdateClockPictureInset; } catch (_) {}

    function updateFullscreenButton() {
        const btn = q('omt-btn-fullscreen');
        if (!btn) return;
        const on = !!document.fullscreenElement;
        btn.innerHTML = omtIcon(on ? 'minimize' : 'maximize', 16);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
        btn.classList.toggle('is-fullscreen', on);
    }

    function ensureFullscreenHook() {
        if (fullscreenHooked) return;
        fullscreenHooked = true;
        document.addEventListener('fullscreenchange', () => {
            if (!vid || !omtRoot) return;
            updateCompactLayout();
            updateFullscreenButton();
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
            if (typeof omtUpdateClockPictureInset === 'function') omtUpdateClockPictureInset();
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

<!-- Timeline: full-width scrubber on top; chrome row (time left / fullscreen right) below. -->
<div id="omt-timeline-bar" class="omt-timeline-bar">
    <div class="omt-timeline-track">
        <div id="omt-timeline-period-ticks" class="omt-timeline-period-ticks" aria-hidden="true"></div>
        <input type="range" id="omt-timeline-slider" class="timeline-slider" min="0" max="100" value="0" step="0.01" aria-label="Timeline">
        <div id="omt-timeline-markers" aria-hidden="true"></div>
    </div>
    <div id="omt-timeline-hover-tip" class="omt-timeline-hover-tip" hidden></div>
    <div class="omt-timeline-chrome-row">
        <div class="omt-timeline-chrome-left">
            <button type="button" class="omt-timeline-play-btn" id="omt-timeline-play-btn" aria-label="Play" aria-pressed="false">${omtIcon('play', 16)}</button>
            <button type="button" class="omt-timeline-vol-btn" id="omt-timeline-vol-btn" aria-label="Mute">${omtIcon('volume-2', 16)}</button>
            <input type="range" id="omt-timeline-vol-range" class="omt-timeline-vol-range" min="0" max="1" step="0.05" value="1" aria-label="Volume">
            <div class="omt-timeline-times" data-omt-time-mode="post">
                <button type="button" id="omt-timeline-live-indicator" class="omt-timeline-live-indicator" hidden aria-label="Go to live">
                    <span id="omt-timeline-live-delay" class="omt-timeline-live-delay">-0:00</span>
                    <span id="omt-timeline-live-chip" class="omt-timeline-live-chip" hidden>LIVE</span>
                </button>
                <div id="omt-timeline-post-times" class="omt-timeline-post-times">
                    <span id="omt-v-time-current" class="omt-time-text">0:00</span>
                    <span class="omt-time-sep" aria-hidden="true">/</span>
                    <span id="omt-v-time-duration" class="omt-time-text">0:00</span>
                </div>
                <span id="omt-timeline-match-clock" class="omt-timeline-match-clock" hidden>00:00</span>
            </div>
        </div>
        <div class="omt-timeline-chrome-right">
            <!-- Live/DVR only: playhead / furthest reachable (seekable edge). -->
            <span id="omt-timeline-video-range" class="omt-timeline-video-range" hidden aria-label="Video position / live edge">0:00 / 0:00</span>
            <button type="button" class="omt-timeline-fs-btn" id="omt-btn-fullscreen" aria-label="Enter fullscreen" aria-pressed="false">${omtIcon('maximize', 16)}</button>
        </div>
    </div>
</div>

<!-- Portal tip lives outside .glass-panel so backdrop-filter cannot make it translucent. -->
<div id="omt-control-tip" class="omt-control-tip" hidden></div>

<!-- Floating control card (v1.7.2 layout): handle → more (middle) → transport/speeds. Grows UP via bottom anchor. -->
<div id="omt-controls-panel" class="glass-panel">
    <div class="drag-handle" id="controls-handle">
        <div class="drag-side-left">
            <button type="button" id="omt-more-toggle" class="omt-more-toggle handle-btn omt-tip" aria-expanded="false"${tip('More controls')}>
                <span class="omt-more-icon-collapsed">${omtIcon('chevrons-up', 16)}</span>
                <span class="omt-more-icon-expanded" hidden>${omtIcon('chevrons-down', 16)}</span>
            </button>
            <select id="omt-speed-select" class="top-select omt-tip"${tip('Speed (Z / C / X)')}>
                <option value="0.25">0.25x</option>
                <option value="0.5">0.50x</option>
                <option value="0.75">0.75x</option>
                <option value="1.0" selected>1.00x</option>
                <option value="1.25">1.25x</option>
                <option value="1.5">1.50x</option>
                <option value="2.0">2.00x</option>
            </select>
            <button type="button" id="omt-hide-panel" class="handle-btn omt-tip is-auto-hide-on" aria-pressed="true"${tip('Auto hide: on')}>
                ${omtIcon('eye-off', 16)}
            </button>
        </div>
        <div class="drag-center-grip" aria-hidden="true">${omtIcon('grip-horizontal', 16)}</div>
        <div class="drag-side-right">
            <button id="omt-live-btn" class="omt-tip" type="button"${tip('Go to live (L)')}>
                <span class="live-dot"></span><span class="live-label">LIVE</span>
            </button>
            <span class="omt-live-spacer" aria-hidden="true"></span>
            <button class="handle-btn omt-tip" id="omt-volume-icon-btn" type="button"${tip('Mute / Unmute')}>${omtIcon('volume-2', 16)}</button>
            <input type="range" id="omt-volume-range" class="omt-tip" min="0" max="1" step="0.05" value="1"${tip('Volume')}>
        </div>
    </div>

    <div id="omt-more-panel" class="omt-more-panel" aria-hidden="true">
        <div id="omt-kickoff-bar" class="omt-more-block">
            <label class="omt-more-label" for="omt-half-select">Period</label>
            <select id="omt-half-select" class="omt-tip" title="Match period"${tip('Period')}>
                <option value="1">1st Half</option>
                <option value="2">2nd Half</option>
                <option value="custom1">Custom 1</option>
                <option value="custom2">Custom 2</option>
            </select>
            <div id="omt-custom-c1" class="omt-custom-minute" style="display:none;">
                <label class="omt-more-label" for="omt-custom-minute-c1">Start min</label>
                <input type="number" id="omt-custom-minute-c1" class="omt-tip" placeholder="e.g. 90" min="0"${tip('Custom 1 start')}>
            </div>
            <div id="omt-custom-c2" class="omt-custom-minute" style="display:none;">
                <label class="omt-more-label" for="omt-custom-minute-c2">Start min</label>
                <input type="number" id="omt-custom-minute-c2" class="omt-tip" placeholder="e.g. 105" min="0"${tip('Custom 2 start')}>
            </div>
            <button type="button" class="btn-sync omt-tip" id="omt-btn-set-kickoff"${tip('Set kick-off (K)')}>Kick-off</button>
            <button type="button" id="omt-btn-clear-timer" class="btn-clear-timer omt-tip"${tip('Clear timer')}>${omtIcon('x', 13)}</button>
            <div class="omt-offset-nudge" aria-label="Kick-off offset">
                <button type="button" class="omt-offset-btn omt-tip" id="omt-offset-m5"${tip('Offset −5s')}>${omtIcon('chevrons-left', 12)}5</button>
                <button type="button" class="omt-offset-btn omt-tip" id="omt-offset-m1"${tip('Offset −1s')}>−1</button>
                <button type="button" class="omt-offset-btn omt-tip" id="omt-offset-p1"${tip('Offset +1s')}>+1</button>
                <button type="button" class="omt-offset-btn omt-tip" id="omt-offset-p5"${tip('Offset +5s')}>5${omtIcon('chevrons-right', 12)}</button>
            </div>
        </div>

        <div id="omt-examino-settings" class="omt-more-block omt-source-block" style="display:none;">
            <label class="omt-more-label" for="omt-examino-source">Source</label>
            <select id="omt-examino-source" class="omt-tip"${tip('Stream source')}>
                <option value="DVR">DVR</option>
                <option value="VOD">VOD</option>
            </select>
            <div class="omt-toggle-row omt-tip"${tip('Auto-switch to VOD')}>
                <span>Auto VOD</span>
                <label class="omt-switch" for="omt-examino-auto-vod">
                    <input type="checkbox" id="omt-examino-auto-vod" checked>
                    <span class="omt-switch-slider"></span>
                </label>
            </div>
        </div>

        <div class="omt-more-block omt-shuttle-block">
            <div class="omt-toggle-row omt-tip"${tip('ShuttleXpress on this browser')}>
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
            <button class="ctrl-btn" id="omt-m120" type="button">${omtIcon('rewind', 18)}<span class="omt-btn-label">2m</span></button>
            <button class="ctrl-btn" id="omt-m10" type="button">${omtIcon('skip-back', 18)}<span class="omt-btn-label">10s</span></button>
            <button class="ctrl-btn" id="omt-m2" type="button">${omtIcon('skip-back', 17)}<span class="omt-btn-label">2s</span></button>
            <span class="omt-seg-divider" aria-hidden="true"></span>
            <button class="ctrl-btn btn-frame omt-tip" id="omt-prev-frame" type="button"${tip('Previous frame (↓)')}>${omtIcon('step-back', 18)}</button>
            <button class="ctrl-btn btn-play" id="omt-btn-play" type="button">${omtIcon('play', 22)}</button>
            <button class="ctrl-btn btn-frame omt-tip" id="omt-next-frame" type="button"${tip('Next frame (↑)')}>${omtIcon('step-forward', 18)}</button>
            <span class="omt-seg-divider" aria-hidden="true"></span>
            <button class="ctrl-btn" id="omt-p2" type="button"><span class="omt-btn-label">2s</span>${omtIcon('skip-forward', 16)}</button>
            <button class="ctrl-btn" id="omt-p10" type="button"><span class="omt-btn-label">10s</span>${omtIcon('skip-forward', 16)}</button>
            <button class="ctrl-btn" id="omt-p120" type="button"><span class="omt-btn-label">2m</span>${omtIcon('fast-forward', 16)}</button>
        </div>
        <div class="omt-speed-row" role="group" aria-label="Playback speed">
            <button type="button" class="omt-speed-chip" data-speed="0.25">0.25x</button>
            <button type="button" class="omt-speed-chip" data-speed="0.5">0.5x</button>
            <button type="button" class="omt-speed-chip" data-speed="0.75">0.75x</button>
            <button type="button" class="omt-speed-chip is-active" data-speed="1.0">1x</button>
            <button type="button" class="omt-speed-chip" data-speed="1.25">1.25x</button>
            <button type="button" class="omt-speed-chip" data-speed="1.5">1.5x</button>
            <button type="button" class="omt-speed-chip" data-speed="2.0">2x</button>
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
        controlsPanel = q('omt-controls-panel');
        timelineSlider = q('omt-timeline-slider');
        vTimeCurrent = q('omt-v-time-current');
        vTimeDuration = q('omt-v-time-duration');
        // Live/post slots are looked up by id when painting (no extra cached refs required).
        liveBtn = q('omt-live-btn');
        btnMainPlay = q('omt-btn-play');
        btnTimelinePlay = q('omt-timeline-play-btn');
        speedSelect = q('omt-speed-select');
        volumeRange = q('omt-volume-range');
        volumeIconBtn = q('omt-volume-icon-btn');
        timelineVolRange = q('omt-timeline-vol-range');
        timelineVolBtn = q('omt-timeline-vol-btn');
        shuttleToggle = q('omt-shuttle-enable-toggle');
        shuttleCheatsheet = q('omt-shuttle-cheatsheet');
    }

    /** Keep card bottom-anchored so height changes grow UP; clamp fully inside root. */
    function anchorControlsPanelBottom(preserveBottomPx) {
        if (!controlsPanel || !omtRoot) return;
        const rootRect = omtRoot.getBoundingClientRect();
        const before = controlsPanel.getBoundingClientRect();
        let bottomPx = (preserveBottomPx != null)
            ? preserveBottomPx
            : Math.max(0, rootRect.bottom - before.bottom);

        // Convert any drag `top` into `bottom` so expand/collapse never pushes transport down.
        let leftPx = before.left - rootRect.left;
        controlsPanel.style.bottom = bottomPx + 'px';
        controlsPanel.style.top = 'auto';
        controlsPanel.style.right = 'auto';
        // Preserve horizontal place after a drag (clear centering transform).
        if (controlsPanel.style.transform === 'none' || controlsPanel.style.left) {
            // Clamp so a shrink cannot leave the card hanging past the right edge
            // (Xeatre narrow-window right-pin — v2.2.19).
            const maxLeft = Math.max(0, rootRect.width - before.width);
            leftPx = Math.max(0, Math.min(leftPx, maxLeft));
            controlsPanel.style.left = leftPx + 'px';
            controlsPanel.style.transform = 'none';
        }

        const after = controlsPanel.getBoundingClientRect();
        if (after.top < rootRect.top) {
            const overflow = rootRect.top - after.top;
            bottomPx = Math.max(0, bottomPx - overflow);
            controlsPanel.style.bottom = bottomPx + 'px';
        }
        // Re-clamp left after width may have changed (compact / min() shrink).
        if (controlsPanel.style.transform === 'none' || controlsPanel.style.left) {
            const live = controlsPanel.getBoundingClientRect();
            const maxLeft = Math.max(0, rootRect.width - live.width);
            let liveLeft = live.left - rootRect.left;
            liveLeft = Math.max(0, Math.min(liveLeft, maxLeft));
            controlsPanel.style.left = liveLeft + 'px';
        }
        updateControlsTipFlip();
    }

    /** Flip top-row tips below the controls when the card sits near the player top. */
    function updateControlsTipFlip() {
        if (!controlsPanel || !omtRoot) return;
        const rootRect = omtRoot.getBoundingClientRect();
        const rect = controlsPanel.getBoundingClientRect();
        const roomAbove = rect.top - rootRect.top;
        const flip = roomAbove < 36;
        controlsPanel.classList.toggle('omt-tips-flip-below', flip);
        omtRoot.classList.toggle('omt-tips-flip-below', flip);
    }

    /** Measure data-tip width for horizontal edge clamping. */
    function measureOmtTipWidth(text) {
        let probe = document.getElementById('omt-tip-measure');
        if (!probe) {
            probe = document.createElement('span');
            probe.id = 'omt-tip-measure';
            probe.setAttribute('aria-hidden', 'true');
            probe.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:11px;font-weight:500;' +
                'font-family:system-ui,-apple-system,sans-serif;padding:4px 7px;white-space:nowrap;' +
                'border:1px solid transparent;pointer-events:none;visibility:hidden;';
            document.documentElement.appendChild(probe);
        }
        probe.textContent = text || '';
        return probe.offsetWidth || 0;
    }

    /**
     * Ancestors with transform / filter / backdrop-filter become the containing
     * block for position:fixed. Tips inside #omt-controls-panel (.glass-panel) must
     * use coordinates relative to that box, not the viewport.
     */
    function omtFixedContainingBlockOrigin(el) {
        let node = el ? el.parentElement : null;
        while (node && node !== document.documentElement) {
            const cs = getComputedStyle(node);
            const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
            if ((cs.transform && cs.transform !== 'none') ||
                (cs.filter && cs.filter !== 'none') ||
                (cs.perspective && cs.perspective !== 'none') ||
                (bf && bf !== 'none')) {
                const r = node.getBoundingClientRect();
                return { left: r.left, top: r.top, node: node };
            }
            node = node.parentElement;
        }
        return { left: 0, top: 0, node: null };
    }

    /**
     * Place a control tip with position:fixed so backdrop-filter on .glass-panel
     * cannot clip it. Clamp inside #omt-root (and prefer staying over the card).
     */
    function clampOmtControlTip(el) {
        if (!el || !omtRoot) return;
        const text = el.getAttribute('data-tip');
        if (!text) return;
        const tipW = measureOmtTipWidth(text);
        if (!tipW) return;
        const tipH = 24;
        const rootRect = omtRoot.getBoundingClientRect();
        const panel = el.closest('#omt-controls-panel');
        const panelRect = panel ? panel.getBoundingClientRect() : rootRect;
        const rect = el.getBoundingClientRect();
        const pad = 8;
        const flipBelow = !!(omtRoot.classList.contains('omt-tips-flip-below') ||
            (panel && panel.classList.contains('omt-tips-flip-below')));
        // More-panel tips (Open file, Shuttle, Kick-off row, …) prefer BELOW so they
        // don’t cover Period / Kick-off / neighbouring controls.
        const inMore = !!el.closest('#omt-more-panel');
        const preferBelow = flipBelow || inMore || el.id === 'omt-local-open-file';
        const inLeft = !!el.closest('.drag-side-left');
        const inRight = !!el.closest('.drag-side-right');
        let tipLeft;
        if (inLeft) tipLeft = rect.left;
        else if (inRight) tipLeft = rect.right - tipW;
        else tipLeft = rect.left + rect.width / 2 - tipW / 2;
        const minL = rootRect.left + pad;
        const maxR = rootRect.right - pad;
        const preferL = Math.max(minL, panelRect.left + pad);
        const preferR = Math.min(maxR, panelRect.right - pad);
        if (tipLeft < preferL) tipLeft = preferL;
        if (tipLeft + tipW > preferR) tipLeft = preferR - tipW;
        if (tipLeft < minL) tipLeft = minL;
        if (tipLeft + tipW > maxR) tipLeft = maxR - tipW;

        let tipTop = preferBelow ? (rect.bottom + 8) : (rect.top - tipH - 8);
        if (tipTop < rootRect.top + pad) tipTop = rect.bottom + 8;
        if (tipTop + tipH > rootRect.bottom - pad) {
            tipTop = preferBelow
                ? Math.max(rootRect.top + pad, rect.top - tipH - 8)
                : Math.max(rootRect.top + pad, rect.bottom + 8);
        }

        // Prefer the portal tip outside .glass-panel (opaque; true viewport fixed).
        const portal = q('omt-control-tip');
        if (portal) {
            portal.hidden = false;
            portal.textContent = text;
            portal.style.left = Math.round(tipLeft) + 'px';
            portal.style.top = Math.round(tipTop) + 'px';
            portal.dataset.forId = el.id || '';
            el.classList.add('omt-tip-portal');
        } else {
            // Fallback: ::after with containing-block-relative coords.
            const origin = omtFixedContainingBlockOrigin(el);
            el.classList.add('omt-tip-fixed', 'omt-tip-show');
            el.style.setProperty('--omt-tip-left', Math.round(tipLeft - origin.left) + 'px');
            el.style.setProperty('--omt-tip-top', Math.round(tipTop - origin.top) + 'px');
            el.style.setProperty('--omt-tip-shift', '0px');
        }
        el.dataset.omtTipViewportTop = String(Math.round(tipTop));
        el.dataset.omtTipViewportLeft = String(Math.round(tipLeft));
    }

    function clearOmtControlTip(el) {
        if (!el) return;
        // Tests / capture can freeze a tip through pointerleave races.
        if (el.dataset.omtHold === '1') return;
        el.classList.remove('omt-tip-fixed', 'omt-tip-show', 'omt-tip-portal');
        el.style.removeProperty('--omt-tip-left');
        el.style.removeProperty('--omt-tip-top');
        el.style.removeProperty('--omt-tip-shift');
        delete el.dataset.omtTipViewportTop;
        delete el.dataset.omtTipViewportLeft;
        const portal = q('omt-control-tip');
        if (portal && (!portal.dataset.forId || portal.dataset.forId === (el.id || '') || !el.id)) {
            portal.hidden = true;
            portal.textContent = '';
            portal.removeAttribute('data-for-id');
        }
    }

    function wireOmtTipEdgeClamp() {
        if (!omtRoot || omtRoot.dataset.omtTipClamp === '1') return;
        omtRoot.dataset.omtTipClamp = '1';
        const onEnter = (e) => {
            const t = e.target;
            if (!t || !t.closest) return;
            const el = t.closest('.omt-tip[data-tip]');
            if (el && omtRoot.contains(el)) clampOmtControlTip(el);
        };
        const onLeave = (e) => {
            const t = e.target;
            if (!t || !t.closest) return;
            const el = t.closest('.omt-tip[data-tip]');
            if (!el || !omtRoot.contains(el)) return;
            const next = e.relatedTarget;
            if (next && el.contains(next)) return;
            clearOmtControlTip(el);
        };
        omtRoot.addEventListener('pointerenter', onEnter, true);
        omtRoot.addEventListener('pointerleave', onLeave, true);
        omtRoot.addEventListener('focusin', onEnter, true);
        omtRoot.addEventListener('focusout', onLeave, true);
    }

    function setMorePanelOpen(open) {
        const panel = q('omt-more-panel');
        const btn = q('omt-more-toggle');
        if (!panel || !btn) return;
        const next = !!open;

        // Snapshot bottom edge before height change (transport must stay put).
        let bottomPx = null;
        if (controlsPanel && omtRoot) {
            const rootRect = omtRoot.getBoundingClientRect();
            const rect = controlsPanel.getBoundingClientRect();
            bottomPx = Math.max(0, rootRect.bottom - rect.bottom);
            // If previously dragged with top-only, switch to bottom before opening.
            anchorControlsPanelBottom(bottomPx);
        }

        panel.classList.toggle('is-open', next);
        panel.setAttribute('aria-hidden', next ? 'false' : 'true');
        btn.setAttribute('aria-expanded', next ? 'true' : 'false');
        btn.setAttribute('data-tip', next ? 'Less controls' : 'More controls');
        btn.classList.toggle('is-open', next);
        const collapsedIcon = btn.querySelector('.omt-more-icon-collapsed');
        const expandedIcon = btn.querySelector('.omt-more-icon-expanded');
        if (collapsedIcon) collapsedIcon.hidden = next;
        if (expandedIcon) expandedIcon.hidden = !next;
        if (controlsPanel) controlsPanel.classList.toggle('omt-more-open', next);

        // After layout, re-assert bottom + clamp top of viewport.
        requestAnimationFrame(() => {
            anchorControlsPanelBottom(bottomPx);
            updateControlsTipFlip();
        });
    }

    function toggleMorePanel() {
        const panel = q('omt-more-panel');
        if (!panel) return;
        setMorePanelOpen(!panel.classList.contains('is-open'));
    }
