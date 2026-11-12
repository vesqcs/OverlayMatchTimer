/* Kick-off markers on the HUD timeline. */
    /* =========================================================
       11. TIMELINE MARKERS
       ========================================================= */
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

        const k1Val = getVideoTimeForPdt(kickoff1);
        const k2Val = getVideoTimeForPdt(kickoff2);
        const kC1Val = getVideoTimeForPdt(kickoffC1);
        const kC2Val = getVideoTimeForPdt(kickoffC2);

        const markers = [
            { val: k1Val, btn: btnK1, cls: 'k1', label: '1st Half Kickoff' },
            { val: k2Val, btn: btnK2, cls: 'k2', label: '2nd Half Kickoff' },
            { val: kC1Val, btn: btnKC1, cls: 'kc1', label: 'Custom 1 Kickoff' },
            { val: kC2Val, btn: btnKC2, cls: 'kc2', label: 'Custom 2 Kickoff' },
        ];

        const minVal = parseFloat(timelineSlider.min) || 0;
        const maxVal = parseFloat(timelineSlider.max) || duration;
        const range = maxVal - minVal;

        markers.forEach(({ val, btn, cls, label }) => {
            if (!btn) return;
            if (val !== null && val >= minVal && val <= maxVal && range > 0) {
                btn.style.display = 'inline-flex';
                const pct = ((val - minVal) / range) * 100;
                markerContainer.innerHTML += `<div class="timeline-marker-tick ${cls}" style="left:${pct}%;" title="${label}"></div>`;
            } else {
                btn.style.display = 'none';
            }
        });
    }

    function jumpToKickoff(half) {
        const map = { '1': kickoff1, '2': kickoff2, 'custom1': kickoffC1, 'custom2': kickoffC2 };
        const labels = { '1': '1st Half', '2': '2nd Half', 'custom1': 'Custom 1', 'custom2': 'Custom 2' };
        const raw = map[half];
        if (raw == null) return;
        const t = getVideoTimeForPdt(raw);
        if (t !== null && t >= 0) {
            seekTo(t);
            mostrarOSD(`⚽ Jumped to ${labels[half]} Kickoff`);
        }
    }
