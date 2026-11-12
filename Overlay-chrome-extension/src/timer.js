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
            mostrarOSD('🎯 Captured: ' + formatarTempoVideo(ct));
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
        timerUI.style.display = 'block';
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
        // Mark the button as permanently active (stays green until cleared).
        // Class + inline style together beat any host-page CSS override.
        const _kickoffBtn = q('omt-btn-set-kickoff');
        _kickoffBtn.classList.add('kickoff-set');
        _kickoffBtn.style.setProperty('background', '#00cc6a', 'important');
        _kickoffBtn.style.setProperty('color', '#000', 'important');
        _kickoffBtn.style.setProperty('opacity', '1', 'important');
        _kickoffBtn.style.setProperty('box-shadow', '0 0 14px rgba(0,255,136,0.5)', 'important');
        _kickoffBtn.style.setProperty('border', '1px solid rgba(0,255,136,0.4)', 'important');
        mostrarOSD('\u23f1 Timer Synced');
    }

    function limparTimer() {
        timerAtivo = false;
        timerUI.style.display = 'none';
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
        // Remove the active state from the kick-off button and clear inline overrides
        const _kickoffBtnClear = q('omt-btn-set-kickoff');
        _kickoffBtnClear.classList.remove('kickoff-set');
        _kickoffBtnClear.style.removeProperty('background');
        _kickoffBtnClear.style.removeProperty('color');
        _kickoffBtnClear.style.removeProperty('opacity');
        _kickoffBtnClear.style.removeProperty('box-shadow');
        _kickoffBtnClear.style.removeProperty('border');
        mostrarOSD('\u2715 Timer Cleared');
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
            mostrarOSD(`↪️ Jumped to Min ${minutoAlvo}`);
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
