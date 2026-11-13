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

    const OMT_SHUTTLE_DEFAULTS = {
        skipBtn1: 120,   // outer left (−)
        skipBtn2: 10,    // inner left (−)
        skipBtn4: 10,    // inner right (+)
        skipBtn5: 120,   // outer right (+)
        playPauseBtn: 3, // centre button (1–5)
        jogStep: 0.04,   // seconds per jog tick (~1 frame @25fps)
        shuttleScale: 1  // multiplies ring scrub factors
    };

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

    function omtClearLegacyClockCustom() {
        try { localStorage.removeItem(OMT_STORAGE_KEYS.clockCustom); } catch (_) {}
        try {
            window.postMessage({
                source: 'omt-page',
                type: 'OMT_STORAGE_SET',
                key: OMT_STORAGE_KEYS.clockCustom,
                value: null
            }, '*');
        } catch (_) {}
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

    function omtMergeShuttlePrefs(stored) {
        const out = Object.assign({}, OMT_SHUTTLE_DEFAULTS);
        if (!stored || typeof stored !== 'object') return out;
        ['skipBtn1', 'skipBtn2', 'skipBtn4', 'skipBtn5'].forEach((k) => {
            const n = Number(stored[k]);
            if (Number.isFinite(n) && n > 0 && n <= 600) out[k] = n;
        });
        const pp = Number(stored.playPauseBtn);
        if ([1, 2, 3, 4, 5].includes(pp)) out.playPauseBtn = pp;
        const jog = Number(stored.jogStep);
        if (Number.isFinite(jog) && jog > 0 && jog <= 1) out.jogStep = jog;
        const scale = Number(stored.shuttleScale);
        if (Number.isFinite(scale) && scale > 0 && scale <= 4) out.shuttleScale = scale;
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
        omtInstallClockClickEdit();
    }
