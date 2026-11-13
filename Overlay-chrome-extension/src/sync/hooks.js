/* MAIN-world kickoff sync hooks.
 * Fully inert when OMT_SYNC_FEATURE_ENABLED is false (no listeners, no posts).
 * Prototype user-config path remains for internal flag-on builds only.
 * Planned always-on design: see ARCHITECTURE.md / supabase/SETUP.md (not implemented).
 */
    let _omtSyncStarted = false;
    let _omtSyncApplying = false;
    let _omtSyncLastRemoteAt = 0;
    let _omtSyncClientId = null;

    function omtSyncClientId() {
        if (!omtSyncFeatureOn()) return 'c_off';
        if (_omtSyncClientId) return _omtSyncClientId;
        try {
            let id = sessionStorage.getItem('omtSyncClientId');
            if (!id) {
                id = 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
                sessionStorage.setItem('omtSyncClientId', id);
            }
            _omtSyncClientId = id;
        } catch (_) {
            _omtSyncClientId = 'c_anon';
        }
        return _omtSyncClientId;
    }

    function omtSyncPostToBridge(type, payload) {
        if (!omtSyncFeatureOn()) return;
        if (typeof omtSyncIsEnabled !== 'function' || !omtSyncIsEnabled()) return;
        if (typeof omtSyncHasCredentials === 'function' && !omtSyncHasCredentials()) return;
        try {
            window.postMessage({
                source: 'omt-page',
                type: type,
                payload: payload || {}
            }, '*');
        } catch (_) {}
    }

    function omtSyncCollectRow() {
        const c1El = typeof q === 'function' ? q('omt-custom-minute-c1') : null;
        const c2El = typeof q === 'function' ? q('omt-custom-minute-c2') : null;
        const halfEl = typeof q === 'function' ? q('omt-half-select') : null;
        return {
            match_key: omtSyncMatchKey(),
            kickoff1: kickoff1,
            kickoff2: kickoff2,
            kickoff_c1: kickoffC1,
            kickoff_c2: kickoffC2,
            custom_min_c1: c1El ? (c1El.value || null) : (localStorage.getItem('matchTimerCustomMinC1') || null),
            custom_min_c2: c2El ? (c2El.value || null) : (localStorage.getItem('matchTimerCustomMinC2') || null),
            half: halfEl ? halfEl.value : (localStorage.getItem('matchTimerHalf') || null),
            updated_at: new Date().toISOString(),
            client_id: omtSyncClientId()
        };
    }

    function omtSyncPublishKickoffs() {
        if (!omtSyncFeatureOn()) return;
        if (_omtSyncApplying) return;
        if (typeof omtSyncIsEnabled !== 'function' || !omtSyncIsEnabled()) return;
        if (typeof omtSyncHasCredentials === 'function' && !omtSyncHasCredentials()) return;
        const row = omtSyncCollectRow();
        if (!row.match_key) return;
        omtSyncPostToBridge('OMT_SYNC_PUSH', { row: row });
    }

    function omtSyncApplyRemote(row) {
        if (!omtSyncFeatureOn()) return;
        if (!row || typeof row !== 'object') return;
        if (row.client_id && row.client_id === omtSyncClientId()) return;
        const remoteAt = row.updated_at ? Date.parse(row.updated_at) : 0;
        if (remoteAt && remoteAt <= _omtSyncLastRemoteAt) return;
        if (remoteAt) _omtSyncLastRemoteAt = remoteAt;

        _omtSyncApplying = true;
        try {
            const setNum = (key, val) => {
                if (val === null || val === undefined || val === '') {
                    localStorage.removeItem(key);
                    return null;
                }
                const n = Number(val);
                if (!isFinite(n)) return null;
                localStorage.setItem(key, String(n));
                return n;
            };
            if (Object.prototype.hasOwnProperty.call(row, 'kickoff1')) {
                kickoff1 = setNum('matchTimerKickoff1', row.kickoff1);
            }
            if (Object.prototype.hasOwnProperty.call(row, 'kickoff2')) {
                kickoff2 = setNum('matchTimerKickoff2', row.kickoff2);
            }
            if (Object.prototype.hasOwnProperty.call(row, 'kickoff_c1')) {
                kickoffC1 = setNum('matchTimerKickoffC1', row.kickoff_c1);
            }
            if (Object.prototype.hasOwnProperty.call(row, 'kickoff_c2')) {
                kickoffC2 = setNum('matchTimerKickoffC2', row.kickoff_c2);
            }
            if (row.custom_min_c1 != null) {
                localStorage.setItem('matchTimerCustomMinC1', String(row.custom_min_c1));
                const el = typeof q === 'function' ? q('omt-custom-minute-c1') : null;
                if (el) el.value = String(row.custom_min_c1);
            }
            if (row.custom_min_c2 != null) {
                localStorage.setItem('matchTimerCustomMinC2', String(row.custom_min_c2));
                const el = typeof q === 'function' ? q('omt-custom-minute-c2') : null;
                if (el) el.value = String(row.custom_min_c2);
            }
            if (row.half) {
                localStorage.setItem('matchTimerHalf', String(row.half));
                previousHalf = String(row.half);
                const halfEl = typeof q === 'function' ? q('omt-half-select') : null;
                if (halfEl) halfEl.value = String(row.half);
            }

            const parte = previousHalf || (typeof q === 'function' && q('omt-half-select') && q('omt-half-select').value) || '1';
            const map = { '1': kickoff1, '2': kickoff2, 'custom1': kickoffC1, 'custom2': kickoffC2 };
            const activeKo = map[parte];
            if (activeKo != null && isFinite(Number(activeKo))) {
                offsetEmSegundos = Number(activeKo);
                localStorage.setItem('matchTimerOffset', offsetEmSegundos);
                if (!timerAtivo) {
                    timerAtivo = true;
                    localStorage.setItem('matchTimerAtivo', 'true');
                    if (timerUI) timerUI.style.display = 'block';
                    const wrap = typeof q === 'function' ? q('match-timer-wrap') : null;
                    if (wrap) wrap.style.display = 'flex';
                    if (omtRoot) omtRoot.classList.add('omt-timer-on');
                    const btn = typeof q === 'function' ? q('omt-btn-set-kickoff') : null;
                    if (btn) btn.classList.add('kickoff-set');
                    if (typeof esconderSetup === 'function') esconderSetup();
                }
            }

            if (typeof atualizarMarcadores === 'function') atualizarMarcadores();
            if (typeof atualizarRelogio === 'function') atualizarRelogio();
            if (typeof mostrarOSD === 'function') mostrarOSD('Kickoff synced');
        } finally {
            _omtSyncApplying = false;
        }
    }

    function omtKickoffSyncStart() {
        if (!omtSyncFeatureOn()) return;
        if (typeof omtSyncIsEnabled !== 'function' || !omtSyncIsEnabled()) {
            omtKickoffSyncStop();
            return;
        }
        if (typeof omtSyncHasCredentials === 'function' && !omtSyncHasCredentials()) {
            omtKickoffSyncStop();
            return;
        }
        _omtSyncStarted = true;
        const matchKey = omtSyncMatchKey();
        omtSyncPostToBridge('OMT_SYNC_PULL', { matchKey: matchKey });
        omtSyncPostToBridge('OMT_SYNC_START_POLL', { matchKey: matchKey, intervalMs: 4000 });
        omtSyncPublishKickoffs();
    }

    function omtKickoffSyncStop() {
        if (!omtSyncFeatureOn()) {
            _omtSyncStarted = false;
            return;
        }
        if (_omtSyncStarted) {
            try {
                window.postMessage({ source: 'omt-page', type: 'OMT_SYNC_STOP', payload: {} }, '*');
            } catch (_) {}
        }
        _omtSyncStarted = false;
    }

    // Listeners only when the internal feature flag is on.
    if (omtSyncFeatureOn()) {
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            const data = event.data;
            if (!data || data.source !== 'omt-e2e') return;
            if (data.type === 'OMT_E2E_SYNC_START') {
                omtKickoffSyncStart();
                return;
            }
            if (data.type === 'OMT_E2E_SYNC_PUBLISH') {
                omtSyncPublishKickoffs();
                return;
            }
            if (data.type === 'OMT_E2E_SYNC_PUSH_ROW' && data.row) {
                if (typeof omtSyncIsEnabled !== 'function' || !omtSyncIsEnabled()) return;
                if (typeof omtSyncHasCredentials === 'function' && !omtSyncHasCredentials()) return;
                omtSyncPostToBridge('OMT_SYNC_PUSH', { row: data.row });
            }
        });

        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            const data = event.data;
            if (!data || data.source !== 'omt-bridge') return;

            if (data.type === 'OMT_SYNC_REMOTE') {
                if (typeof omtSyncIsEnabled !== 'function' || !omtSyncIsEnabled()) return;
                omtSyncApplyRemote(data.row);
                return;
            }

            if (data.type !== 'OMT_STORAGE_SYNC') return;
            const values = data.values || {};
            let touched = false;
            Object.keys(OMT_SYNC_KEYS).forEach((k) => {
                const storageKey = OMT_SYNC_KEYS[k];
                if (!Object.prototype.hasOwnProperty.call(values, storageKey)) return;
                touched = true;
                try {
                    const v = values[storageKey];
                    if (v == null || v === '') localStorage.removeItem(storageKey);
                    else if (typeof v === 'boolean') localStorage.setItem(storageKey, v ? 'true' : 'false');
                    else localStorage.setItem(storageKey, String(v));
                } catch (_) {}
            });
            if (touched) {
                if (omtSyncIsEnabled() && omtSyncHasCredentials()) omtKickoffSyncStart();
                else omtKickoffSyncStop();
            }
        });
    }
