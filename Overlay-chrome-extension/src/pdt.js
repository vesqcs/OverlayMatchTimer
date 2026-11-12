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
            vTimeDuration.innerText = formatarTempoVideo(mediaDuration);
            timelineSlider.disabled = false;
            if (parseFloat(timelineSlider.value) < minVal) timelineSlider.value = minVal;

            // --- SE FOR DVR (REVIEW): Mostra os controlos (caso não tenham sido escondidos pelo H) ---
            if (controlsPanel && !isManuallyHidden) {
                controlsPanel.style.display = ''; // Limpa o 'none' e usa o layout padrão do CSS
                resetControlsTimeout(false);
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
