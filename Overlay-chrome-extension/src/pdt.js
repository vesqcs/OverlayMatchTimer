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

    /** Live delay text: -12 s / -1:05 / -1:02:10 */
    function formatarAtrasoLive(delaySec) {
        const d = Math.max(0, Math.floor(Number(delaySec) || 0));
        if (d < 60) return '-' + d + ' s';
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

    /**
     * Paint the timeline right-side time slot (LIVE delay/chip or POST current/duration).
     * Does not read PDT or change seek/hooks — reuses playhead + live-edge already used for LIVE.
     */
    function atualizarTempoTimelineDireito() {
        if (!omtRoot) return;
        const timesWrap = omtRoot.querySelector('.omt-timeline-times');
        const liveInd = omtRoot.querySelector('#omt-timeline-live-indicator');
        const liveDelayEl = omtRoot.querySelector('#omt-timeline-live-delay');
        const liveChipEl = omtRoot.querySelector('#omt-timeline-live-chip');
        const postWrap = omtRoot.querySelector('#omt-timeline-post-times');
        if (!timesWrap || !liveInd || !liveDelayEl || !liveChipEl || !postWrap) return;

        const liveMode = omtIsTimelineLiveMode();
        timesWrap.dataset.omtTimeMode = liveMode ? 'live' : 'post';
        liveInd.hidden = !liveMode;
        postWrap.hidden = liveMode;

        if (!liveMode) {
            omtTimelineLiveChipOn = false;
            const playhead = omtTimelinePlayheadSec();
            let dur = omtTimelineLiveEdgeSec();
            if (!(dur > 0) && site && typeof site.effectiveDuration === 'function') {
                const ed = site.effectiveDuration(vid);
                if (ed && isFinite(ed)) dur = ed;
            }
            if (vTimeCurrent) vTimeCurrent.innerText = formatarTempoCompacto(playhead);
            if (vTimeDuration) vTimeDuration.innerText = formatarTempoCompacto(dur);
            return;
        }

        const liveEdge = omtTimelineLiveEdgeSec();
        const playhead = omtTimelinePlayheadSec();
        const delay = liveEdge > 0 ? Math.max(0, liveEdge - playhead) : 0;

        // Hysteresis: enter LIVE when delay <= ENTER, leave only when delay > LEAVE.
        if (omtTimelineLiveChipOn) {
            if (delay > OMT_LIVE_CHIP_LEAVE_S) omtTimelineLiveChipOn = false;
        } else if (delay <= OMT_LIVE_CHIP_ENTER_S) {
            omtTimelineLiveChipOn = true;
        }

        if (omtTimelineLiveChipOn) {
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
