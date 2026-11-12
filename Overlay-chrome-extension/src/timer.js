/* Match clock, kick-off sync, click-to-edit timer. */
    /* =========================================================
       10. TIMER / CLOCK LOGIC
       ========================================================= */
    function iniciarTimer() {
        let hInput = q('omt-sync-hr').value;
        let mInput = q('omt-sync-min').value;
        let sInput = q('omt-sync-sec').value;

        // Auto-capture current frame if inputs are empty
        if (hInput === '' && mInput === '' && sInput === '') {
            const ct = vid.currentTime || 0;
            hInput = Math.floor(ct / 3600).toString();
            mInput = Math.floor((ct % 3600) / 60).toString();
            sInput = Math.floor(ct % 60).toString();
            q('omt-sync-hr').value = hInput;
            q('omt-sync-min').value = mInput;
            q('omt-sync-sec').value = sInput;
            mostrarOSD('Captured: ' + formatarTempoVideo(ct));
        }

        const h = parseInt(hInput) || 0;
        const m = parseInt(mInput) || 0;
        const s = parseInt(sInput) || 0;
        const parte = q('omt-half-select').value;

        if (parte === '2') { tempoBase = 45 * 60; }
        else if (parte === 'custom1') { tempoBase = (parseInt(q('omt-custom-minute-c1').value) || 0) * 60; }
        else if (parte === 'custom2') { tempoBase = (parseInt(q('omt-custom-minute-c2').value) || 0) * 60; }
        else { tempoBase = 0; }

        const rawOffset = (h * 3600) + (m * 60) + s;

        // For streams: try to store an absolute PDT timestamp for drift-proof sync
        let kickoffVal = rawOffset;
        const pdtAtOffset = getPdtForVideoTime(rawOffset);
        if (pdtAtOffset !== null) kickoffVal = pdtAtOffset;

        offsetEmSegundos = kickoffVal;
        timerAtivo = true;
        if (timerUI) timerUI.style.display = 'block';
        const wrap = q('match-timer-wrap');
        if (wrap) wrap.style.display = 'flex';
        if (omtRoot) omtRoot.classList.add('omt-timer-on');
        previousHalf = parte;

        // Persist
        localStorage.setItem('matchTimerAtivo', 'true');
        localStorage.setItem('matchTimerOffset', offsetEmSegundos);
        localStorage.setItem('matchTimerTempoBase', tempoBase);
        localStorage.setItem('matchTimerSyncHr', h);
        localStorage.setItem('matchTimerSyncMin', m);
        localStorage.setItem('matchTimerSyncSec', s);
        localStorage.setItem('matchTimerHalf', parte);
        localStorage.setItem('matchTimerWhistle_' + parte, JSON.stringify({ h, m, s }));
        if (parte === 'custom1') localStorage.setItem('matchTimerCustomMinC1', q('omt-custom-minute-c1').value);
        if (parte === 'custom2') localStorage.setItem('matchTimerCustomMinC2', q('omt-custom-minute-c2').value);

        // Save kickoff marker
        if (parte === '1') { kickoff1 = offsetEmSegundos; localStorage.setItem('matchTimerKickoff1', kickoff1); }
        else if (parte === '2') { kickoff2 = offsetEmSegundos; localStorage.setItem('matchTimerKickoff2', kickoff2); }
        else if (parte === 'custom1') { kickoffC1 = offsetEmSegundos; localStorage.setItem('matchTimerKickoffC1', kickoffC1); }
        else if (parte === 'custom2') { kickoffC2 = offsetEmSegundos; localStorage.setItem('matchTimerKickoffC2', kickoffC2); }

        inicializarMetadadosTimeline();
        atualizarMarcadores();
        atualizarRelogio();
        esconderSetup();
        const _kickoffBtn = q('omt-btn-set-kickoff');
        if (_kickoffBtn) _kickoffBtn.classList.add('kickoff-set');
        mostrarOSD('Timer Synced');
    }

    function limparTimer() {
        timerAtivo = false;
        if (timerUI) timerUI.style.display = 'none';
        const wrapClear = q('match-timer-wrap');
        if (wrapClear) wrapClear.style.display = 'none';
        if (omtRoot) omtRoot.classList.remove('omt-timer-on');
        offsetEmSegundos = 0;
        tempoBase = 0;
        previousHalf = '1';

        ['matchTimerAtivo', 'matchTimerOffset', 'matchTimerTempoBase', 'matchTimerSyncHr',
            'matchTimerSyncMin', 'matchTimerSyncSec', 'matchTimerHalf', 'matchTimerCustomMinC1',
            'matchTimerCustomMinC2', 'matchTimerWhistle_1', 'matchTimerWhistle_2',
            'matchTimerWhistle_custom1', 'matchTimerWhistle_custom2',
            'matchTimerKickoff1', 'matchTimerKickoff2', 'matchTimerKickoffC1', 'matchTimerKickoffC2'
        ].forEach(k => localStorage.removeItem(k));

        kickoff1 = kickoff2 = kickoffC1 = kickoffC2 = null;

        q('omt-sync-hr').value = '';
        q('omt-sync-min').value = '';
        q('omt-sync-sec').value = '';
        q('omt-half-select').value = '1';
        q('omt-custom-c1').style.display = 'none';
        q('omt-custom-c2').style.display = 'none';
        q('omt-custom-minute-c1').value = '';
        q('omt-custom-minute-c2').value = '';

        inicializarMetadadosTimeline();
        atualizarMarcadores();
        const _kickoffBtnClear = q('omt-btn-set-kickoff');
        if (_kickoffBtnClear) _kickoffBtnClear.classList.remove('kickoff-set');
        mostrarOSD('Timer Cleared');
    }

    /** Nudge kick-off offset by ±seconds using existing offset/kickoff state (no new math). */
    function nudgeKickoffOffset(deltaSec) {
        if (!timerAtivo || !deltaSec) return;
        const applyDelta = (val) => {
            if (val === null || val === undefined || val === '') return val;
            const n = Number(val);
            if (!isFinite(n)) return val;
            return isPdtTimestamp(n) ? (n + deltaSec * 1000) : (n + deltaSec);
        };

        offsetEmSegundos = applyDelta(offsetEmSegundos);
        localStorage.setItem('matchTimerOffset', offsetEmSegundos);

        const parte = previousHalf || (q('omt-half-select') && q('omt-half-select').value) || '1';
        if (parte === '1' && kickoff1 !== null) {
            kickoff1 = applyDelta(kickoff1);
            localStorage.setItem('matchTimerKickoff1', kickoff1);
        } else if (parte === '2' && kickoff2 !== null) {
            kickoff2 = applyDelta(kickoff2);
            localStorage.setItem('matchTimerKickoff2', kickoff2);
        } else if (parte === 'custom1' && kickoffC1 !== null) {
            kickoffC1 = applyDelta(kickoffC1);
            localStorage.setItem('matchTimerKickoffC1', kickoffC1);
        } else if (parte === 'custom2' && kickoffC2 !== null) {
            kickoffC2 = applyDelta(kickoffC2);
            localStorage.setItem('matchTimerKickoffC2', kickoffC2);
        }

        // Keep hidden whistle fields aligned when offset is plain video seconds.
        if (!isPdtTimestamp(offsetEmSegundos)) {
            const ct = Math.max(0, Number(offsetEmSegundos) || 0);
            const hrEl = q('omt-sync-hr');
            const minEl = q('omt-sync-min');
            const secEl = q('omt-sync-sec');
            if (hrEl) hrEl.value = String(Math.floor(ct / 3600));
            if (minEl) minEl.value = String(Math.floor((ct % 3600) / 60));
            if (secEl) secEl.value = String(Math.floor(ct % 60));
            localStorage.setItem('matchTimerSyncHr', hrEl ? hrEl.value : '0');
            localStorage.setItem('matchTimerSyncMin', minEl ? minEl.value : '0');
            localStorage.setItem('matchTimerSyncSec', secEl ? secEl.value : '0');
        }

        atualizarMarcadores();
        atualizarRelogio();
        mostrarOSD('Offset ' + (deltaSec > 0 ? '+' : '') + deltaSec + 's');
    }

    function atualizarRelogio() {
        if (!timerAtivo || isEditingTimer) return;

        const tAtual = vid.currentTime;

        const k1 = getVideoTimeForPdt(kickoff1);
        const k2 = getVideoTimeForPdt(kickoff2);
        const kC1 = getVideoTimeForPdt(kickoffC1);
        const kC2 = getVideoTimeForPdt(kickoffC2);

        let resolvedOffset = getVideoTimeForPdt(offsetEmSegundos);
        if (resolvedOffset === null) {
            // PDT not yet available — wait silently
            if (isPdtTimestamp(offsetEmSegundos)) return;
            resolvedOffset = 0;
        }

        let kickoffUsar = resolvedOffset;
        let baseUsar = tempoBase;

        if (kC2 !== null && tAtual >= kC2) { kickoffUsar = kC2; baseUsar = (parseInt(localStorage.getItem('matchTimerCustomMinC2')) || 105) * 60; }
        else if (kC1 !== null && tAtual >= kC1) { kickoffUsar = kC1; baseUsar = (parseInt(localStorage.getItem('matchTimerCustomMinC1')) || 90) * 60; }
        else if (k2 !== null && tAtual >= k2) { kickoffUsar = k2; baseUsar = 45 * 60; }
        else if (k1 !== null) { kickoffUsar = k1; baseUsar = 0; }

        // Before first kickoff
        if (k1 !== null && tAtual < k1) {
            timerUI.innerText = 'Pre-Match';
            timerUI.style.color = '#ffcc00';
            return;
        }

        const totalSeconds = (tAtual - kickoffUsar) + baseUsar;
        timerUI.style.color = 'white';
        timerUI.innerText = `${Math.floor(totalSeconds / 60).toString().padStart(2, '0')}:${Math.floor(totalSeconds % 60).toString().padStart(2, '0')}`;
    }

    function obterMinutoAtualJogo() {
        if (!timerAtivo) return 0;
        const tAtual = vid.currentTime;
        const k1 = getVideoTimeForPdt(kickoff1);
        const k2 = getVideoTimeForPdt(kickoff2);
        const kC1 = getVideoTimeForPdt(kickoffC1);
        const kC2 = getVideoTimeForPdt(kickoffC2);

        let resolvedOffset = getVideoTimeForPdt(offsetEmSegundos);
        if (resolvedOffset === null) resolvedOffset = 0;

        let kickoffUsar = resolvedOffset;
        let baseUsar = tempoBase;

        if (kC2 !== null && tAtual >= kC2) {
            kickoffUsar = kC2;
            const customMinC2 = parseInt(localStorage.getItem('matchTimerCustomMinC2')) || 105;
            baseUsar = customMinC2 * 60;
        } else if (kC1 !== null && tAtual >= kC1) {
            kickoffUsar = kC1;
            const customMinC1 = parseInt(localStorage.getItem('matchTimerCustomMinC1')) || 90;
            baseUsar = customMinC1 * 60;
        } else if (k2 !== null && tAtual >= k2) {
            kickoffUsar = k2;
            baseUsar = 45 * 60;
        } else if (k1 !== null) {
            kickoffUsar = k1;
            baseUsar = 0;
        }

        const tempoDeJogoRelativo = tAtual - kickoffUsar;
        const tempoDeJogoTotal = tempoDeJogoRelativo + baseUsar;
        if (k1 !== null && tAtual < k1) return 0;
        return Math.floor(tempoDeJogoTotal / 60);
    }

    function navegarParaMinutoDeJogo(minutoAlvo) {
        if (!vid) return;

        const tAtual = vid.currentTime;
        const k1 = getVideoTimeForPdt(kickoff1);
        const k2 = getVideoTimeForPdt(kickoff2);
        const kC1 = getVideoTimeForPdt(kickoffC1);
        const kC2 = getVideoTimeForPdt(kickoffC2);

        const c1Min = parseInt(localStorage.getItem('matchTimerCustomMinC1')) || 90;
        const c2Min = parseInt(localStorage.getItem('matchTimerCustomMinC2')) || 105;

        let activePeriod = '1';
        if (kC2 !== null && tAtual >= kC2) activePeriod = 'custom2';
        else if (kC1 !== null && tAtual >= kC1) activePeriod = 'custom1';
        else if (k2 !== null && tAtual >= k2) activePeriod = '2';

        let targetVideoTime = null;

        // Determine the target period based on minutoAlvo, activePeriod, and the kickoffs
        let targetPeriod = null;

        // Exact match checks for nominal kickoff minutes
        if (minutoAlvo === c2Min && kC2 !== null && activePeriod !== 'custom1') {
            targetPeriod = 'custom2';
        } else if (minutoAlvo === c1Min && kC1 !== null && activePeriod !== '2') {
            targetPeriod = 'custom1';
        } else if (minutoAlvo === 45 && k2 !== null) {
            targetPeriod = '2';
        } else {
            // General logic based on the active period
            if (activePeriod === '1') {
                const baseOffset = k1 !== null ? k1 : (getVideoTimeForPdt(offsetEmSegundos) || 0);
                const tentativeTime = baseOffset + minutoAlvo * 60;
                
                if (kC2 !== null && tentativeTime >= kC2) {
                    targetPeriod = 'custom2';
                } else if (kC1 !== null && tentativeTime >= kC1) {
                    targetPeriod = 'custom1';
                } else if (k2 !== null && tentativeTime >= k2) {
                    targetPeriod = '2';
                } else {
                    targetPeriod = '1';
                }
            } else if (activePeriod === '2') {
                if (minutoAlvo < 45) {
                    targetPeriod = '1';
                } else {
                    const tentativeTime = k2 + (minutoAlvo - 45) * 60;
                    
                    if (kC2 !== null && tentativeTime >= kC2) {
                        targetPeriod = 'custom2';
                    } else if (kC1 !== null && tentativeTime >= kC1) {
                        targetPeriod = 'custom1';
                    } else {
                        targetPeriod = '2';
                    }
                }
            } else if (activePeriod === 'custom1') {
                if (minutoAlvo < 45) {
                    targetPeriod = '1';
                } else if (minutoAlvo < c1Min) {
                    targetPeriod = '2';
                } else {
                    const tentativeTime = kC1 + (minutoAlvo - c1Min) * 60;
                    
                    if (kC2 !== null && tentativeTime >= kC2) {
                        targetPeriod = 'custom2';
                    } else {
                        targetPeriod = 'custom1';
                    }
                }
            } else if (activePeriod === 'custom2') {
                if (minutoAlvo < 45) {
                    targetPeriod = '1';
                } else if (minutoAlvo < c1Min) {
                    targetPeriod = '2';
                } else if (minutoAlvo < c2Min) {
                    targetPeriod = 'custom1';
                } else {
                    targetPeriod = 'custom2';
                }
            }
        }

        // Calculate the target time based on the resolved target period
        if (targetPeriod === 'custom2') {
            targetVideoTime = kC2 + (minutoAlvo - c2Min) * 60;
        } else if (targetPeriod === 'custom1') {
            const tentativeTime = kC1 + (minutoAlvo - c1Min) * 60;
            if (kC2 !== null && tentativeTime >= kC2) {
                targetVideoTime = kC2 + (minutoAlvo - c2Min) * 60;
            } else {
                targetVideoTime = tentativeTime;
            }
        } else if (targetPeriod === '2') {
            const tentativeTime = k2 + (minutoAlvo - 45) * 60;
            if (kC2 !== null && tentativeTime >= kC2) {
                targetVideoTime = kC2 + (minutoAlvo - c2Min) * 60;
            } else if (kC1 !== null && tentativeTime >= kC1) {
                targetVideoTime = kC1 + (minutoAlvo - c1Min) * 60;
            } else {
                targetVideoTime = tentativeTime;
            }
        } else {
            const baseOffset = k1 !== null ? k1 : (getVideoTimeForPdt(offsetEmSegundos) || 0);
            const tentativeTime = baseOffset + minutoAlvo * 60;
            if (kC2 !== null && tentativeTime >= kC2) {
                targetVideoTime = kC2 + (minutoAlvo - c2Min) * 60;
            } else if (kC1 !== null && tentativeTime >= kC1) {
                targetVideoTime = kC1 + (minutoAlvo - c1Min) * 60;
            } else if (k2 !== null && tentativeTime >= k2) {
                targetVideoTime = k2 + (minutoAlvo - 45) * 60;
            } else {
                targetVideoTime = tentativeTime;
            }
        }

        if (targetVideoTime !== null && targetVideoTime >= 0) {
            if (vid.duration && isFinite(vid.duration)) {
                targetVideoTime = Math.min(targetVideoTime, vid.duration);
            }
            seekTo(targetVideoTime);
            mostrarOSD('Jumped to Min ' + minutoAlvo);
        }
    }

    function iniciarEdicaoTimer() {
        if (isEditingTimer || !timerAtivo) return;

        const minAtual = obterMinutoAtualJogo();
        isEditingTimer = true;

        timerUI.innerHTML = `<input type="text" id="timer-edit-input" value="${minAtual}" style="width: 70px; background: transparent; border: none; color: white; font-size: inherit; font-family: inherit; font-weight: inherit; text-align: center; outline: none; padding: 0; margin: 0; display: inline-block; vertical-align: middle;">`;

        const input = omtRoot.querySelector('#timer-edit-input');
        if (input) {
            input.focus();
            input.select();

            let isCommitted = false;

            function salvarEdicao() {
                if (isCommitted) return;
                isCommitted = true;
                const val = input.value.trim();
                if (val !== '') {
                    const targetMin = parseFloat(val);
                    if (!isNaN(targetMin) && targetMin >= 0) {
                        navegarParaMinutoDeJogo(targetMin);
                    }
                }
                isEditingTimer = false;
                atualizarRelogio();
            }

            function cancelarEdicao() {
                if (isCommitted) return;
                isCommitted = true;
                isEditingTimer = false;
                atualizarRelogio();
            }

            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    salvarEdicao();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelarEdicao();
                }
            });

            input.addEventListener('blur', function () {
                setTimeout(salvarEdicao, 150);
            });
        }
    }
