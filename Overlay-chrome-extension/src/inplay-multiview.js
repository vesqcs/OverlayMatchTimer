/* InPlay multi-view (v2.3.2): full primary-identical HUD per secondary tile.
 *
 * Scope: UI layer only. Player/seek/playback helpers stay untouched —
 * tile actions briefly swap global `vid` via omtInplayMvWithVideo().
 * Each secondary tile reuses buildHTML(prefix) so the panel + bottom bar
 * match the primary tile. Independent match clock + kickoff state per tile
 * (video-time offsets; no shared kickoff1 globals).
 *
 * Single-video path: identical to 2.2.23 — no MutationObserver, no
 * tile roots, no hotkey divert. Multi-view arms only when
 * `.players-container` exists (or ≥2 videos already present).
 * Clock/bar updates: timeupdate only while multi-view active (no rAF).
 */
    let inplayMvActive = false;
    let inplayMvArmMo = null;
    let inplayMvArmHost = null;
    let inplayMvSyncTimer = null;
    let inplayMvHotkeyVid = null;
    let inplayMvPointerHooked = false;
    let inplayMvLastVideoCount = 0;
    let inplayMvTileSeq = 0;
    /** videoEl → tile record */
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

    function omtInplayMvRunOnHotkeyTarget(fn) {
        if (!inplayMvActive) return false;
        const target = inplayMvHotkeyVid;
        if (!target || !target.isConnected) return false;
        if (target === vid) return false;
        omtInplayMvWithVideo(target, fn);
        return true;
    }

    function omtInplayMvQ(rec, name) {
        if (!rec || !rec.root) return null;
        return rec.root.querySelector('#' + rec.prefix + name);
    }

    function omtInplayMvFmtTime(sec) {
        if (typeof formatarTempoCompacto === 'function') return formatarTempoCompacto(sec);
        const t = Math.max(0, Math.floor(Number(sec) || 0));
        return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
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

    function omtInplayMvSeekLive(videoEl) {
        if (!videoEl) return;
        const margin = (typeof OMT_LIVE_SAFE_MARGIN_S === 'number' && OMT_LIVE_SAFE_MARGIN_S > 0)
            ? OMT_LIVE_SAFE_MARGIN_S : 10;
        const edge = omtInplayMvEdgeSec(videoEl);
        if (!(edge > 0)) return;
        omtInplayMvWithVideo(videoEl, () => seekTo(Math.max(0, edge - margin)));
    }

    /* ---- Independent per-tile clock / kickoff (video-time, not PDT) ---- */
    function omtInplayMvPaintClock(rec) {
        if (!rec || !rec.timerAtivo || !rec.video) return;
        const timerUI = omtInplayMvQ(rec, 'match-timer');
        if (!timerUI) return;
        const tAtual = rec.video.currentTime || 0;
        const k1 = rec.kickoff1;
        const k2 = rec.kickoff2;
        const kC1 = rec.kickoffC1;
        const kC2 = rec.kickoffC2;
        let kickoffUsar = rec.offsetEmSegundos || 0;
        let baseUsar = rec.tempoBase || 0;
        if (kC2 != null && tAtual >= kC2) {
            kickoffUsar = kC2;
            baseUsar = (rec.customMinC2 || 105) * 60;
        } else if (kC1 != null && tAtual >= kC1) {
            kickoffUsar = kC1;
            baseUsar = (rec.customMinC1 || 90) * 60;
        } else if (k2 != null && tAtual >= k2) {
            kickoffUsar = k2;
            baseUsar = 45 * 60;
        } else if (k1 != null) {
            kickoffUsar = k1;
            baseUsar = 0;
        }
        if (k1 != null && tAtual < k1) {
            timerUI.innerText = 'Pre-Match';
            timerUI.style.color = '#ffcc00';
            return;
        }
        const totalSeconds = (tAtual - kickoffUsar) + baseUsar;
        timerUI.style.color = 'white';
        timerUI.innerText =
            String(Math.floor(totalSeconds / 60)).padStart(2, '0') + ':' +
            String(Math.floor(totalSeconds % 60)).padStart(2, '0');
    }

    function omtInplayMvSetKickoff(rec) {
        if (!rec || !rec.video) return;
        const halfEl = omtInplayMvQ(rec, 'omt-half-select');
        const parte = (halfEl && halfEl.value) || '1';
        let tempoBase = 0;
        if (parte === '2') tempoBase = 45 * 60;
        else if (parte === 'custom1') {
            const el = omtInplayMvQ(rec, 'omt-custom-minute-c1');
            tempoBase = (parseInt(el && el.value, 10) || 0) * 60;
            rec.customMinC1 = parseInt(el && el.value, 10) || 0;
        } else if (parte === 'custom2') {
            const el = omtInplayMvQ(rec, 'omt-custom-minute-c2');
            tempoBase = (parseInt(el && el.value, 10) || 0) * 60;
            rec.customMinC2 = parseInt(el && el.value, 10) || 0;
        }
        const offset = rec.video.currentTime || 0;
        rec.offsetEmSegundos = offset;
        rec.tempoBase = tempoBase;
        rec.timerAtivo = true;
        rec.previousHalf = parte;
        if (parte === '1') rec.kickoff1 = offset;
        else if (parte === '2') rec.kickoff2 = offset;
        else if (parte === 'custom1') rec.kickoffC1 = offset;
        else if (parte === 'custom2') rec.kickoffC2 = offset;

        const wrap = omtInplayMvQ(rec, 'match-timer-wrap');
        const timerUI = omtInplayMvQ(rec, 'match-timer');
        if (wrap) wrap.style.display = 'flex';
        if (timerUI) timerUI.style.display = 'block';
        try { rec.root.classList.add('omt-timer-on'); } catch (_) {}
        const kickBtn = omtInplayMvQ(rec, 'omt-btn-set-kickoff');
        if (kickBtn) kickBtn.classList.add('kickoff-set');
        omtInplayMvPaintClock(rec);
        if (typeof mostrarOSD === 'function') {
            omtInplayMvWithVideo(rec.video, () => mostrarOSD('Timer Synced'));
        }
    }

    function omtInplayMvClearKickoff(rec) {
        if (!rec) return;
        rec.timerAtivo = false;
        rec.offsetEmSegundos = 0;
        rec.tempoBase = 0;
        rec.kickoff1 = rec.kickoff2 = rec.kickoffC1 = rec.kickoffC2 = null;
        rec.previousHalf = '1';
        const wrap = omtInplayMvQ(rec, 'match-timer-wrap');
        const timerUI = omtInplayMvQ(rec, 'match-timer');
        if (wrap) wrap.style.display = 'none';
        if (timerUI) {
            timerUI.style.display = 'none';
            timerUI.innerText = '00:00';
        }
        try { rec.root.classList.remove('omt-timer-on'); } catch (_) {}
        const kickBtn = omtInplayMvQ(rec, 'omt-btn-set-kickoff');
        if (kickBtn) kickBtn.classList.remove('kickoff-set');
        const half = omtInplayMvQ(rec, 'omt-half-select');
        if (half) half.value = '1';
        const c1 = omtInplayMvQ(rec, 'omt-custom-c1');
        const c2 = omtInplayMvQ(rec, 'omt-custom-c2');
        if (c1) c1.style.display = 'none';
        if (c2) c2.style.display = 'none';
    }

    function omtInplayMvNudgeKickoff(rec, deltaSec) {
        if (!rec || !rec.timerAtivo || !deltaSec) return;
        const apply = (v) => (v == null ? v : Number(v) + deltaSec);
        const parte = rec.previousHalf || '1';
        if (parte === '1') rec.kickoff1 = apply(rec.kickoff1);
        else if (parte === '2') rec.kickoff2 = apply(rec.kickoff2);
        else if (parte === 'custom1') rec.kickoffC1 = apply(rec.kickoffC1);
        else if (parte === 'custom2') rec.kickoffC2 = apply(rec.kickoffC2);
        rec.offsetEmSegundos = apply(rec.offsetEmSegundos);
        omtInplayMvPaintClock(rec);
    }

    function omtInplayMvPaintBar(rec, force) {
        if (!rec || !rec.video) return;
        const videoEl = rec.video;
        const slider = omtInplayMvQ(rec, 'omt-timeline-slider');
        const curEl = omtInplayMvQ(rec, 'omt-v-time-current');
        const durEl = omtInplayMvQ(rec, 'omt-v-time-duration');
        const liveBtn = omtInplayMvQ(rec, 'omt-timeline-live-indicator');
        const liveDelay = omtInplayMvQ(rec, 'omt-timeline-live-delay');
        const liveChip = omtInplayMvQ(rec, 'omt-timeline-live-chip');
        const postTimes = omtInplayMvQ(rec, 'omt-timeline-post-times');
        const bar = omtInplayMvQ(rec, 'omt-timeline-bar');
        const barPlay = omtInplayMvQ(rec, 'omt-timeline-play-btn');
        const panelLive = omtInplayMvQ(rec, 'omt-live-btn');
        const edge = omtInplayMvEdgeSec(videoEl);
        const playhead = videoEl.currentTime || 0;
        if (slider && !rec.dragging) {
            if (edge > 0) {
                slider.min = '0';
                slider.max = String(edge);
                slider.disabled = false;
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

        const margin = (typeof OMT_LIVE_SAFE_MARGIN_S === 'number' && OMT_LIVE_SAFE_MARGIN_S > 0)
            ? OMT_LIVE_SAFE_MARGIN_S : 10;
        const delay = edge > 0 ? Math.max(0, edge - playhead) : 0;
        const atLive = edge > 0 && delay <= margin + 5;
        if (bar) bar.classList.toggle('omt-at-live', atLive);
        if (panelLive) panelLive.classList.toggle('is-live', atLive);
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
        const on = !videoEl.paused && !videoEl.ended;
        const playBtn = omtInplayMvQ(rec, 'omt-btn-play');
        [playBtn, barPlay].forEach((btn) => {
            if (!btn) return;
            try {
                const size = btn === barPlay ? 16 : 22;
                btn.innerHTML = on ? omtIcon('pause', size) : omtIcon('play', size);
                btn.classList.toggle('playing', on);
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            } catch (_) {}
        });
        omtInplayMvPaintClock(rec);
    }

    function omtInplayMvSyncSpeed(rec) {
        if (!rec || !rec.video) return;
        const rate = (typeof closestSpeedRate === 'function')
            ? closestSpeedRate(rec.video.playbackRate || 1)
            : (rec.video.playbackRate || 1);
        rec.root.querySelectorAll('.omt-tile-speed').forEach((chip) => {
            const chipRate = parseFloat(chip.getAttribute('data-speed'));
            const active = Math.abs(chipRate - rate) < 0.05;
            chip.classList.toggle('is-active', active);
            chip.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        const sel = omtInplayMvQ(rec, 'omt-speed-select');
        if (sel && typeof OMT_SPEED_SELECT_VALUES !== 'undefined') {
            sel.value = OMT_SPEED_SELECT_VALUES[rate] || String(rate);
        } else if (sel) {
            sel.value = String(rate);
        }
    }

    function omtInplayMvSyncVol(rec) {
        if (!rec || !rec.video) return;
        const muted = !!(rec.video.muted || rec.video.volume === 0);
        const vol = muted ? 0 : (rec.video.volume || 0);
        const panelRange = omtInplayMvQ(rec, 'omt-volume-range');
        const barRange = omtInplayMvQ(rec, 'omt-timeline-vol-range');
        if (panelRange) panelRange.value = String(vol);
        if (barRange) barRange.value = String(vol);
        const name = vol === 0 ? 'volume-x' : vol < 0.5 ? 'volume-1' : 'volume-2';
        const panelBtn = omtInplayMvQ(rec, 'omt-volume-icon-btn');
        const barBtn = omtInplayMvQ(rec, 'omt-timeline-vol-btn');
        if (panelBtn) panelBtn.innerHTML = omtIcon(name, 15);
        if (barBtn) {
            barBtn.innerHTML = omtIcon(name, 16);
            barBtn.setAttribute('aria-label', vol === 0 ? 'Unmute' : 'Mute');
        }
    }

    function omtInplayMvToggleMore(rec) {
        const more = omtInplayMvQ(rec, 'omt-more-panel');
        const btn = omtInplayMvQ(rec, 'omt-more-toggle');
        const panel = omtInplayMvQ(rec, 'omt-controls-panel');
        if (!more || !btn) return;
        const open = !more.classList.contains('is-open');
        more.classList.toggle('is-open', open);
        more.setAttribute('aria-hidden', open ? 'false' : 'true');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (panel) panel.classList.toggle('omt-more-open', open);
        const coll = btn.querySelector('.omt-more-icon-collapsed');
        const exp = btn.querySelector('.omt-more-icon-expanded');
        if (coll) coll.hidden = open;
        if (exp) exp.hidden = !open;
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
        if (omtInplayMvIsPrimary(videoEl)) return;
        if (typeof buildHTML !== 'function') return;
        const shell = omtInplayMvFindShell(videoEl);
        if (!shell) return;

        const cs = getComputedStyle(shell);
        if (cs.position === 'static') {
            try { shell.style.position = 'relative'; } catch (_) {}
        }
        try { shell.style.setProperty('isolation', 'isolate'); } catch (_) {}

        inplayMvTileSeq += 1;
        const prefix = 'omt-t' + inplayMvTileSeq + '-';
        const root = document.createElement('div');
        root.className = 'omt-tile-root omt-inplayip';
        root.setAttribute('data-omt-tile-root', '1');
        root.innerHTML = buildHTML(prefix);
        // Hide Examino/Shuttle blocks on InPlay tiles (same as primary InPlay).
        const examino = root.querySelector('#' + prefix + 'omt-examino-settings');
        if (examino) examino.style.display = 'none';
        shell.appendChild(root);

        // InPlay primary never uses omt-compact (Examino-only). Shrink only when
        // the tile is genuinely tiny — otherwise min(600, 100%-24) matches primary.
        const sw = shell.clientWidth || 0;
        const sh = shell.clientHeight || 0;
        if (sw < 520 || sh < 300) root.classList.add('omt-compact');

        const ac = typeof AbortController === 'function' ? new AbortController() : null;
        const sig = ac ? { signal: ac.signal } : undefined;
        const rec = {
            root, prefix, video: videoEl, ac,
            dragging: false, _progPct: null, _lastVol: 1,
            timerAtivo: false, offsetEmSegundos: 0, tempoBase: 0,
            kickoff1: null, kickoff2: null, kickoffC1: null, kickoffC2: null,
            previousHalf: '1', customMinC1: 90, customMinC2: 105
        };

        const run = (fn) => {
            omtInplayMvSetHotkeyTarget(videoEl);
            omtInplayMvWithVideo(videoEl, fn);
        };

        // Transport / frames / play / speed (same controls as primary).
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
        const playBtn = omtInplayMvQ(rec, 'omt-btn-play');
        const barPlay = omtInplayMvQ(rec, 'omt-timeline-play-btn');
        [playBtn, barPlay].forEach((btn) => {
            if (!btn) return;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                run(() => togglePlay());
                omtInplayMvPaintBar(rec, true);
            }, sig);
        });
        root.querySelectorAll('.omt-tile-speed').forEach((chip) => {
            chip.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                run(() => applyPlaybackSpeed(chip.getAttribute('data-speed')));
                omtInplayMvSyncSpeed(rec);
            }, sig);
        });
        const speedSel = omtInplayMvQ(rec, 'omt-speed-select');
        if (speedSel) {
            speedSel.addEventListener('change', () => {
                run(() => applyPlaybackSpeed(speedSel.value));
                omtInplayMvSyncSpeed(rec);
                try { speedSel.blur(); } catch (_) {}
            }, sig);
        }

        // LIVE (panel + bar)
        const panelLive = omtInplayMvQ(rec, 'omt-live-btn');
        const barLive = omtInplayMvQ(rec, 'omt-timeline-live-indicator');
        [panelLive, barLive].forEach((btn) => {
            if (!btn) return;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                omtInplayMvSetHotkeyTarget(videoEl);
                omtInplayMvSeekLive(videoEl);
                omtInplayMvPaintBar(rec, true);
            }, sig);
        });

        // Volume (panel + bar) — tile-local, no primary syncVolume side effects.
        const applyVol = (raw) => {
            const v = Math.max(0, Math.min(1, parseFloat(raw)));
            if (!isFinite(v)) return;
            videoEl.volume = v;
            videoEl.muted = v <= 0;
            if (v > 0) rec._lastVol = v;
            omtInplayMvSyncVol(rec);
        };
        const panelVol = omtInplayMvQ(rec, 'omt-volume-range');
        const barVol = omtInplayMvQ(rec, 'omt-timeline-vol-range');
        if (panelVol) panelVol.addEventListener('input', () => applyVol(panelVol.value), sig);
        if (barVol) barVol.addEventListener('input', () => applyVol(barVol.value), sig);
        const toggleVol = () => {
            if (videoEl.volume > 0 && !videoEl.muted) {
                rec._lastVol = videoEl.volume || 1;
                videoEl.volume = 0;
                videoEl.muted = true;
            } else {
                videoEl.volume = rec._lastVol > 0 ? rec._lastVol : 1;
                videoEl.muted = false;
            }
            omtInplayMvSyncVol(rec);
        };
        const panelVolBtn = omtInplayMvQ(rec, 'omt-volume-icon-btn');
        const barVolBtn = omtInplayMvQ(rec, 'omt-timeline-vol-btn');
        if (panelVolBtn) panelVolBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation(); toggleVol();
        }, sig);
        if (barVolBtn) barVolBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation(); toggleVol();
        }, sig);

        // Scrubber
        const slider = omtInplayMvQ(rec, 'omt-timeline-slider');
        if (slider) {
            slider.addEventListener('input', () => {
                rec.dragging = true;
                const min = parseFloat(slider.min) || 0;
                const max = parseFloat(slider.max) || 0;
                const val = parseFloat(slider.value) || 0;
                const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
                slider.style.setProperty('--omt-progress', Math.max(0, Math.min(100, pct)) + '%');
                const cur = omtInplayMvQ(rec, 'omt-v-time-current');
                if (cur) cur.textContent = omtInplayMvFmtTime(val);
            }, sig);
            slider.addEventListener('change', () => {
                const t = parseFloat(slider.value);
                rec.dragging = false;
                if (isFinite(t)) run(() => seekTo(t));
                try { slider.blur(); } catch (_) {}
                omtInplayMvPaintBar(rec, true);
            }, sig);
        }

        // Kickoff / clear / nudge / half / more
        const kickBtn = omtInplayMvQ(rec, 'omt-btn-set-kickoff');
        if (kickBtn) kickBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            omtInplayMvSetHotkeyTarget(videoEl);
            omtInplayMvSetKickoff(rec);
        }, sig);
        const clearBtn = omtInplayMvQ(rec, 'omt-btn-clear-timer');
        if (clearBtn) clearBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            omtInplayMvClearKickoff(rec);
        }, sig);
        root.querySelectorAll('.omt-tile-nudge').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                const d = parseFloat(btn.getAttribute('data-nudge'));
                if (isFinite(d)) omtInplayMvNudgeKickoff(rec, d);
            }, sig);
        });
        const half = omtInplayMvQ(rec, 'omt-half-select');
        if (half) {
            half.addEventListener('change', () => {
                const v = half.value;
                const c1 = omtInplayMvQ(rec, 'omt-custom-c1');
                const c2 = omtInplayMvQ(rec, 'omt-custom-c2');
                if (c1) c1.style.display = (v === 'custom1') ? 'inline-flex' : 'none';
                if (c2) c2.style.display = (v === 'custom2') ? 'inline-flex' : 'none';
                rec.previousHalf = v;
                try { half.blur(); } catch (_) {}
            }, sig);
        }
        const moreBtn = omtInplayMvQ(rec, 'omt-more-toggle');
        if (moreBtn) moreBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            omtInplayMvToggleMore(rec);
        }, sig);

        const fsBtn = omtInplayMvQ(rec, 'omt-btn-fullscreen');
        if (fsBtn && typeof toggleFullScreen === 'function') {
            fsBtn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                run(() => toggleFullScreen());
            }, sig);
        }

        // Video surface click → this tile only.
        videoEl.addEventListener('click', (e) => {
            if (e.target !== videoEl) return;
            if (!videoEl.src && !videoEl.currentSrc && !videoEl.srcObject) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            omtInplayMvSetHotkeyTarget(videoEl);
            omtInplayMvWithVideo(videoEl, () => togglePlay());
            omtInplayMvPaintBar(rec, true);
        }, { capture: true, signal: ac ? ac.signal : undefined });

        videoEl.addEventListener('play', () => omtInplayMvPaintBar(rec, false), sig);
        videoEl.addEventListener('pause', () => omtInplayMvPaintBar(rec, false), sig);
        videoEl.addEventListener('ratechange', () => omtInplayMvSyncSpeed(rec), sig);
        videoEl.addEventListener('timeupdate', () => omtInplayMvPaintBar(rec, false), sig);
        videoEl.addEventListener('loadedmetadata', () => omtInplayMvPaintBar(rec, true), sig);
        videoEl.addEventListener('durationchange', () => omtInplayMvPaintBar(rec, true), sig);
        videoEl.addEventListener('volumechange', () => omtInplayMvSyncVol(rec), sig);
        videoEl.addEventListener('seeked', () => omtInplayMvPaintBar(rec, true), sig);

        ['click', 'dblclick'].forEach((type) => {
            root.addEventListener(type, (e) => {
                if (e.target && e.target.closest &&
                    e.target.closest('button, input, select, .omt-controls-panel, .omt-timeline-bar, .omt-match-timer-wrap')) {
                    e.stopPropagation();
                }
            }, false);
        });

        const panel = omtInplayMvQ(rec, 'omt-controls-panel');
        const handle = omtInplayMvQ(rec, 'controls-handle');
        if (panel && handle && typeof fazerArrastavel === 'function') {
            fazerArrastavel(panel, handle, root);
        }

        omtInplayMvSyncSpeed(rec);
        omtInplayMvSyncVol(rec);
        omtInplayMvPaintBar(rec, true);
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
        Array.from(inplayMvTiles.keys()).forEach((v) => {
            if (!live.has(v) || omtInplayMvIsPrimary(v)) omtInplayMvRemoveTile(v);
        });
        let mounted = 0;
        for (const v of videos) {
            if (omtInplayMvIsPrimary(v)) continue;
            if (mounted >= 3) break;
            omtInplayMvMountTile(v);
            mounted++;
        }
        if (gridChanged) {
            inplayMvTiles.forEach((rec) => {
                const p = omtInplayMvQ(rec, 'omt-controls-panel');
                if (!p || !p.style) return;
                try {
                    p.style.removeProperty('left');
                    p.style.removeProperty('top');
                    p.style.removeProperty('right');
                    p.style.removeProperty('bottom');
                    p.style.removeProperty('transform');
                } catch (_) {}
                const shell = rec.root && rec.root.parentElement;
                if (shell) {
                    const sw = shell.clientWidth || 0;
                    const sh = shell.clientHeight || 0;
                    rec.root.classList.toggle('omt-compact', sw < 520 || sh < 300);
                }
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
            if (inplayMvActive) {
                omtInplayMvScheduleSync();
                return;
            }
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
        try {
            inplayMvArmMo.observe(host, { childList: true, subtree: true });
            try { window.__omtInplayMvArmInstalled = true; } catch (_) {}
        } catch (_) {
            inplayMvArmMo = null;
            inplayMvArmHost = null;
        }
    }

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
