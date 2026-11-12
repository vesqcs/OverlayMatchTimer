/* Restore kick-off / timer state from localStorage. */
    /* =========================================================
       17. RESTORE PERSISTED STATE AFTER PAGE LOAD
       ========================================================= */
    function restoreState() {
        const timerAtivoGuardado = localStorage.getItem('matchTimerAtivo');
        if (timerAtivoGuardado !== 'true') return;

        timerAtivo = true;
        offsetEmSegundos = parseFloat(localStorage.getItem('matchTimerOffset')) || 0;
        tempoBase = parseFloat(localStorage.getItem('matchTimerTempoBase')) || 0;
        timerUI.style.display = 'block';

        q('omt-sync-hr').value = localStorage.getItem('matchTimerSyncHr') || '';
        q('omt-sync-min').value = localStorage.getItem('matchTimerSyncMin') || '';
        q('omt-sync-sec').value = localStorage.getItem('matchTimerSyncSec') || '';

        const savedHalf = localStorage.getItem('matchTimerHalf');
        if (savedHalf) {
            q('omt-half-select').value = savedHalf;
            q('omt-custom-c1').style.display = (savedHalf === 'custom1') ? 'block' : 'none';
            q('omt-custom-c2').style.display = (savedHalf === 'custom2') ? 'block' : 'none';
        }

        const savedCMin1 = localStorage.getItem('matchTimerCustomMinC1');
        const savedCMin2 = localStorage.getItem('matchTimerCustomMinC2');
        if (savedCMin1) q('omt-custom-minute-c1').value = savedCMin1;
        if (savedCMin2) q('omt-custom-minute-c2').value = savedCMin2;

        // Restore the permanent active state on the kick-off button
        const _kickoffBtnRestore = q('omt-btn-set-kickoff');
        _kickoffBtnRestore.classList.add('kickoff-set');
        _kickoffBtnRestore.style.setProperty('background', '#00cc6a', 'important');
        _kickoffBtnRestore.style.setProperty('color', '#000', 'important');
        _kickoffBtnRestore.style.setProperty('opacity', '1', 'important');
        _kickoffBtnRestore.style.setProperty('box-shadow', '0 0 14px rgba(0,255,136,0.5)', 'important');
        _kickoffBtnRestore.style.setProperty('border', '1px solid rgba(0,255,136,0.4)', 'important');
        esconderSetup();
        mostrarOSD('\u23f1 Timer Restored');
    }
