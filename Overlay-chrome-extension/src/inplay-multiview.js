/* InPlay multi-view (v2.3.0 panels + v2.3.1 bottom bars).
 *
 * Scope: UI layer only. Player/seek/playback helpers stay untouched —
 * tile actions briefly swap global `vid` via omtInplayMvWithVideo().
 * v2.3.1: each secondary tile also gets an OMT bottom bar (scrubber,
 * mute/volume, LIVE, time readout) bound to that tile's video via
 * timeupdate (no rAF). NO per-tile clock/kickoff (deferred to 2.3.2).
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
        // Compact transport + speed + bottom bar — no clock/kickoff/Source.
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
            '</div>' +
            // v2.3.1 bottom bar — classes only (no duplicate ids).
            '<div class="omt-timeline-bar omt-tile-bar" data-omt-tile-bar="1">' +
            '  <div class="omt-timeline-track">' +
            '    <input type="range" class="timeline-slider omt-tile-slider" min="0" max="100" value="0" step="0.01" aria-label="Tile timeline">' +
            '  </div>' +
            '  <div class="omt-timeline-chrome-row">' +
            '    <div class="omt-timeline-chrome-left">' +
            '      <button type="button" class="omt-timeline-play-btn omt-tile-bar-play" aria-label="Play" aria-pressed="false">' +
            omtIcon('play', 16) + '</button>' +
            '      <button type="button" class="omt-timeline-vol-btn omt-tile-vol-btn" aria-label="Mute">' +
            omtIcon('volume-2', 16) + '</button>' +
            '      <input type="range" class="omt-timeline-vol-range omt-tile-vol-range" min="0" max="1" step="0.05" value="1" aria-label="Volume">' +
            '      <div class="omt-timeline-times" data-omt-time-mode="post">' +
            '        <button type="button" class="omt-timeline-live-indicator omt-tile-live-btn" hidden aria-label="Go to live">' +
            '          <span class="omt-timeline-live-delay omt-tile-live-delay">-0:00</span>' +
            '          <span class="omt-timeline-live-chip omt-tile-live-chip" hidden>LIVE</span>' +
            '        </button>' +
            '        <div class="omt-timeline-post-times omt-tile-post-times">' +
            '          <span class="omt-time-text omt-tile-time-cur">0:00</span>' +
            '          <span class="omt-time-sep" aria-hidden="true">/</span>' +
            '          <span class="omt-time-text omt-tile-time-dur">0:00</span>' +
            '        </div>' +
            '      </div>' +
            '    </div>' +
            '    <div class="omt-timeline-chrome-right">' +
            '      <button type="button" class="omt-timeline-fs-btn omt-tile-fs-btn" aria-label="Enter fullscreen" aria-pressed="false">' +
            omtIcon('maximize', 16) + '</button>' +
            '    </div>' +
            '  </div>' +
            '</div>';
    }

    function omtInplayMvFmtTime(sec) {
        if (typeof formatarTempoCompacto === 'function') return formatarTempoCompacto(sec);
        const t = Math.max(0, Math.floor(Number(sec) || 0));
        const m = Math.floor(t / 60);
        const s = t % 60;
        return m + ':' + String(s).padStart(2, '0');
    }

    function omtInplayMvFmtDelay(sec) {
        if (typeof formatarAtrasoLive === 'function') return formatarAtrasoLive(sec);
        const d = Math.max(0, Math.floor(Number(sec) || 0));
        return '-' + Math.floor(d / 60) + ':' + String(d % 60).padStart(2, '0');
    }

    function omtInplayMvEdgeSec(videoEl) {
        try {
            if (videoEl.seekable && videoEl.seekable.length > 0) {
                return videoEl.seekable.end(videoEl.seekable.length - 1);
            }
        } catch (_) {}
        if (videoEl.duration && isFinite(videoEl.duration)) return videoEl.duration;
        return 0;
    }

    function omtInplayMvPaintBar(rec, videoEl, force) {
        if (!rec || !videoEl) return;
        const slider = rec.slider;
        const curEl = rec.timeCur;
        const durEl = rec.timeDur;
        const liveBtn = rec.liveBtn;
        const liveDelay = rec.liveDelay;
        const liveChip = rec.liveChip;
        const postTimes = rec.postTimes;
        const bar = rec.bar;
        const edge = omtInplayMvEdgeSec(videoEl);
        const playhead = videoEl.currentTime || 0;
        if (slider && !rec.dragging) {
            if (edge > 0) {
                if (parseFloat(slider.max) !== edge) {
                    slider.min = '0';
                    slider.max = String(edge);
                    slider.disabled = false;
                }
                slider.value = String(Math.max(0, Math.min(edge, playhead)));
            }
            const min = parseFloat(slider.min) || 0;
            const max = parseFloat(slider.max) || 0;
            const val = parseFloat(slider.value) || 0;
            const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
            const rounded = Math.round(pct * 10) / 10;
            if (force || rec._progPct !== rounded) {
                rec._progPct = rounded;
                slider.style.setProperty('--omt-progress', Math.max(0, Math.min(100, rounded)) + '%');
            }
        }
        if (curEl) curEl.textContent = omtInplayMvFmtTime(playhead);
        if (durEl) durEl.textContent = omtInplayMvFmtTime(edge > 0 ? edge : (videoEl.duration || 0));

        // LIVE vs POST chrome — cheap threshold, no primary-panel side effects.
        const margin = (typeof OMT_LIVE_SAFE_MARGIN_S === 'number' && OMT_LIVE_SAFE_MARGIN_S > 0)
            ? OMT_LIVE_SAFE_MARGIN_S : 10;
        const delay = edge > 0 ? Math.max(0, edge - playhead) : 0;
        const atLive = edge > 0 && delay <= margin + 5;
        if (bar) bar.classList.toggle('omt-at-live', atLive);
        if (liveBtn) {
            if (edge > 0 && delay > 0.5) {
                liveBtn.hidden = false;
                if (liveDelay) liveDelay.textContent = omtInplayMvFmtDelay(delay);
                if (liveChip) liveChip.hidden = !atLive;
                if (postTimes) postTimes.hidden = atLive;
            } else {
                liveBtn.hidden = true;
                if (postTimes) postTimes.hidden = false;
            }
        }
        if (rec.barPlay) {
            const on = !videoEl.paused && !videoEl.ended;
            try {
                rec.barPlay.innerHTML = on ? omtIcon('pause', 16) : omtIcon('play', 16);
                rec.barPlay.classList.toggle('playing', on);
                rec.barPlay.setAttribute('aria-pressed', on ? 'true' : 'false');
            } catch (_) {}
        }
    }

    function omtInplayMvSyncTileVol(rec, videoEl) {
        if (!rec || !videoEl) return;
        const muted = !!(videoEl.muted || videoEl.volume === 0);
        const vol = muted ? 0 : (videoEl.volume || 0);
        if (rec.volRange) rec.volRange.value = String(vol);
        if (rec.volBtn) {
            const name = vol === 0 ? 'volume-x' : vol < 0.5 ? 'volume-1' : 'volume-2';
            try {
                rec.volBtn.innerHTML = omtIcon(name, 16);
                rec.volBtn.setAttribute('aria-label', vol === 0 ? 'Unmute' : 'Mute');
                rec.volBtn.setAttribute('aria-pressed', vol === 0 ? 'true' : 'false');
            } catch (_) {}
        }
    }

    function omtInplayMvSeekLive(videoEl) {
        if (!videoEl) return;
        const margin = (typeof OMT_LIVE_SAFE_MARGIN_S === 'number' && OMT_LIVE_SAFE_MARGIN_S > 0)
            ? OMT_LIVE_SAFE_MARGIN_S : 10;
        const edge = omtInplayMvEdgeSec(videoEl);
        if (!(edge > 0)) return;
        const target = Math.max(0, edge - margin);
        omtInplayMvWithVideo(videoEl, () => seekTo(target));
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
        const bar = root.querySelector('[data-omt-tile-bar]');
        const slider = root.querySelector('.omt-tile-slider');
        const barPlay = root.querySelector('.omt-tile-bar-play');
        const volBtn = root.querySelector('.omt-tile-vol-btn');
        const volRange = root.querySelector('.omt-tile-vol-range');
        const liveBtn = root.querySelector('.omt-tile-live-btn');
        const liveDelay = root.querySelector('.omt-tile-live-delay');
        const liveChip = root.querySelector('.omt-tile-live-chip');
        const postTimes = root.querySelector('.omt-tile-post-times');
        const timeCur = root.querySelector('.omt-tile-time-cur');
        const timeDur = root.querySelector('.omt-tile-time-dur');
        const fsBtn = root.querySelector('.omt-tile-fs-btn');
        const ac = typeof AbortController === 'function' ? new AbortController() : null;
        const sig = ac ? { signal: ac.signal } : undefined;

        const rec = {
            root, panel, playBtn, ac, bar, slider, barPlay, volBtn, volRange,
            liveBtn, liveDelay, liveChip, postTimes, timeCur, timeDur, fsBtn,
            dragging: false, _progPct: null, _lastVol: 1
        };

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
                omtInplayMvPaintBar(rec, videoEl, true);
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

        // ---- v2.3.1 bottom bar (this tile only) ----
        if (barPlay) {
            barPlay.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                run(() => togglePlay());
                omtInplayMvSyncPlayBtn(playBtn, videoEl);
                omtInplayMvPaintBar(rec, videoEl, true);
            }, sig);
        }
        if (slider) {
            slider.addEventListener('input', () => {
                rec.dragging = true;
                const min = parseFloat(slider.min) || 0;
                const max = parseFloat(slider.max) || 0;
                const val = parseFloat(slider.value) || 0;
                const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
                slider.style.setProperty('--omt-progress', Math.max(0, Math.min(100, pct)) + '%');
                if (timeCur) timeCur.textContent = omtInplayMvFmtTime(val);
            }, sig);
            slider.addEventListener('change', () => {
                const t = parseFloat(slider.value);
                rec.dragging = false;
                if (isFinite(t)) run(() => seekTo(t));
                try { slider.blur(); } catch (_) {}
                omtInplayMvPaintBar(rec, videoEl, true);
            }, sig);
        }
        if (volRange) {
            volRange.addEventListener('input', () => {
                const v = Math.max(0, Math.min(1, parseFloat(volRange.value)));
                if (!isFinite(v)) return;
                videoEl.volume = v;
                videoEl.muted = v <= 0;
                if (v > 0) rec._lastVol = v;
                omtInplayMvSyncTileVol(rec, videoEl);
            }, sig);
        }
        if (volBtn) {
            volBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (videoEl.volume > 0 && !videoEl.muted) {
                    rec._lastVol = videoEl.volume || 1;
                    videoEl.volume = 0;
                    videoEl.muted = true;
                } else {
                    videoEl.volume = rec._lastVol > 0 ? rec._lastVol : 1;
                    videoEl.muted = false;
                }
                omtInplayMvSyncTileVol(rec, videoEl);
            }, sig);
        }
        if (liveBtn) {
            liveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                omtInplayMvSetHotkeyTarget(videoEl);
                omtInplayMvSeekLive(videoEl);
                omtInplayMvPaintBar(rec, videoEl, true);
            }, sig);
        }
        if (fsBtn && typeof toggleFullScreen === 'function') {
            fsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                run(() => toggleFullScreen());
            }, sig);
        }

        // Click on this tile's video: control THIS video; set hotkey target.
        videoEl.addEventListener('click', (e) => {
            if (e.target !== videoEl) return;
            if (!videoEl.src && !videoEl.currentSrc && !videoEl.srcObject) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            omtInplayMvSetHotkeyTarget(videoEl);
            omtInplayMvWithVideo(videoEl, () => togglePlay());
            omtInplayMvSyncPlayBtn(playBtn, videoEl);
            omtInplayMvPaintBar(rec, videoEl, true);
        }, { capture: true, signal: ac ? ac.signal : undefined });

        videoEl.addEventListener('play', () => {
            omtInplayMvSyncPlayBtn(playBtn, videoEl);
            omtInplayMvPaintBar(rec, videoEl, false);
        }, sig);
        videoEl.addEventListener('pause', () => {
            omtInplayMvSyncPlayBtn(playBtn, videoEl);
            omtInplayMvPaintBar(rec, videoEl, false);
        }, sig);
        videoEl.addEventListener('ratechange', () => omtInplayMvSyncSpeedChips(root, videoEl), sig);
        // Cheap bar updates — timeupdate only (no rAF / no polling).
        videoEl.addEventListener('timeupdate', () => omtInplayMvPaintBar(rec, videoEl, false), sig);
        videoEl.addEventListener('loadedmetadata', () => omtInplayMvPaintBar(rec, videoEl, true), sig);
        videoEl.addEventListener('durationchange', () => omtInplayMvPaintBar(rec, videoEl, true), sig);
        videoEl.addEventListener('volumechange', () => omtInplayMvSyncTileVol(rec, videoEl), sig);
        videoEl.addEventListener('seeked', () => omtInplayMvPaintBar(rec, videoEl, true), sig);

        // Swallow host leak on tile panel + bar (same as primary HUD).
        ['click', 'dblclick'].forEach((type) => {
            root.addEventListener(type, (e) => {
                if (e.target && e.target.closest &&
                    e.target.closest('button, input, select, .omt-tile-panel, .omt-tile-bar')) {
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
        omtInplayMvSyncTileVol(rec, videoEl);
        omtInplayMvPaintBar(rec, videoEl, true);
        inplayMvTiles.set(videoEl, rec);
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
