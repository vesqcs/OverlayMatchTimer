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

    /**
     * LIVE timeline mode (delay / LIVE chip) vs POST (current / duration).
     * Examino: VOD on a still-live match (Auto VOD on /play/dvr) uses the same
     * live chrome as DVR. Only true post-match VOD (/play/vod) and local stay post.
     */
    function omtIsTimelineLiveMode() {
        if (!omtRoot || !site) return false;
        if (site.id === 'local' || omtRoot.classList.contains('omt-local')) return false;
        if (site.id === 'examino') {
            try {
                const path = location.pathname || '';
                // True post-match VOD pages only.
                if (/\/play\/vod\b/i.test(path)) return false;
                // Live match page: keep live chrome even when Source is VOD (Auto VOD).
                if (/\/play\/dvr\b/i.test(path)) return true;
                // Fixtures / unknown paths: VOD → post, DVR → live.
                if (examinoManualSourceChoice === 'VOD') return false;
                if (typeof detectCurrentSource === 'function') {
                    const src = detectCurrentSource();
                    if (src === 'VOD') return false;
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
     * Max delay that still *enters* LIVE.
     * ONE rule for panel red + bar LIVE chip + delay: max(adaptive, pinned-jump)
     * margin + tol. Pin keeps the post-LIVE landing (~20s after a stall) red
     * even if adaptive margin later shrinks.
     */
    function omtLiveAtLiveMaxDelaySec() {
        const adaptive = omtAdaptiveLiveSafeMarginSec();
        const pinned = (typeof omtLivePinnedMarginSec === 'number' && omtLivePinnedMarginSec > 0)
            ? omtLivePinnedMarginSec : 0;
        const margin = Math.max(adaptive, pinned);
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
     * Enter at safe-point margin (+ tol); leave a few seconds further out so
     * both indicators stay in lockstep (never red LIVE beside a big −delay).
     */
    function omtAdvanceAtLiveLatch(delay) {
        const enter = omtLiveAtLiveMaxDelaySec();
        const leave = enter + 5;
        // Brief force window after LIVE click (seek settling / edge tick noise).
        // Cancel immediately if the user seeks far behind the leave threshold.
        if (omtLiveForceAtLiveUntil && Date.now() < omtLiveForceAtLiveUntil) {
            if (delay <= leave) {
                omtTimelineLiveChipOn = true;
                return true;
            }
            omtLiveForceAtLiveUntil = 0;
        }
        if (omtTimelineLiveChipOn) {
            if (delay > leave) {
                omtTimelineLiveChipOn = false;
                omtLivePinnedMarginSec = 0;
            }
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
            if (o.forceAtLive) {
                omtTimelineLiveChipOn = true;
                if (!(omtLiveForceAtLiveUntil > Date.now())) {
                    omtLiveForceAtLiveUntil = Date.now() + 2500;
                }
            }
            atLive = omtAdvanceAtLiveLatch(delay);
        } else {
            omtTimelineLiveChipOn = false;
            omtLivePinnedMarginSec = 0;
            omtLiveForceAtLiveUntil = 0;
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

    // E2E / field diagnostics for the shared at-live rule (read/write pin + stall).
    try {
        window.__omtLiveUiDebug = {
            pinMargin(sec) { omtLivePinnedMarginSec = Math.max(0, Number(sec) || 0); },
            getPin() { return omtLivePinnedMarginSec; },
            clearStall() { omtLiveLastStallAtMs = 0; omtLiveEdgeAdvanceAtMs = []; },
            forceUntil(ms) { omtLiveForceAtLiveUntil = Date.now() + Math.max(0, Number(ms) || 0); },
            atLiveMax() { return omtLiveAtLiveMaxDelaySec(); }
        };
    } catch (_) {}

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
            liveInd.setAttribute('aria-label', 'Go to live');
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
     * Left (live): LIVE chip OR delay only — never match clock, never playhead/furthest.
     * Left (post-match VOD / local): current / duration.
     * Right (live only, incl. VOD-while-live): playhead / furthest left of fullscreen.
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
        const { liveMode, playhead, liveEdge, delay, atLive } = snap;

        // Match clock never belongs on the bottom bar (panel + scrubber tip only).
        matchClockEl.hidden = true;
        timesWrap.dataset.omtTimeMode = liveMode ? 'live' : 'post';

        if (!liveMode) {
            liveInd.hidden = true;
            liveDelayEl.hidden = true;
            liveChipEl.hidden = true;
            liveInd.classList.remove('is-at-live');
            postWrap.hidden = false;
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

        // Live/DVR: left = delay/LIVE only; right = playhead / furthest.
        postWrap.hidden = true;
        liveInd.hidden = false;
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
