/* InPlay multi-view (v2.3.0): compact per-tile control panels.
 *
 * Scope: UI layer only. Player/seek/playback helpers stay untouched —
 * tile actions briefly swap global `vid` via omtInplayMvWithVideo().
 * NO per-tile clock/kickoff (deferred to 2.3.1).
 *
 * Single-video path: identical to 2.2.23 — no MutationObserver, no
 * tile roots, no hotkey divert. Multi-view arms only when
 * `.players-container` exists (or ≥2 videos already present), and
 * sync/teardown runs only when the video count crosses 2↔1.
 */
    let inplayMvActive = false;
    let inplayMvArmMo = null;
    let inplayMvArmHost = null;
    let inplayMvSyncTimer = null;
    let inplayMvHotkeyVid = null;
    let inplayMvPointerHooked = false;
    let inplayMvLastVideoCount = 0;
    /** videoEl → { root, panel, ac, playBtn } */
    const inplayMvTiles = new Map();
    try {
        window.__omtInplayMvSyncCount = 0;
        window.__omtInplayMvActive = false;
        window.__omtInplayMvArmInstalled = false;
    } catch (_) {}

    function omtInplayMvBumpSync() {
        try {
            window.__omtInplayMvSyncCount = (window.__omtInplayMvSyncCount || 0) + 1;
        } catch (_) {}
    }

    function omtInplayMvWithVideo(target, fn) {
        if (!target || typeof fn !== 'function') return;
        const prev = vid;
        try {
            vid = target;
            return fn();
        } finally {
            vid = prev;
        }
    }

    function omtInplayMvListVideos() {
        const out = [];
        const seen = new Set();
        const push = (v) => {
            if (!v || v.tagName !== 'VIDEO' || !v.isConnected || seen.has(v)) return;
            // Skip tiny / hidden placeholders.
            try {
                if ((v.offsetWidth || 0) < 8 || (v.offsetHeight || 0) < 8) return;
            } catch (_) { return; }
            seen.add(v);
            out.push(v);
        };
        try {
            document.querySelectorAll('.video-js video.vjs-tech, .video-js video, .player-container video')
                .forEach(push);
        } catch (_) {}
        if (!out.length) {
            try { document.querySelectorAll('video').forEach(push); } catch (_) {}
        }
        return out;
    }

    function omtInplayMvFindShell(videoEl) {
        if (!videoEl || !videoEl.closest) return null;
        return videoEl.closest('.video-js') ||
            videoEl.closest('.vjs-player') ||
            videoEl.closest('.player-container') ||
            videoEl.parentElement;
    }

    function omtInplayMvIsPrimary(videoEl) {
        return !!(videoEl && vid && videoEl === vid);
    }

    function omtInplayMvSetHotkeyTarget(videoEl) {
        if (!inplayMvActive || !videoEl) return;
        inplayMvHotkeyVid = videoEl;
        try { window.__omtInplayMvHotkeyIndex = omtInplayMvListVideos().indexOf(videoEl); } catch (_) {}
    }

    /** Hotkeys: when multi-view is active and a last-clicked tile exists,
     *  run `fn` with that video as `vid`. Returns true if diverted.
     *  Single-video / inactive → false (zero side effects). */
    function omtInplayMvRunOnHotkeyTarget(fn) {
        if (!inplayMvActive) return false;
        const target = inplayMvHotkeyVid;
        if (!target || !target.isConnected) return false;
        if (target === vid) return false;
        omtInplayMvWithVideo(target, fn);
        return true;
    }

    function omtInplayMvBuildPanelHtml() {
        // Compact transport + speed only — no clock, kickoff, timeline, Source.
        return '' +
            '<div class="omt-tile-panel glass-panel omt-panel-size-small" data-omt-tile-panel="1">' +
            '  <div class="drag-handle omt-tile-handle" data-omt-tile-handle="1">' +
            '    <div class="drag-center-grip" aria-hidden="true">' + omtIcon('grip-horizontal', 14) + '</div>' +
            '  </div>' +
            '  <div class="controls-content">' +
            '    <div class="omt-transport-seg" role="group" aria-label="Tile transport">' +
            '      <button type="button" class="ctrl-btn omt-tile-skip" data-skip="-120">' +
            omtIcon('rewind', 16) + '<span class="omt-btn-label">2m</span></button>' +
            '      <button type="button" class="ctrl-btn omt-tile-skip" data-skip="-10">' +
            omtIcon('skip-back', 16) + '<span class="omt-btn-label">10s</span></button>' +
            '      <button type="button" class="ctrl-btn omt-tile-skip" data-skip="-2">' +
            omtIcon('skip-back', 15) + '<span class="omt-btn-label">2s</span></button>' +
            '      <span class="omt-seg-divider" aria-hidden="true"></span>' +
            '      <button type="button" class="ctrl-btn btn-frame omt-tile-frame" data-frame="-1">' +
            omtIcon('step-back', 16) + '</button>' +
            '      <button type="button" class="ctrl-btn btn-play omt-tile-play">' +
            omtIcon('play', 20) + '</button>' +
            '      <button type="button" class="ctrl-btn btn-frame omt-tile-frame" data-frame="1">' +
            omtIcon('step-forward', 16) + '</button>' +
            '      <span class="omt-seg-divider" aria-hidden="true"></span>' +
            '      <button type="button" class="ctrl-btn omt-tile-skip" data-skip="2">' +
            '<span class="omt-btn-label">2s</span>' + omtIcon('skip-forward', 14) + '</button>' +
            '      <button type="button" class="ctrl-btn omt-tile-skip" data-skip="10">' +
            '<span class="omt-btn-label">10s</span>' + omtIcon('skip-forward', 14) + '</button>' +
            '      <button type="button" class="ctrl-btn omt-tile-skip" data-skip="120">' +
            '<span class="omt-btn-label">2m</span>' + omtIcon('fast-forward', 14) + '</button>' +
            '    </div>' +
            '    <div class="omt-speed-row" role="group" aria-label="Tile speed">' +
            '      <button type="button" class="omt-speed-chip omt-tile-speed" data-speed="0.25">0.25x</button>' +
            '      <button type="button" class="omt-speed-chip omt-tile-speed" data-speed="0.5">0.5x</button>' +
            '      <button type="button" class="omt-speed-chip omt-tile-speed" data-speed="0.75">0.75x</button>' +
            '      <button type="button" class="omt-speed-chip omt-tile-speed is-active" data-speed="1.0">1x</button>' +
            '      <button type="button" class="omt-speed-chip omt-tile-speed" data-speed="1.25">1.25x</button>' +
            '      <button type="button" class="omt-speed-chip omt-tile-speed" data-speed="1.5">1.5x</button>' +
            '      <button type="button" class="omt-speed-chip omt-tile-speed" data-speed="2.0">2x</button>' +
            '    </div>' +
            '  </div>' +
            '</div>';
    }

    function omtInplayMvSyncPlayBtn(playBtn, videoEl) {
        if (!playBtn || !videoEl) return;
        const on = !videoEl.paused && !videoEl.ended;
        try {
            playBtn.innerHTML = on ? omtIcon('pause', 20) : omtIcon('play', 20);
            playBtn.classList.toggle('playing', on);
            playBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        } catch (_) {}
    }

    function omtInplayMvSyncSpeedChips(root, videoEl) {
        if (!root || !videoEl) return;
        const rate = (typeof closestSpeedRate === 'function')
            ? closestSpeedRate(videoEl.playbackRate || 1)
            : (videoEl.playbackRate || 1);
        root.querySelectorAll('.omt-tile-speed').forEach((chip) => {
            const chipRate = parseFloat(chip.getAttribute('data-speed'));
            const active = Math.abs(chipRate - rate) < 0.05;
            chip.classList.toggle('is-active', active);
            chip.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function omtInplayMvRemoveTile(videoEl) {
        const rec = inplayMvTiles.get(videoEl);
        if (!rec) return;
        try { if (rec.ac) rec.ac.abort(); } catch (_) {}
        try {
            if (rec.root && rec.root.parentNode) rec.root.parentNode.removeChild(rec.root);
        } catch (_) {}
        inplayMvTiles.delete(videoEl);
    }

    function omtInplayMvMountTile(videoEl) {
        if (!videoEl || inplayMvTiles.has(videoEl)) return;
        if (omtInplayMvIsPrimary(videoEl)) return; // primary keeps full #omt-root
        const shell = omtInplayMvFindShell(videoEl);
        if (!shell) return;

        const cs = getComputedStyle(shell);
        if (cs.position === 'static') {
            try { shell.style.position = 'relative'; } catch (_) {}
        }
        try { shell.style.setProperty('isolation', 'isolate'); } catch (_) {}

        const root = document.createElement('div');
        root.className = 'omt-tile-root omt-inplayip';
        root.setAttribute('data-omt-tile-root', '1');
        root.innerHTML = omtInplayMvBuildPanelHtml();
        shell.appendChild(root);

        const panel = root.querySelector('[data-omt-tile-panel]');
        const handle = root.querySelector('[data-omt-tile-handle]');
        const playBtn = root.querySelector('.omt-tile-play');
        const ac = typeof AbortController === 'function' ? new AbortController() : null;
        const sig = ac ? { signal: ac.signal } : undefined;

        const run = (fn) => {
            omtInplayMvSetHotkeyTarget(videoEl);
            omtInplayMvWithVideo(videoEl, fn);
        };

        root.querySelectorAll('.omt-tile-skip').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const sec = parseFloat(btn.getAttribute('data-skip'));
                if (!isFinite(sec)) return;
                run(() => saltarVideo(sec));
            }, sig);
        });
        root.querySelectorAll('.omt-tile-frame').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const dir = parseFloat(btn.getAttribute('data-frame'));
                run(() => { if (dir < 0) retrocederFrame(); else avancarFrame(); });
            }, sig);
        });
        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                run(() => togglePlay());
                omtInplayMvSyncPlayBtn(playBtn, videoEl);
            }, sig);
        }
        root.querySelectorAll('.omt-tile-speed').forEach((chip) => {
            chip.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const rate = chip.getAttribute('data-speed');
                run(() => applyPlaybackSpeed(rate));
                omtInplayMvSyncSpeedChips(root, videoEl);
            }, sig);
        });

        // Click / dblclick on this tile's video: control THIS video; set hotkey target.
        videoEl.addEventListener('click', (e) => {
            if (e.target !== videoEl) return;
            if (!videoEl.src && !videoEl.currentSrc && !videoEl.srcObject) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            omtInplayMvSetHotkeyTarget(videoEl);
            omtInplayMvWithVideo(videoEl, () => togglePlay());
            omtInplayMvSyncPlayBtn(playBtn, videoEl);
        }, { capture: true, signal: ac ? ac.signal : undefined });

        videoEl.addEventListener('play', () => omtInplayMvSyncPlayBtn(playBtn, videoEl), sig);
        videoEl.addEventListener('pause', () => omtInplayMvSyncPlayBtn(playBtn, videoEl), sig);
        videoEl.addEventListener('ratechange', () => omtInplayMvSyncSpeedChips(root, videoEl), sig);

        // Swallow host leak on tile panel (same as primary HUD).
        ['click', 'dblclick'].forEach((type) => {
            root.addEventListener(type, (e) => {
                if (e.target && e.target.closest && e.target.closest('button, input, select, .omt-tile-panel')) {
                    e.stopPropagation();
                }
            }, false);
        });

        if (panel && handle && typeof fazerArrastavel === 'function') {
            // Pass tile root so drag math stays inside this tile; mouseup on window
            // still ends the gesture (same release path as primary).
            fazerArrastavel(panel, handle, root);
        }

        omtInplayMvSyncPlayBtn(playBtn, videoEl);
        omtInplayMvSyncSpeedChips(root, videoEl);
        inplayMvTiles.set(videoEl, { root, panel, playBtn, ac });
    }

    function omtInplayMvTeardownTiles() {
        Array.from(inplayMvTiles.keys()).forEach(omtInplayMvRemoveTile);
    }

    function omtInplayMvUnhookPointer() {
        if (!inplayMvPointerHooked) return;
        try { document.removeEventListener('pointerdown', omtInplayMvOnPointerDown, true); } catch (_) {}
        inplayMvPointerHooked = false;
    }

    function omtInplayMvOnPointerDown(e) {
        if (!inplayMvActive) return;
        const t = e.target;
        if (!t || !t.closest) return;
        // Prefer an explicit tile video under the pointer.
        const tileRoot = t.closest('[data-omt-tile-root]');
        if (tileRoot) {
            for (const [v, rec] of inplayMvTiles) {
                if (rec.root === tileRoot) {
                    omtInplayMvSetHotkeyTarget(v);
                    return;
                }
            }
        }
        const v = t.closest && t.closest('video');
        if (v && omtInplayMvListVideos().includes(v)) {
            omtInplayMvSetHotkeyTarget(v);
            return;
        }
        // Primary HUD click → primary video.
        if (omtRoot && omtRoot.contains(t) && vid) {
            omtInplayMvSetHotkeyTarget(vid);
        }
    }

    function omtInplayMvHookPointer() {
        if (inplayMvPointerHooked) return;
        document.addEventListener('pointerdown', omtInplayMvOnPointerDown, true);
        inplayMvPointerHooked = true;
    }

    function omtInplayMvDeactivate() {
        if (!inplayMvActive && !inplayMvTiles.size) {
            inplayMvHotkeyVid = null;
            try { window.__omtInplayMvActive = false; } catch (_) {}
            return;
        }
        omtInplayMvBumpSync();
        omtInplayMvTeardownTiles();
        omtInplayMvUnhookPointer();
        inplayMvActive = false;
        inplayMvHotkeyVid = null;
        inplayMvLastVideoCount = 0;
        try {
            window.__omtInplayMvActive = false;
            window.__omtInplayMvHotkeyIndex = -1;
        } catch (_) {}
    }

    function omtInplayMvSync() {
        if (!(site && site.id === 'inplayip') || !omtRoot || !vid) {
            omtInplayMvDeactivate();
            return;
        }
        const videos = omtInplayMvListVideos();
        if (videos.length <= 1) {
            if (inplayMvActive || inplayMvTiles.size) omtInplayMvDeactivate();
            return;
        }

        omtInplayMvBumpSync();
        inplayMvActive = true;
        try { window.__omtInplayMvActive = true; } catch (_) {}
        omtInplayMvHookPointer();

        const live = new Set(videos);
        const gridChanged = videos.length !== inplayMvLastVideoCount;
        inplayMvLastVideoCount = videos.length;
        // Drop tiles whose video vanished.
        Array.from(inplayMvTiles.keys()).forEach((v) => {
            if (!live.has(v) || omtInplayMvIsPrimary(v)) omtInplayMvRemoveTile(v);
        });
        // Mount missing secondary tiles (cap 4 total videos → ≤3 secondaries).
        let mounted = 0;
        for (const v of videos) {
            if (omtInplayMvIsPrimary(v)) continue;
            if (mounted >= 3) break;
            omtInplayMvMountTile(v);
            mounted++;
        }
        // Grid size changed (2↔4): clear dragged left/top so panels stay visible
        // inside the new tile box (no per-frame work — only on count change).
        if (gridChanged) {
            inplayMvTiles.forEach((rec) => {
                const p = rec && rec.panel;
                if (!p || !p.style) return;
                try {
                    p.style.removeProperty('left');
                    p.style.removeProperty('top');
                    p.style.removeProperty('right');
                    p.style.removeProperty('bottom');
                    p.style.removeProperty('transform');
                } catch (_) {}
            });
        }
        if (!inplayMvHotkeyVid || !inplayMvHotkeyVid.isConnected) {
            omtInplayMvSetHotkeyTarget(vid);
        }
    }

    function omtInplayMvScheduleSync() {
        if (inplayMvSyncTimer) return;
        inplayMvSyncTimer = setTimeout(() => {
            inplayMvSyncTimer = null;
            try { omtInplayMvSync(); } catch (_) {}
        }, 80);
    }

    function omtInplayMvDisarm() {
        if (inplayMvArmMo) {
            try { inplayMvArmMo.disconnect(); } catch (_) {}
            inplayMvArmMo = null;
        }
        inplayMvArmHost = null;
        try { window.__omtInplayMvArmInstalled = false; } catch (_) {}
    }

    function omtInplayMvArm(host) {
        if (inplayMvArmMo || !host) return;
        inplayMvArmHost = host;
        inplayMvArmMo = new MutationObserver((mutations) => {
            // When already multi-view: resync on tile add/remove.
            if (inplayMvActive) {
                omtInplayMvScheduleSync();
                return;
            }
            // Inactive single-video: only wake when a VIDEO node is added.
            // Ignores VJS control-bar thrash so one-tile pages stay quiet.
            for (let i = 0; i < mutations.length; i++) {
                const nodes = mutations[i].addedNodes;
                if (!nodes || !nodes.length) continue;
                for (let j = 0; j < nodes.length; j++) {
                    const n = nodes[j];
                    if (!n) continue;
                    if (n.tagName === 'VIDEO') { omtInplayMvScheduleSync(); return; }
                    if (n.querySelector && n.querySelector('video')) {
                        omtInplayMvScheduleSync();
                        return;
                    }
                }
            }
        });
        // Subtree: true so nested tile shells are seen; the VIDEO-add gate
        // above keeps single-tile control-bar mutations from scheduling work.
        try {
            inplayMvArmMo.observe(host, { childList: true, subtree: true });
            try { window.__omtInplayMvArmInstalled = true; } catch (_) {}
        } catch (_) {
            inplayMvArmMo = null;
            inplayMvArmHost = null;
        }
    }

    /** Called once after InPlay HUD mounts. Single-video pages without a
     *  multi-view host install nothing. */
    function omtInplayMvOnHudReady() {
        if (!(site && site.id === 'inplayip') || !omtRoot) return;
        const videos = omtInplayMvListVideos();
        if (videos.length >= 2) {
            omtInplayMvSync();
            const host = document.querySelector('.players-container') ||
                (vid && vid.closest && vid.closest('.players-container')) ||
                document.body;
            omtInplayMvArm(host);
            return;
        }
        // Arm only when the known multi-view shell exists. Plain single-player
        // mocks (no .players-container) stay at zero extra observers.
        const host = document.querySelector('.players-container');
        if (host) omtInplayMvArm(host);
    }

    function omtInplayMvTeardown() {
        if (inplayMvSyncTimer) {
            clearTimeout(inplayMvSyncTimer);
            inplayMvSyncTimer = null;
        }
        omtInplayMvDisarm();
        omtInplayMvDeactivate();
    }

    try {
        window.__omtInplayMvForceSync = function () {
            try { omtInplayMvSync(); } catch (_) {}
        };
    } catch (_) {}
