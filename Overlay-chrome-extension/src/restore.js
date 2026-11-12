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
        if (timerUI) timerUI.style.display = 'block';
        const wrap = q('match-timer-wrap');
        if (wrap) wrap.style.display = 'flex';
        if (omtRoot) omtRoot.classList.add('omt-timer-on');

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

        const _kickoffBtnRestore = q('omt-btn-set-kickoff');
        if (_kickoffBtnRestore) _kickoffBtnRestore.classList.add('kickoff-set');
        esconderSetup();
        mostrarOSD('Timer Restored');
    }
