/* Kick-off / period markers on the HUD timeline (redesign chrome). */
    /* =========================================================
       11. TIMELINE MARKERS + PERIOD HOVER
       ========================================================= */
    function periodLabelForKey(key) {
        return ({
            '1': '1st Half',
            '2': '2nd Half',
            'custom1': 'ET1',
            'custom2': 'ET2'
        })[key] || '';
    }

    /** Ordered kickoff anchors currently known (video time + period key). */
    function collectPeriodAnchors() {
        const raw = [
            { key: '1', val: getVideoTimeForPdt(kickoff1) },
            { key: '2', val: getVideoTimeForPdt(kickoff2) },
            { key: 'custom1', val: getVideoTimeForPdt(kickoffC1) },
            { key: 'custom2', val: getVideoTimeForPdt(kickoffC2) }
        ];
        return raw
            .filter((a) => a.val !== null && isFinite(a.val))
            .sort((a, b) => a.val - b.val);
    }

    /** Period name for a video time, or '' if before first kickoff / unknown. */
    function resolvePeriodAtVideoTime(t) {
        const anchors = collectPeriodAnchors();
        if (!anchors.length || !isFinite(t)) return '';
        let label = '';
        for (let i = 0; i < anchors.length; i++) {
            if (t + 0.001 >= anchors[i].val) label = periodLabelForKey(anchors[i].key);
            else break;
        }
        return label;
    }

    function atualizarMarcadores() {
        const markerContainer = q('omt-timeline-markers');
        const btnK1 = q('omt-jump-k1');
        const btnK2 = q('omt-jump-k2');
        const btnKC1 = q('omt-jump-kc1');
        const btnKC2 = q('omt-jump-kc2');

        if (!markerContainer) return;
        markerContainer.innerHTML = '';

        const duration = site.effectiveDuration(vid);
        if (!duration || !isFinite(duration)) {
            [btnK1, btnK2, btnKC1, btnKC2].forEach(b => { if (b) b.style.display = 'none'; });
            return;
        }

        const btnMap = { '1': btnK1, '2': btnK2, 'custom1': btnKC1, 'custom2': btnKC2 };
        Object.values(btnMap).forEach((b) => { if (b) b.style.display = 'none'; });

        const minVal = parseFloat(timelineSlider.min) || 0;
        const maxVal = parseFloat(timelineSlider.max) || duration;
        const range = maxVal - minVal;
        if (range <= 0) return;

        const anchors = collectPeriodAnchors().filter((a) => a.val >= minVal && a.val <= maxVal);
        const parts = [];

        // Soft period bands between anchors (and to the end). Low-sat, dark UI.
        for (let i = 0; i < anchors.length; i++) {
            const start = anchors[i].val;
            const end = (i + 1 < anchors.length) ? anchors[i + 1].val : maxVal;
            const left = ((start - minVal) / range) * 100;
            const width = Math.max(0, ((end - start) / range) * 100);
            const tone = (i % 2 === 0) ? 'a' : 'b';
            parts.push(
                `<div class="timeline-period-seg tone-${tone}" style="left:${left}%;width:${width}%;" data-period="${periodLabelForKey(anchors[i].key)}"></div>`
            );
        }

        // Thin boundary markers at each kickoff (single muted style — no rainbow blocks).
        anchors.forEach((a) => {
            const pct = ((a.val - minVal) / range) * 100;
            parts.push(
                `<div class="timeline-marker-tick" style="left:${pct}%;" data-period="${periodLabelForKey(a.key)}"></div>`
            );
        });

        markerContainer.innerHTML = parts.join('');
    }

    function jumpToKickoff(half) {
        const map = { '1': kickoff1, '2': kickoff2, 'custom1': kickoffC1, 'custom2': kickoffC2 };
        const labels = { '1': '1st Half', '2': '2nd Half', 'custom1': 'Custom 1', 'custom2': 'Custom 2' };
        const raw = map[half];
        if (raw == null) return;
        const t = getVideoTimeForPdt(raw);
        if (t !== null && t >= 0) {
            seekTo(t);
            mostrarOSD('Jumped to ' + labels[half] + ' Kickoff');
        }
    }

    /** Redesign-only: period + time tip under the pointer on the timeline. */
    function updateTimelineHoverTip(clientX) {
        const tip = q('omt-timeline-hover-tip');
        const track = omtRoot ? omtRoot.querySelector('.omt-timeline-track') : null;
        const bar = q('omt-timeline-bar');
        if (!tip || !track || !timelineSlider || !bar) return;
        const trackRect = track.getBoundingClientRect();
        const barRect = bar.getBoundingClientRect();
        if (trackRect.width <= 0) return;
        const ratio = Math.max(0, Math.min(1, (clientX - trackRect.left) / trackRect.width));
        const min = parseFloat(timelineSlider.min) || 0;
        const max = parseFloat(timelineSlider.max) || 0;
        const t = min + ratio * (max - min);
        const period = resolvePeriodAtVideoTime(t);
        const timeStr = (typeof formatarTempoVideo === 'function') ? formatarTempoVideo(t) : '';
        tip.textContent = period ? (period + ' · ' + timeStr) : timeStr;
        tip.hidden = false;
        // Lift bar above the floating card while the tip is shown (tip is pointer-events:none).
        bar.style.zIndex = '55';
        const leftPx = (trackRect.left - barRect.left) + ratio * trackRect.width;
        tip.style.left = leftPx + 'px';
        tip.style.bottom = (barRect.bottom - trackRect.top + 6) + 'px';
        tip.style.top = 'auto';
    }

    function hideTimelineHoverTip() {
        const tip = q('omt-timeline-hover-tip');
        const bar = q('omt-timeline-bar');
        if (tip) tip.hidden = true;
        if (bar) bar.style.zIndex = '';
    }
