/* Match-clock appearance + hotkey map (chrome.storage via bridge). */
    const OMT_HOTKEY_DEFAULTS = {
        playPause:   { key: ' ',         label: 'Play / Pause' },
        skipBack2:   { key: 'arrowleft', label: 'Skip −2s' },
        skipFwd2:    { key: 'arrowright', label: 'Skip +2s' },
        skipBack10:  { key: 'arrowleft', shift: true, label: 'Skip −10s' },
        skipFwd10:   { key: 'arrowright', shift: true, label: 'Skip +10s' },
        skipBack2m:  { key: 'arrowleft', ctrl: true, label: 'Skip −2m' },
        skipFwd2m:   { key: 'arrowright', ctrl: true, label: 'Skip +2m' },
        frameBack:   { key: 'arrowdown', label: 'Frame back' },
        frameFwd:    { key: 'arrowup', label: 'Frame forward' },
        speedDown:   { key: 'z', label: 'Speed down' },
        speedUp:     { key: 'c', label: 'Speed up' },
        speedReset:  { key: 'x', label: 'Speed 1.0×' },
        kickoff:     { key: 'k', label: 'Mark kick-off' },
        live:        { key: 'l', label: 'Go to Live' },
        hide:        { key: 'h', label: 'Hide/Show Controls' }
    };

    const OMT_HOTKEY_ORDER = [
        'playPause', 'skipBack2', 'skipFwd2', 'skipBack10', 'skipFwd10',
        'skipBack2m', 'skipFwd2m', 'frameBack', 'frameFwd',
        'speedDown', 'speedReset', 'speedUp', 'kickoff', 'live', 'hide'
    ];

    const OMT_SKIP_ACTION_DEFAULTS = {
        skipBack2: 2, skipFwd2: 2,
        skipBack10: 10, skipFwd10: 10,
        skipBack2m: 120, skipFwd2m: 120
    };
    const OMT_SKIP_ACTION_IDS = Object.keys(OMT_SKIP_ACTION_DEFAULTS);
    const OMT_SKIP_MIN = 1;
    const OMT_SKIP_MAX = 999;

    function omtClampSkipSeconds(n, fallback) {
        const v = Math.round(Number(n));
        if (!Number.isFinite(v)) return fallback;
        return Math.min(OMT_SKIP_MAX, Math.max(OMT_SKIP_MIN, v));
    }

    function omtFormatPanelSkipLabel(sec) {
        const s = omtClampSkipSeconds(sec, 0);
        if (s < 60) return s + ' s';
        const m = Math.floor(s / 60);
        const r = s % 60;
        if (r === 0) return m + ' min';
        return m + ':' + String(r).padStart(2, '0') + ' min';
    }

    function omtNormalizeSkipSecondsMap(raw) {
        const out = Object.assign({}, OMT_SKIP_ACTION_DEFAULTS);
        if (!raw || typeof raw !== 'object') return out;
        // Migrate v2.0.1 short/medium/long shape → per-action map.
        if (raw.short != null || raw.medium != null || raw.long != null) {
            const short = omtClampSkipSeconds(raw.short, 2);
            const medium = omtClampSkipSeconds(raw.medium, 10);
            const long = omtClampSkipSeconds(raw.long, 120);
            out.skipBack2 = short; out.skipFwd2 = short;
            out.skipBack10 = medium; out.skipFwd10 = medium;
            out.skipBack2m = long; out.skipFwd2m = long;
        }
        OMT_SKIP_ACTION_IDS.forEach((id) => {
            if (raw[id] != null) out[id] = omtClampSkipSeconds(raw[id], out[id]);
        });
        return out;
    }

    function omtReadSkipSeconds() {
        try {
            const raw = localStorage.getItem(OMT_STORAGE_KEYS.skipSeconds);
            if (raw) {
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                return omtNormalizeSkipSecondsMap(parsed);
            }
        } catch (_) {}
        return Object.assign({}, OMT_SKIP_ACTION_DEFAULTS);
    }

    function omtGetSkipForAction(actionId) {
        const map = omtReadSkipSeconds();
        if (Object.prototype.hasOwnProperty.call(map, actionId)) return map[actionId];
        return OMT_SKIP_ACTION_DEFAULTS[actionId] || 2;
    }

    /** Panel slots: [0]=smallest (next to play), [2]=largest (outer). */
    function omtSortedSkipSlots(side) {
        const ids = side === 'back'
            ? ['skipBack2', 'skipBack10', 'skipBack2m']
            : ['skipFwd2', 'skipFwd10', 'skipFwd2m'];
        return ids
            .map((id) => ({ id, sec: omtGetSkipForAction(id) }))
            .sort((a, b) => (a.sec - b.sec) || a.id.localeCompare(b.id));
    }

    function omtPanelSkipSeconds(side, slotIndex) {
        const slots = omtSortedSkipSlots(side);
        const row = slots[slotIndex];
        return row ? row.sec : 2;
    }

    // Shuttle Btn 1–5 defaults stay fixed (independent of Shortcuts skip seconds).
    function omtShuttleDefaultsFixed() {
        return {
            skipBtn1: 120,
            skipBtn2: 10,
            skipBtn3: 120,
            skipBtn4: 10,
            skipBtn5: 120,
            playPauseBtn: 3,
            centreSkipSign: 1,
            jogStep: 0.04,
            shuttleScale: 1
        };
    }

    const OMT_SHUTTLE_DEFAULTS = omtShuttleDefaultsFixed();

    function omtReadPanelPrefs() {
        let size = localStorage.getItem(OMT_STORAGE_KEYS.panelSize) || 'medium';
        if (size !== 'small' && size !== 'medium') size = 'medium';
        const compactRaw = localStorage.getItem(OMT_STORAGE_KEYS.panelCompact);
        const compact = compactRaw === 'true';
        return { size, compact };
    }

    function omtApplySkipButtonLabels() {
        if (!omtRoot) return;
        const back = omtSortedSkipSlots('back');
        const fwd = omtSortedSkipSlots('fwd');
        const map = [
            ['omt-m2', back[0].sec],
            ['omt-m10', back[1].sec],
            ['omt-m120', back[2].sec],
            ['omt-p2', fwd[0].sec],
            ['omt-p10', fwd[1].sec],
            ['omt-p120', fwd[2].sec]
        ];
        map.forEach(([id, sec]) => {
            const btn = typeof q === 'function' ? q(id) : document.getElementById(id);
            if (!btn) return;
            const label = btn.querySelector('.omt-btn-label');
            if (label) label.textContent = omtFormatPanelSkipLabel(sec);
        });
    }

    function omtApplyPanelAppearance() {
        if (!controlsPanel) return;
        const prefs = omtReadPanelPrefs();
        controlsPanel.classList.toggle('omt-panel-size-small', prefs.size === 'small');
        controlsPanel.classList.toggle('omt-panel-compact', !!prefs.compact);
        omtApplySkipButtonLabels();
        if (typeof omtAnchorControlsPanelBottom === 'function') {
            try { omtAnchorControlsPanelBottom(); } catch (_) {}
        } else if (typeof omtClampPanelInContainer === 'function' && omtRoot) {
            try { omtClampPanelInContainer(controlsPanel, omtRoot); } catch (_) {}
        }
        // Clamp restored / resized positions into the visible container (v2.3.5).
        if (typeof omtClampAllPanels === 'function') {
            try { omtClampAllPanels(); } catch (_) {}
        }
    }

    let omtHotkeyMap = null; // actionId → binding
    let omtShuttlePrefs = null;
    let omtClockClickInstalled = false;

    /** Allow re-bind after SPA teardown / UI reinject (same document). */
    function omtResetClockClickEditFlag() {
        omtClockClickInstalled = false;
    }

    const OMT_CLOCK_POSITIONS = [
        'top-left', 'top-centre', 'top-right',
        'bottom-left', 'bottom-centre', 'bottom-right'
    ];

    function omtNormalizeKey(key) {
        if (key == null) return '';
        const k = String(key);
        if (k === ' ') return ' ';
        return k.toLowerCase();
    }

    function omtBindingFromEvent(e) {
        const key = omtNormalizeKey(e.key);
        if (!key || key === 'escape' || key === 'tab' || key === 'shift' ||
            key === 'control' || key === 'alt' || key === 'meta') {
            return null;
        }
        return {
            key: key,
            ctrl: !!e.ctrlKey,
            shift: !!e.shiftKey,
            alt: !!e.altKey,
            meta: !!e.metaKey
        };
    }

    function omtBindingEqual(a, b) {
        if (!a || !b) return false;
        return omtNormalizeKey(a.key) === omtNormalizeKey(b.key) &&
            !!a.ctrl === !!b.ctrl &&
            !!a.shift === !!b.shift &&
            !!a.alt === !!b.alt &&
            !!a.meta === !!b.meta;
    }

    function omtBindingScore(b) {
        if (!b) return 0;
        return (!!b.ctrl ? 1 : 0) + (!!b.shift ? 1 : 0) + (!!b.alt ? 1 : 0) + (!!b.meta ? 1 : 0);
    }

    function omtMergeHotkeys(stored) {
        const out = {};
        OMT_HOTKEY_ORDER.forEach((id) => {
            const def = OMT_HOTKEY_DEFAULTS[id];
            const raw = stored && stored[id];
            if (raw && raw.key != null) {
                out[id] = {
                    key: omtNormalizeKey(raw.key),
                    ctrl: !!raw.ctrl,
                    shift: !!raw.shift,
                    alt: !!raw.alt,
                    meta: !!raw.meta,
                    label: def.label
                };
            } else {
                out[id] = {
                    key: def.key,
                    ctrl: !!def.ctrl,
                    shift: !!def.shift,
                    alt: !!def.alt,
                    meta: !!def.meta,
                    label: def.label
                };
            }
        });
        return out;
    }

    function omtLoadHotkeysFromLocal() {
        let stored = null;
        try {
            const raw = localStorage.getItem(OMT_STORAGE_KEYS.hotkeys);
            if (raw) stored = JSON.parse(raw);
        } catch (_) {}
        omtHotkeyMap = omtMergeHotkeys(stored);
        return omtHotkeyMap;
    }

    function omtGetHotkeys() {
        if (!omtHotkeyMap) omtLoadHotkeysFromLocal();
        return omtHotkeyMap;
    }

    function omtFindHotkeyAction(e) {
        const map = omtGetHotkeys();
        const evt = omtBindingFromEvent(e);
        if (!evt) return null;
        let best = null;
        let bestScore = -1;
        OMT_HOTKEY_ORDER.forEach((id) => {
            const b = map[id];
            if (!omtBindingEqual(b, evt)) return;
            const score = omtBindingScore(b);
            if (score > bestScore) {
                bestScore = score;
                best = id;
            }
        });
        return best;
    }

    function omtReadClockPrefs() {
        let pos = localStorage.getItem(OMT_STORAGE_KEYS.clockPos) || 'top-left';
        let size = localStorage.getItem(OMT_STORAGE_KEYS.clockSize) || 'medium';
        let shape = localStorage.getItem(OMT_STORAGE_KEYS.clockShape) || 'rounded';
        // Migrate removed custom drag offsets / unknown values → top-left
        if (pos === 'top-center') pos = 'top-centre';
        if (pos === 'bottom-center') pos = 'bottom-centre';
        if (!OMT_CLOCK_POSITIONS.includes(pos)) pos = 'top-left';
        if (!['small', 'medium', 'large', 'xlarge'].includes(size)) size = 'medium';
        if (!['rounded', 'pill', 'minimal'].includes(shape)) shape = 'rounded';
        return { pos, size, shape };
    }

    // One-shot migration only. Calling this on every storage sync used to
    // OMT_STORAGE_SET(null) → bridge onChanged → OMT_STORAGE_SYNC → apply
    // customize → clear again (postMessage storm). Examino's Shuttle chunk
    // treats each same-origin message without a known key as play/pause.
    let _omtClockCustomMigrated = false;
    function omtClearLegacyClockCustom() {
        let hadLocal = false;
        try {
            hadLocal = localStorage.getItem(OMT_STORAGE_KEYS.clockCustom) != null;
            localStorage.removeItem(OMT_STORAGE_KEYS.clockCustom);
        } catch (_) {}
        if (_omtClockCustomMigrated) return;
        _omtClockCustomMigrated = true;
        // Skip the bus when there was nothing local to clear — avoids a
        // null→sync→null loop when chrome.storage defaults include this key.
        if (!hadLocal) return;
        omtBusPost({
            source: 'omt-page',
            type: 'OMT_STORAGE_SET',
            key: OMT_STORAGE_KEYS.clockCustom,
            value: null
        });
    }

    function omtApplyClockAppearance() {
        const wrap = typeof q === 'function' ? q('match-timer-wrap') : document.getElementById('match-timer-wrap');
        if (!wrap || !omtRoot) return;
        const prefs = omtReadClockPrefs();
        const SIZE = ['small', 'medium', 'large', 'xlarge'];
        const STYLE = ['rounded', 'pill', 'minimal'];
        OMT_CLOCK_POSITIONS.concat(['custom']).forEach((p) => wrap.classList.remove('omt-clock-pos-' + p));
        SIZE.forEach((s) => wrap.classList.remove('omt-clock-size-' + s));
        STYLE.forEach((s) => wrap.classList.remove('omt-clock-style-' + s));
        wrap.classList.add('omt-clock-size-' + prefs.size);
        wrap.classList.add('omt-clock-style-' + prefs.shape);
        wrap.classList.add('omt-clock-pos-' + prefs.pos);
        wrap.style.top = '';
        wrap.style.left = '';
        wrap.style.right = '';
        wrap.style.bottom = '';
        wrap.style.transform = '';
        wrap.style.cursor = 'pointer';
        if (typeof omtUpdateClockPictureInset === 'function') omtUpdateClockPictureInset();
    }

    function omtInstallClockClickEdit() {
        if (omtClockClickInstalled) return;
        const wrap = typeof q === 'function' ? q('match-timer-wrap') : null;
        if (!wrap) return;
        omtClockClickInstalled = true;
        wrap.addEventListener('click', (e) => {
            if (e.target && e.target.closest && e.target.closest('input, select, button, a')) return;
            if (typeof isEditingTimer !== 'undefined' && isEditingTimer) return;
            if (typeof iniciarEdicaoTimer === 'function') iniciarEdicaoTimer();
        });
    }

    function omtPositionalSkipSign(btn) {
        if (btn === 1 || btn === 2) return -1;
        if (btn === 4 || btn === 5) return 1;
        return 1;
    }

    function omtSkipSignForButton(btn, prefs) {
        if (btn === 3) {
            const s = Number(prefs && prefs.centreSkipSign);
            return s < 0 ? -1 : 1;
        }
        return omtPositionalSkipSign(btn);
    }

    function omtMergeShuttlePrefs(stored) {
        const defaults = omtShuttleDefaultsFixed();
        const out = Object.assign({}, defaults);
        if (!stored || typeof stored !== 'object') return out;
        ['skipBtn1', 'skipBtn2', 'skipBtn3', 'skipBtn4', 'skipBtn5'].forEach((k) => {
            const n = Number(stored[k]);
            if (Number.isFinite(n) && n > 0 && n <= 600) out[k] = n;
        });
        const pp = Number(stored.playPauseBtn);
        if ([1, 2, 3, 4, 5].includes(pp)) out.playPauseBtn = pp;
        const cSign = Number(stored.centreSkipSign);
        if (cSign === -1 || cSign === 1) out.centreSkipSign = cSign;
        const jog = Number(stored.jogStep);
        if (Number.isFinite(jog) && jog > 0 && jog <= 1) out.jogStep = jog;
        const scale = Number(stored.shuttleScale);
        if (Number.isFinite(scale) && scale > 0 && scale <= 4) out.shuttleScale = scale;
        if (stored.skipBtn3 == null && out.playPauseBtn !== 3) {
            out.skipBtn3 = defaults.skipBtn3;
            out.centreSkipSign = omtPositionalSkipSign(out.playPauseBtn);
        }
        return out;
    }

    function omtLoadShuttlePrefsFromLocal() {
        let stored = null;
        try {
            const raw = localStorage.getItem(OMT_STORAGE_KEYS.shuttlePrefs);
            if (raw) stored = JSON.parse(raw);
        } catch (_) {}
        omtShuttlePrefs = omtMergeShuttlePrefs(stored);
        return omtShuttlePrefs;
    }

    function omtGetShuttlePrefs() {
        if (!omtShuttlePrefs) omtLoadShuttlePrefsFromLocal();
        return omtShuttlePrefs;
    }

    function omtApplyCustomizeFromStorage() {
        omtLoadHotkeysFromLocal();
        omtLoadShuttlePrefsFromLocal();
        omtClearLegacyClockCustom();
        omtApplyClockAppearance();
        omtApplyPanelAppearance();
        omtInstallClockClickEdit();
    }
