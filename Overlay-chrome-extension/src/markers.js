/* Kick-off / period bookmarks on the HUD timeline (redesign chrome). */
    /* =========================================================
       11. TIMELINE BOOKMARKS + PERIOD HOVER
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

    /**
     * Redesign-only: match-clock mm:ss the on-video timer would show at video time t.
     * Mirrors atualizarRelogio period/base selection; does not touch original hooks.
     */
    function matchClockAtVideoTime(t) {
        if (!isFinite(t)) return { period: '', clock: '' };
        const k1 = getVideoTimeForPdt(kickoff1);
        const k2 = getVideoTimeForPdt(kickoff2);
        const kC1 = getVideoTimeForPdt(kickoffC1);
        const kC2 = getVideoTimeForPdt(kickoffC2);

        if (k1 === null && k2 === null && kC1 === null && kC2 === null) {
            return {
                period: '',
                clock: (typeof formatarTempoVideo === 'function') ? formatarTempoVideo(t) : ''
            };
        }

        if (k1 !== null && t < k1) {
            return {
                period: '',
                clock: 'Pre-match'
            };
        }

        let kickoffUsar = k1;
        let baseUsar = 0;
        if (kC2 !== null && t >= kC2) {
            kickoffUsar = kC2;
            baseUsar = (parseInt(localStorage.getItem('matchTimerCustomMinC2'), 10) || 105) * 60;
        } else if (kC1 !== null && t >= kC1) {
            kickoffUsar = kC1;
            baseUsar = (parseInt(localStorage.getItem('matchTimerCustomMinC1'), 10) || 90) * 60;
        } else if (k2 !== null && t >= k2) {
            kickoffUsar = k2;
            baseUsar = 45 * 60;
        } else if (k1 !== null) {
            kickoffUsar = k1;
            baseUsar = 0;
        } else {
            return {
                period: '',
                clock: (typeof formatarTempoVideo === 'function') ? formatarTempoVideo(t) : ''
            };
        }

        const totalSeconds = (t - kickoffUsar) + baseUsar;
        const mm = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const ss = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
        return {
            period: resolvePeriodAtVideoTime(t),
            clock: mm + ':' + ss
        };
    }

    function atualizarMarcadores() {
        const markerContainer = q('omt-timeline-markers');
        const bookmarkContainer = q('omt-timeline-bookmarks');
        const btnK1 = q('omt-jump-k1');
        const btnK2 = q('omt-jump-k2');
        const btnKC1 = q('omt-jump-kc1');
        const btnKC2 = q('omt-jump-kc2');

        if (markerContainer) markerContainer.innerHTML = '';
        if (bookmarkContainer) bookmarkContainer.innerHTML = '';

        const duration = site.effectiveDuration(vid);
        if (!duration || !isFinite(duration)) {
            [btnK1, btnK2, btnKC1, btnKC2].forEach(b => { if (b) b.style.display = 'none'; });
            return;
        }

        const btnMap = { '1': btnK1, '2': btnK2, 'custom1': btnKC1, 'custom2': btnKC2 };
        Object.values(btnMap).forEach((b) => { if (b) b.style.display = 'none'; });

        if (!bookmarkContainer || !timelineSlider) return;

        const minVal = parseFloat(timelineSlider.min) || 0;
        const maxVal = parseFloat(timelineSlider.max) || duration;
        const range = maxVal - minVal;
        if (range <= 0) return;

        const anchors = collectPeriodAnchors().filter((a) => a.val >= minVal && a.val <= maxVal);
        const icon = (typeof omtIcon === 'function') ? omtIcon('bookmark', 11) : '';

        anchors.forEach((a) => {
            const pct = ((a.val - minVal) / range) * 100;
            const label = periodLabelForKey(a.key);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'omt-timeline-bookmark';
            btn.style.left = pct + '%';
            btn.setAttribute('data-period', label);
            btn.setAttribute('data-half', a.key);
            btn.setAttribute('aria-label', 'Seek to ' + label);
            btn.innerHTML = icon + '<span class="omt-bm-label">' + label + '</span>';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                jumpToKickoff(a.key);
            });
            bookmarkContainer.appendChild(btn);
        });
        bookmarkContainer.setAttribute('aria-hidden', anchors.length ? 'false' : 'true');
    }

    function jumpToKickoff(half) {
        const map = { '1': kickoff1, '2': kickoff2, 'custom1': kickoffC1, 'custom2': kickoffC2 };
        const labels = { '1': '1st Half', '2': '2nd Half', 'custom1': 'Custom 1', 'custom2': 'Custom 2' };
        const raw = map[half];
        if (raw == null) return;
        const t = getVideoTimeForPdt(raw);
        if (t !== null && t >= 0) {
            if (typeof paintTimelineScrubberProgress === 'function' && timelineSlider) {
                const min = parseFloat(timelineSlider.min) || 0;
                const max = parseFloat(timelineSlider.max) || 0;
                if (max > min) {
                    timelineSlider.value = String(Math.max(min, Math.min(max, t)));
                    paintTimelineScrubberProgress(true);
                }
            }
            seekTo(t);
            mostrarOSD('Jumped to ' + labels[half] + ' Kickoff');
        }
    }

    /** Redesign-only: period + match-clock tip under the pointer on the timeline. */
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
        const info = matchClockAtVideoTime(t);
        if (info.period && info.clock) tip.textContent = info.period + ' · ' + info.clock;
        else if (info.clock) tip.textContent = info.clock;
        else tip.textContent = (typeof formatarTempoVideo === 'function') ? formatarTempoVideo(t) : '';
        tip.hidden = false;
        bar.classList.add('is-timeline-hover');
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
        if (bar) {
            bar.style.zIndex = '';
            bar.classList.remove('is-timeline-hover');
        }
    }
