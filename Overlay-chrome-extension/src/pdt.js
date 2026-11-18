/* Program Date Time helpers and timeline slider metadata. */
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

    /** Compact player time for POST right-side slot (e.g. 34:12 or 1:52:40). */
    function formatarTempoCompacto(segundos) {
        if (isNaN(segundos) || !isFinite(segundos) || segundos < 0) segundos = 0;
        const total = Math.floor(segundos);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) {
            return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        }
        return m + ':' + String(s).padStart(2, '0');
    }

    /**
     * Live delay behind the edge: -0:12 / -1:05 / -1:02:10
     * (compact mm:ss so the edge advance is easy to watch).
     */
    function formatarAtrasoLive(delaySec) {
        const d = Math.max(0, Math.floor(Number(delaySec) || 0));
        const h = Math.floor(d / 3600);
        const m = Math.floor((d % 3600) / 60);
        const s = d % 60;
        if (h > 0) {
            return '-' + h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        }
        return '-' + m + ':' + String(s).padStart(2, '0');
    }

    /** LIVE timeline mode (delay / LIVE chip) vs POST (current / duration). */
    function omtIsTimelineLiveMode() {
        if (!omtRoot || !site) return false;
        if (site.id === 'local' || omtRoot.classList.contains('omt-local')) return false;
        if (site.id === 'examino') {
            try {
                if (examinoManualSourceChoice === 'VOD') return false;
                if (typeof detectCurrentSource === 'function') {
                    const src = detectCurrentSource();
                    if (src === 'VOD') return false;
                } else if (/\/play\/vod\b/i.test(location.pathname || '')) {
                    return false;
                }
            } catch (_) {}
        }
        return true;
    }

    function omtTimelinePlayheadSec() {
        if (isDraggingTimeline && timelineSlider) {
            const v = parseFloat(timelineSlider.value);
            return isFinite(v) ? v : 0;
        }
        return vid ? (vid.currentTime || 0) : 0;
    }

    function omtTimelineLiveEdgeSec() {
        if (!vid) return 0;
        try {
            if (vid.seekable && vid.seekable.length > 0) {
                return vid.seekable.end(vid.seekable.length - 1);
            }
        } catch (_) {}
        if (vid.duration && isFinite(vid.duration)) return vid.duration;
        const mediaDuration = site && typeof site.effectiveDuration === 'function'
            ? site.effectiveDuration(vid) : NaN;
        return (mediaDuration && isFinite(mediaDuration)) ? mediaDuration : 0;
    }

    /** HLS/VHS target duration when known (seconds); null otherwise. */
    function omtHlsTargetDurationSec() {
        try {
            if (hlsInstance && hlsInstance.levels && hlsInstance.currentLevel >= 0) {
                const details = hlsInstance.levels[hlsInstance.currentLevel] &&
                    hlsInstance.levels[hlsInstance.currentLevel].details;
                const td = details && Number(details.targetduration);
                if (td > 0 && isFinite(td)) return td;
            }
        } catch (_) {}
        try {
            if (hlsInstance && hlsInstance.playlists && typeof hlsInstance.playlists.media === 'function') {
                const media = hlsInstance.playlists.media();
                const td = media && Number(media.targetDuration || media.targetduration);
                if (td > 0 && isFinite(td)) return td;
            }
        } catch (_) {}
        return null;
    }

    /** Record seekable-end advances so LIVE can stay ~2 updates behind slow edges. */
    function omtNoteLiveEdgeAdvance(edgeSec) {
        if (!(edgeSec > 0) || !isFinite(edgeSec)) return;
        const now = Date.now();
        if (omtLiveEdgeLastSec == null) {
            omtLiveEdgeLastSec = edgeSec;
            return;
        }
        // Ignore tiny float noise; require a real window move (≥0.25s).
        if (edgeSec <= omtLiveEdgeLastSec + 0.25) {
            omtLiveEdgeLastSec = Math.max(omtLiveEdgeLastSec, edgeSec);
            return;
        }
        omtLiveEdgeLastSec = edgeSec;
        omtLiveEdgeAdvanceAtMs.push(now);
        if (omtLiveEdgeAdvanceAtMs.length > 8) {
            omtLiveEdgeAdvanceAtMs = omtLiveEdgeAdvanceAtMs.slice(-8);
        }
    }

    function omtNoteLiveStall() {
        omtLiveLastStallAtMs = Date.now();
    }

    /** Median wall-clock seconds between recent edge advances, or null. */
    function omtEdgeUpdateIntervalSec() {
        const stamps = omtLiveEdgeAdvanceAtMs;
        if (!stamps || stamps.length < 2) return null;
        const gaps = [];
        for (let i = 1; i < stamps.length; i++) {
            const g = (stamps[i] - stamps[i - 1]) / 1000;
            if (g > 0.2 && g < 120) gaps.push(g);
        }
        if (!gaps.length) return null;
        gaps.sort((a, b) => a - b);
        return gaps[Math.floor(gaps.length / 2)];
    }

    function omtBufferedAheadSec() {
        if (!vid || !vid.buffered || vid.buffered.length === 0) return 0;
        try {
            const ct = vid.currentTime || 0;
            for (let i = 0; i < vid.buffered.length; i++) {
                const start = vid.buffered.start(i);
                const end = vid.buffered.end(i);
                if (ct >= start - 0.25 && ct <= end + 0.25) {
                    return Math.max(0, end - ct);
                }
            }
            const end = vid.buffered.end(vid.buffered.length - 1);
            return Math.max(0, end - ct);
        } catch (_) {
            return 0;
        }
    }

    /**
     * Adaptive margin behind seekable end for LIVE jumps.
     * - Base OMT_LIVE_SAFE_MARGIN_S (10): floor after a recent stall; also the
     *   "counts as LIVE" UI threshold.
     * - Unstable / slow edge: max(base, ~2 edge updates).
     * - Stable (no recent stall, healthy buffer, short/fast edge): may go closer
     *   than base down to OMT_LIVE_SAFE_MARGIN_MIN_S.
     * Manual skips are never clamped to this.
     */
    function omtAdaptiveLiveSafeMarginSec() {
        const base = (typeof OMT_LIVE_SAFE_MARGIN_S === 'number' && OMT_LIVE_SAFE_MARGIN_S > 0)
            ? OMT_LIVE_SAFE_MARGIN_S : 10;
        const minM = (typeof OMT_LIVE_SAFE_MARGIN_MIN_S === 'number') ? OMT_LIVE_SAFE_MARGIN_MIN_S : 4;
        const maxM = (typeof OMT_LIVE_SAFE_MARGIN_MAX_S === 'number') ? OMT_LIVE_SAFE_MARGIN_MAX_S : 30;
        const stallWin = (typeof OMT_LIVE_STALL_MEMORY_MS === 'number') ? OMT_LIVE_STALL_MEMORY_MS : 45000;

        const stalledRecently = omtLiveLastStallAtMs > 0 &&
            (Date.now() - omtLiveLastStallAtMs) < stallWin;
        const edgeIv = omtEdgeUpdateIntervalSec();
        const targetDur = omtHlsTargetDurationSec();
        const bufAhead = omtBufferedAheadSec();
        const twoUpdates = (edgeIv != null) ? (edgeIv * 2) : null;
        const twoSeg = (targetDur != null && targetDur > 0) ? (targetDur * 2) : null;

        let margin = base;

        if (stalledRecently) {
            // Field: never closer than base after a stall; prefer ≥2 edge updates.
            margin = base;
            if (twoUpdates != null) margin = Math.max(margin, twoUpdates);
            if (twoSeg != null) margin = Math.max(margin, twoSeg);
        } else {
            const slowEdge = twoUpdates != null && twoUpdates > base;
            const longSeg = twoSeg != null && twoSeg > base;
            const thinBuffer = bufAhead > 0 && bufAhead < base;
            if (slowEdge || longSeg || thinBuffer) {
                margin = base;
                if (twoUpdates != null) margin = Math.max(margin, twoUpdates);
                if (twoSeg != null) margin = Math.max(margin, twoSeg);
            } else if (
                bufAhead >= base + 4 &&
                (edgeIv == null || edgeIv <= 3.5) &&
                (targetDur == null || targetDur <= 4)
            ) {
                // Stable: may sit closer than base (still ≥ min / ~2 updates).
                const close = twoUpdates != null ? Math.max(minM, twoUpdates) : minM;
                margin = Math.min(base, close);
            }
        }

        return Math.min(maxM, Math.max(minM, margin));
    }

    /** LIVE jump target = seekable end − adaptive margin. Not a seek clamp. */
    function omtLiveSafePointSec() {
        const edge = omtTimelineLiveEdgeSec();
        if (!(edge > 0)) return 0;
        let margin = omtAdaptiveLiveSafeMarginSec();
        // Short local files: do not jump to 0 because margin > duration.
        if (edge < 60) {
            margin = Math.min(margin, Math.max(1, edge * 0.25));
            margin = Math.min(margin, Math.max(1, edge - 1));
        }
        return Math.max(0, edge - margin);
    }

    /**
     * Max delay that still *enters* LIVE (adaptive safe margin + tol).
     * Single threshold for panel red + timeline LIVE chip — never a fixed ~5s.
     */
    function omtLiveAtLiveMaxDelaySec() {
        const margin = omtAdaptiveLiveSafeMarginSec();
        const tol = (typeof OMT_LIVE_AT_LIVE_TOL_S === 'number') ? OMT_LIVE_AT_LIVE_TOL_S : 1.5;
        return margin + Math.max(0, tol);
    }

    function omtLiveDelaySec(playhead, liveEdge) {
        return liveEdge > 0 ? Math.max(0, liveEdge - (Number(playhead) || 0)) : 0;
    }

    /** Strict: playhead within adaptive safe point (+ tol). No hysteresis. */
    function omtIsPlayheadAtLive(playhead, liveEdge) {
        if (!(liveEdge > 0)) return false;
        return omtLiveDelaySec(playhead, liveEdge) <= omtLiveAtLiveMaxDelaySec();
    }

    /**
     * Shared at-live latch for panel button + timeline LIVE chip.
     * Enter at adaptive safe point (+ tol); leave a few seconds further out so
     * both indicators stay in lockstep (never red LIVE beside a big −delay).
     */
    function omtAdvanceAtLiveLatch(delay) {
        const enter = omtLiveAtLiveMaxDelaySec();
        const leave = enter + 5;
        if (omtTimelineLiveChipOn) {
            if (delay > leave) omtTimelineLiveChipOn = false;
        } else if (delay <= enter) {
            omtTimelineLiveChipOn = true;
        }
        return !!omtTimelineLiveChipOn;
    }

    /**
     * ONE snapshot driving every live/time chrome piece.
     * Callers must reuse this object in the same paint tick (do not resolve twice).
     */
    function omtResolveLivePresentation(opts) {
        const o = opts || {};
        const liveMode = omtIsTimelineLiveMode();
        const kickoffOn = omtHasKickoffOffset();
        const playhead = o.playhead != null ? o.playhead : omtTimelinePlayheadSec();
        const liveEdge = o.liveEdge != null ? o.liveEdge : omtTimelineLiveEdgeSec();
        const delay = omtLiveDelaySec(playhead, liveEdge);
        let atLive = false;
        if (liveMode) {
            if (o.forceAtLive) omtTimelineLiveChipOn = true;
            atLive = omtAdvanceAtLiveLatch(delay);
        } else {
            omtTimelineLiveChipOn = false;
            atLive = false;
        }
        return { liveMode, kickoffOn, playhead, liveEdge, delay, atLive };
    }

    /** Kick-off offset set → timeline chrome shows match clock (+ live delay when live). */
    function omtHasKickoffOffset() {
        return !!(timerAtivo && (
            kickoff1 !== null || kickoff2 !== null || kickoffC1 !== null || kickoffC2 !== null
        ));
    }

    /**
     * Left LIVE control: either LIVE chip OR delay text — never both.
     * `atLive` comes from omtResolveLivePresentation (shared with panel button).
     */
    function omtPaintLiveDelayChip(liveInd, liveDelayEl, liveChipEl, delay, atLive) {
        liveInd.hidden = false;
        if (atLive) {
            liveDelayEl.hidden = true;
            liveChipEl.hidden = false;
            liveInd.classList.add('is-at-live');
            liveInd.setAttribute('aria-label', 'At live');
        } else {
            liveDelayEl.hidden = false;
            liveChipEl.hidden = true;
            liveDelayEl.textContent = formatarAtrasoLive(delay);
            liveInd.classList.remove('is-at-live');
            liveInd.setAttribute('aria-label', 'Go to live safe point');
        }
    }

    /**
     * Right of chrome (left of FS): playhead / furthest reachable video time.
     * Live/DVR only — hidden on VOD/local/post so left post-times are not duplicated.
     */
    function omtPaintVideoRange(videoRangeEl, playhead, liveEdge, show) {
        if (!videoRangeEl) return;
        if (!show) {
            videoRangeEl.hidden = true;
            return;
        }
        videoRangeEl.hidden = false;
        videoRangeEl.textContent =
            formatarTempoCompacto(playhead) + ' / ' + formatarTempoCompacto(liveEdge);
        videoRangeEl.title =
            'You ' + formatarTempoCompacto(playhead) +
            ' · furthest ' + formatarTempoCompacto(liveEdge);
    }

    /**
     * Paint timeline chrome-row from a live presentation snapshot (or resolve one).
     * Left: match clock and/or LIVE delay/chip, or POST current/duration.
     * Right (live/DVR): playhead / furthest — never duplicates left POST times.
     */
    function atualizarTempoTimelineDireito(snapIn) {
        if (!omtRoot) return;
        const timesWrap = omtRoot.querySelector('.omt-timeline-times');
        const liveInd = omtRoot.querySelector('#omt-timeline-live-indicator');
        const liveDelayEl = omtRoot.querySelector('#omt-timeline-live-delay');
        const liveChipEl = omtRoot.querySelector('#omt-timeline-live-chip');
        const postWrap = omtRoot.querySelector('#omt-timeline-post-times');
        const matchClockEl = omtRoot.querySelector('#omt-timeline-match-clock');
        const videoRangeEl = omtRoot.querySelector('#omt-timeline-video-range');
        if (!timesWrap || !liveInd || !liveDelayEl || !liveChipEl || !postWrap || !matchClockEl) return;

        const snap = snapIn || omtResolveLivePresentation();
        const { liveMode, kickoffOn, playhead, liveEdge, delay, atLive } = snap;

        if (kickoffOn) {
            timesWrap.dataset.omtTimeMode = 'kickoff';
            postWrap.hidden = true;
            matchClockEl.hidden = false;
            let clockText = '';
            if (typeof matchClockAtVideoTime === 'function') {
                const info = matchClockAtVideoTime(playhead);
                clockText = (info && info.clock) ? info.clock : '';
            }
            if (!clockText && timerUI && timerUI.innerText) clockText = timerUI.innerText;
            matchClockEl.textContent = clockText || '00:00';

            if (liveMode) {
                omtPaintLiveDelayChip(liveInd, liveDelayEl, liveChipEl, delay, atLive);
                omtPaintVideoRange(videoRangeEl, playhead, liveEdge, true);
            } else {
                liveInd.hidden = true;
                omtPaintVideoRange(videoRangeEl, playhead, liveEdge, false);
            }
            return;
        }

        matchClockEl.hidden = true;
        timesWrap.dataset.omtTimeMode = liveMode ? 'live' : 'post';
        liveInd.hidden = !liveMode;
        postWrap.hidden = liveMode;

        if (!liveMode) {
            omtPaintVideoRange(videoRangeEl, playhead, liveEdge, false);
            let dur = liveEdge;
            if (!(dur > 0) && site && typeof site.effectiveDuration === 'function') {
                const ed = site.effectiveDuration(vid);
                if (ed && isFinite(ed)) dur = ed;
            }
            if (vTimeCurrent) vTimeCurrent.innerText = formatarTempoCompacto(playhead);
            if (vTimeDuration) vTimeDuration.innerText = formatarTempoCompacto(dur);
            return;
        }

        omtPaintLiveDelayChip(liveInd, liveDelayEl, liveChipEl, delay, atLive);
        omtPaintVideoRange(videoRangeEl, playhead, liveEdge, true);
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
            timelineSlider.disabled = false;
            if (parseFloat(timelineSlider.value) < minVal) timelineSlider.value = minVal;
            if (typeof atualizarTempoTimelineDireito === 'function') atualizarTempoTimelineDireito();

            // --- SE FOR DVR (REVIEW): Mostra os controlos (caso não tenham sido escondidos pelo H) ---
            if (controlsPanel && !isManuallyHidden) {
                controlsPanel.style.display = ''; // Limpa o 'none' e usa o layout padrão do CSS
                const timelineBar = omtRoot ? omtRoot.querySelector('#omt-timeline-bar') : null;
                if (timelineBar) timelineBar.style.display = '';
                resetControlsTimeout(false);
            }
        } else {
            timelineSlider.min = 0;
            timelineSlider.max = 100;
            timelineSlider.disabled = true;
            if (typeof atualizarTempoTimelineDireito === 'function') atualizarTempoTimelineDireito();

            // --- SE FOR LIVE PURO (HD): Esconde os controlos automaticamente ---
            if (controlsPanel) {
                controlsPanel.style.display = 'none';
            }
            const timelineBar = omtRoot ? omtRoot.querySelector('#omt-timeline-bar') : null;
            if (timelineBar) timelineBar.style.display = 'none';
        }
        atualizarMarcadores();
    }
