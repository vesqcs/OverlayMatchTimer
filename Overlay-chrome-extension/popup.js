(function () {
  'use strict';

  const KEYS = {
    clockPos: 'omtClockPosition',
    clockSize: 'omtClockSize',
    clockShape: 'omtClockShape',
    clockCustom: 'omtClockCustomOffset',
    hotkeys: 'omtHotkeys',
    shuttlePrefs: 'omtShuttlePrefs',
    autoPauseOnBlur: 'omtAutoPauseOnBlur'
  };

  const HOTKEY_DEFAULTS = {
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
  const HOTKEY_ORDER = Object.keys(HOTKEY_DEFAULTS);

  const SHUTTLE_DEFAULTS = {
    skipBtn1: 120,
    skipBtn2: 10,
    skipBtn4: 10,
    skipBtn5: 120,
    playPauseBtn: 3,
    jogStep: 0.04,
    shuttleScale: 1
  };

  const SHUTTLE_DIAGRAM_SVG = `<svg class="omt-shuttle-svg" viewBox="0 0 200 200" role="img" aria-label="Contour ShuttleXpress">
  <!-- Hand-built outline from Vasco foto.png + Contour product geometry -->
  <g class="omt-sx-root">
    <circle class="omt-sx-body" cx="100" cy="100" r="78"/>
    <g class="omt-sx-part" data-part="ring" tabindex="-1" role="button" aria-label="Ring">
      <circle cx="100" cy="100" r="51"/>
      <circle cx="100" cy="100" r="33"/>
      <g class="omt-sx-ticks"><line x1="100.0" y1="64.5" x2="100.0" y2="51.5"/><line x1="106.2" y1="65.0" x2="108.4" y2="52.2"/><line x1="112.1" y1="66.6" x2="116.6" y2="54.4"/><line x1="117.8" y1="69.3" x2="124.2" y2="58.0"/><line x1="122.8" y1="72.8" x2="131.2" y2="62.8"/><line x1="127.2" y1="77.2" x2="137.2" y2="68.8"/><line x1="130.7" y1="82.2" x2="142.0" y2="75.8"/><line x1="133.4" y1="87.9" x2="145.6" y2="83.4"/><line x1="135.0" y1="93.8" x2="147.8" y2="91.6"/><line x1="135.5" y1="100.0" x2="148.5" y2="100.0"/><line x1="135.0" y1="106.2" x2="147.8" y2="108.4"/><line x1="133.4" y1="112.1" x2="145.6" y2="116.6"/><line x1="130.7" y1="117.8" x2="142.0" y2="124.2"/><line x1="127.2" y1="122.8" x2="137.2" y2="131.2"/><line x1="122.8" y1="127.2" x2="131.2" y2="137.2"/><line x1="117.8" y1="130.7" x2="124.2" y2="142.0"/><line x1="112.1" y1="133.4" x2="116.6" y2="145.6"/><line x1="106.2" y1="135.0" x2="108.4" y2="147.8"/><line x1="100.0" y1="135.5" x2="100.0" y2="148.5"/><line x1="93.8" y1="135.0" x2="91.6" y2="147.8"/><line x1="87.9" y1="133.4" x2="83.4" y2="145.6"/><line x1="82.2" y1="130.7" x2="75.8" y2="142.0"/><line x1="77.2" y1="127.2" x2="68.8" y2="137.2"/><line x1="72.8" y1="122.8" x2="62.8" y2="131.2"/><line x1="69.3" y1="117.8" x2="58.0" y2="124.2"/><line x1="66.6" y1="112.1" x2="54.4" y2="116.6"/><line x1="65.0" y1="106.2" x2="52.2" y2="108.4"/><line x1="64.5" y1="100.0" x2="51.5" y2="100.0"/><line x1="65.0" y1="93.8" x2="52.2" y2="91.6"/><line x1="66.6" y1="87.9" x2="54.4" y2="83.4"/><line x1="69.3" y1="82.2" x2="58.0" y2="75.8"/><line x1="72.8" y1="77.2" x2="62.8" y2="68.8"/><line x1="77.2" y1="72.8" x2="68.8" y2="62.8"/><line x1="82.2" y1="69.3" x2="75.7" y2="58.0"/><line x1="87.9" y1="66.6" x2="83.4" y2="54.4"/><line x1="93.8" y1="65.0" x2="91.6" y2="52.2"/></g>
    </g>
    <g class="omt-sx-part" data-part="jog" tabindex="-1" role="button" aria-label="Jog">
      <circle cx="100" cy="100" r="29"/>
      <circle class="omt-sx-dimple" cx="90.5" cy="94.5" r="4.2"/>
    </g>
    <path class="omt-sx-part omt-sx-btn" data-part="btn1" tabindex="-1" role="button" aria-label="Button 1" d="M27.12,112.85 A74,74 0 0,1 39.38,57.56 L54.95,68.45 A55,55 0 0,0 45.84,109.55 Z"/>
    <path class="omt-sx-part omt-sx-btn" data-part="btn2" tabindex="-1" role="button" aria-label="Button 2" d="M45.88,49.53 A74,74 0 0,1 77.13,29.62 L83.00,47.69 A55,55 0 0,0 59.78,62.49 Z"/>
    <path class="omt-sx-part omt-sx-btn" data-part="btn3" tabindex="-1" role="button" aria-label="Button 3" d="M87.15,27.12 A74,74 0 0,1 137.00,35.91 L127.50,52.37 A55,55 0 0,0 90.45,45.84 Z"/>
    <path class="omt-sx-part omt-sx-btn" data-part="btn4" tabindex="-1" role="button" aria-label="Button 4" d="M145.56,41.69 A74,74 0 0,1 168.12,71.09 L150.63,78.51 A55,55 0 0,0 133.86,56.66 Z"/>
    <path class="omt-sx-part omt-sx-btn" data-part="btn5" tabindex="-1" role="button" aria-label="Button 5" d="M160.62,57.56 A74,74 0 0,1 172.88,112.85 L154.16,109.55 A55,55 0 0,0 145.05,68.45 Z"/>
    <text class="omt-sx-num" data-part="btn1" x="21.4" y="82.6" text-anchor="middle" dominant-baseline="central">1</text>
    <text class="omt-sx-num" data-part="btn2" x="56.7" y="32.1" text-anchor="middle" dominant-baseline="central">2</text>
    <text class="omt-sx-num" data-part="btn3" x="114.0" y="20.7" text-anchor="middle" dominant-baseline="central">3</text>
    <text class="omt-sx-num" data-part="btn4" x="163.9" y="51.0" text-anchor="middle" dominant-baseline="central">4</text>
    <text class="omt-sx-num" data-part="btn5" x="178.6" y="82.6" text-anchor="middle" dominant-baseline="central">5</text>
    <text class="omt-sx-label" data-part="btn1" x="37.0" y="86.0" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label" data-part="btn2" x="65.3" y="45.6" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label" data-part="btn3" x="111.2" y="36.5" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label" data-part="btn4" x="151.2" y="60.7" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label" data-part="btn5" x="163.0" y="86.0" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label" data-part="ring" x="100.0" y="142.0" text-anchor="middle" dominant-baseline="central">Speed</text>
    <text class="omt-sx-label" data-part="jog" x="100" y="101" text-anchor="middle" dominant-baseline="central">Frame</text>
    <text class="omt-sx-brand" x="100" y="170" text-anchor="middle">ShuttleXpress</text>
  </g>
</svg>`;

  let hotkeys = null;
  let shuttlePrefs = null;
  let listeningId = null;

  const clockPos = document.getElementById('clock-pos');
  const clockSize = document.getElementById('clock-size');
  const clockShape = document.getElementById('clock-shape');
  const autoPause = document.getElementById('omt-auto-pause-blur');
  const previewStage = document.getElementById('omt-clock-preview-stage');
  const previewFace = document.getElementById('omt-clock-preview-face');

  function normalizeKey(key) {
    if (key == null) return '';
    if (key === ' ') return ' ';
    return String(key).toLowerCase();
  }

  function mergeHotkeys(stored) {
    const out = {};
    HOTKEY_ORDER.forEach((id) => {
      const def = HOTKEY_DEFAULTS[id];
      const raw = stored && stored[id];
      out[id] = raw && raw.key != null
        ? {
            key: normalizeKey(raw.key),
            ctrl: !!raw.ctrl,
            shift: !!raw.shift,
            alt: !!raw.alt,
            meta: !!raw.meta,
            label: def.label
          }
        : {
            key: def.key,
            ctrl: !!def.ctrl,
            shift: !!def.shift,
            alt: !!def.alt,
            meta: !!def.meta,
            label: def.label
          };
    });
    return out;
  }

  function mergeShuttle(stored) {
    const out = Object.assign({}, SHUTTLE_DEFAULTS);
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

  function formatBinding(b) {
    if (!b) return '—';
    const parts = [];
    if (b.ctrl) parts.push('Ctrl');
    if (b.alt) parts.push('Alt');
    if (b.shift) parts.push('Shift');
    if (b.meta) parts.push('Meta');
    let k = b.key;
    if (k === ' ') k = 'Space';
    else if (k === 'arrowleft') k = '←';
    else if (k === 'arrowright') k = '→';
    else if (k === 'arrowup') k = '↑';
    else if (k === 'arrowdown') k = '↓';
    else k = String(k).length === 1 ? String(k).toUpperCase() : String(k);
    parts.push(k);
    return parts.join('+');
  }

  function bindingEqual(a, b) {
    if (!a || !b) return false;
    return normalizeKey(a.key) === normalizeKey(b.key) &&
      !!a.ctrl === !!b.ctrl &&
      !!a.shift === !!b.shift &&
      !!a.alt === !!b.alt &&
      !!a.meta === !!b.meta;
  }

  function findConflicts(map) {
    const conflicts = {};
    HOTKEY_ORDER.forEach((id) => { conflicts[id] = null; });
    for (let i = 0; i < HOTKEY_ORDER.length; i++) {
      for (let j = i + 1; j < HOTKEY_ORDER.length; j++) {
        const a = HOTKEY_ORDER[i];
        const b = HOTKEY_ORDER[j];
        if (bindingEqual(map[a], map[b])) {
          conflicts[a] = b;
          conflicts[b] = a;
        }
      }
    }
    return conflicts;
  }

  function saveHotkeys() {
    const payload = {};
    HOTKEY_ORDER.forEach((id) => {
      const b = hotkeys[id];
      payload[id] = { key: b.key, ctrl: !!b.ctrl, shift: !!b.shift, alt: !!b.alt, meta: !!b.meta };
    });
    chrome.storage.local.set({ [KEYS.hotkeys]: payload });
  }

  function saveShuttle() {
    chrome.storage.local.set({ [KEYS.shuttlePrefs]: Object.assign({}, shuttlePrefs) });
  }

  function updateClockPreview() {
    if (!previewStage || !previewFace) return;
    previewStage.className = 'omt-clock-preview-stage pos-' + (clockPos.value || 'top-left');
    previewFace.className = 'omt-clock-preview-face size-' + (clockSize.value || 'medium') +
      ' style-' + (clockShape.value || 'rounded');
  }

  function renderGeneralShortcuts() {
    const host = document.getElementById('omt-shortcut-list');
    if (!host || !hotkeys) return;
    host.innerHTML = HOTKEY_ORDER.map((id) => {
      const b = hotkeys[id];
      return '<div class="shortcut-item"><span class="shortcut-label">' + b.label +
        '</span><span class="shortcut-keys"><kbd>' + formatBinding(b).replace(/\+/g, '</kbd><kbd>') +
        '</kbd></span></div>';
    }).join('');
  }

  function formatSkipLabel(secs) {
    if (secs >= 60 && secs % 60 === 0) return (secs / 60) + 'm';
    return secs + 's';
  }

  function buttonActionLabel(btn) {
    if (!shuttlePrefs) return '—';
    if (btn === shuttlePrefs.playPauseBtn) return 'Play/Pause';
    const key = 'skipBtn' + btn;
    const secs = shuttlePrefs[key];
    if (!Number.isFinite(secs)) return '—';
    const sign = (btn === 1 || btn === 2) ? '−' : '+';
    return sign + formatSkipLabel(secs);
  }

  function mountShuttleDiagrams() {
    const general = document.getElementById('omt-shuttle-summary-diagram');
    const edit = document.getElementById('omt-shuttle-diagram-wrap');
    if (general && !general.querySelector('.omt-shuttle-svg')) {
      general.innerHTML = SHUTTLE_DIAGRAM_SVG;
      const svg = general.querySelector('.omt-shuttle-svg');
      if (svg) {
        svg.classList.add('omt-shuttle-svg--readonly');
        svg.removeAttribute('id');
      }
    }
    if (edit && !edit.querySelector('.omt-shuttle-svg')) {
      edit.innerHTML = SHUTTLE_DIAGRAM_SVG;
      const svg = edit.querySelector('.omt-shuttle-svg');
      if (svg) {
        svg.id = 'omt-shuttle-svg';
        svg.classList.add('omt-shuttle-svg--edit');
      }
    }
  }

  function updateShuttleDiagramLabels() {
    if (!shuttlePrefs) return;
    const labels = {
      btn1: buttonActionLabel(1),
      btn2: buttonActionLabel(2),
      btn3: buttonActionLabel(3),
      btn4: buttonActionLabel(4),
      btn5: buttonActionLabel(5),
      ring: 'Speed',
      jog: 'Frame'
    };
    document.querySelectorAll('.omt-sx-label[data-part]').forEach((el) => {
      const part = el.getAttribute('data-part');
      if (labels[part] != null) el.textContent = labels[part];
    });
  }

  function renderGeneralShuttle() {
    mountShuttleDiagrams();
    updateShuttleDiagramLabels();
    const host = document.getElementById('omt-shuttle-summary-list');
    if (!host || !shuttlePrefs) return;
    const pp = shuttlePrefs.playPauseBtn;
    const rows = [];
    for (let i = 1; i <= 5; i++) {
      if (i === pp) {
        rows.push(['Btn ' + i, 'Play / Pause']);
      } else {
        const key = 'skipBtn' + i;
        const secs = shuttlePrefs[key];
        const sign = (i === 1 || i === 2) ? '−' : '+';
        rows.push(['Btn ' + i, 'Skip ' + sign + formatSkipLabel(secs)]);
      }
    }
    rows.push(['Jog', shuttlePrefs.jogStep + 's / tick']);
    rows.push(['Ring', shuttlePrefs.shuttleScale + '× scrub (7 steps)']);
    host.innerHTML = rows.map(([a, b]) =>
      '<div class="shortcut-item"><span class="shortcut-label">' + a +
      '</span><span class="shortcut-keys">' + b + '</span></div>'
    ).join('');
  }

  function resolveShuttlePartFromRow(row) {
    if (!row) return null;
    if (row.querySelector('#omt-sx-playpause')) {
      return 'btn' + (shuttlePrefs ? shuttlePrefs.playPauseBtn : 3);
    }
    return row.getAttribute('data-part');
  }

  function focusShuttlePart(part) {
    if (!part) return;
    setShuttleHighlight(part);
    let row = null;
    if (/^btn[1-5]$/.test(part)) {
      const n = Number(part.slice(3));
      if (shuttlePrefs && n === shuttlePrefs.playPauseBtn) {
        row = document.querySelector('#omt-sx-playpause') &&
          document.querySelector('#omt-sx-playpause').closest('.omt-shuttle-row');
      } else {
        row = document.querySelector('.omt-shuttle-row[data-part="' + part + '"]');
      }
    } else {
      row = document.querySelector('.omt-shuttle-row[data-part="' + part + '"]');
    }
    if (!row) return;
    const focusable = row.querySelector('input, select');
    if (focusable) focusable.focus({ preventScroll: true });
  }

  function renderHotkeyEditor() {
    const host = document.getElementById('omt-hotkey-editor');
    if (!host || !hotkeys) return;
    const conflicts = findConflicts(hotkeys);
    host.innerHTML = HOTKEY_ORDER.map((id) => {
      const b = hotkeys[id];
      const conflict = conflicts[id];
      const listening = listeningId === id;
      const cls = 'omt-hotkey-bind' +
        (listening ? ' is-listening' : '') +
        (conflict ? ' has-conflict' : '');
      const warn = conflict
        ? '<div class="omt-hotkey-warn">Conflicts with ' + hotkeys[conflict].label + '</div>'
        : '';
      return '<div class="omt-hotkey-row" data-id="' + id + '">' +
        '<span>' + b.label + '</span>' +
        '<button type="button" class="' + cls + '" data-bind="' + id + '">' +
        (listening ? 'Press key…' : formatBinding(b)) + '</button>' +
        '<button type="button" class="omt-btn-tiny" data-reset-hotkey="' + id + '">Reset</button>' +
        warn + '</div>';
    }).join('');
  }

  function fillShuttleForm() {
    if (!shuttlePrefs) return;
    const s1 = document.getElementById('omt-sx-skip1');
    const s2 = document.getElementById('omt-sx-skip2');
    const s4 = document.getElementById('omt-sx-skip4');
    const s5 = document.getElementById('omt-sx-skip5');
    const pp = document.getElementById('omt-sx-playpause');
    const jog = document.getElementById('omt-sx-jog');
    const scale = document.getElementById('omt-sx-scale');
    if (s1) s1.value = shuttlePrefs.skipBtn1;
    if (s2) s2.value = shuttlePrefs.skipBtn2;
    if (s4) s4.value = shuttlePrefs.skipBtn4;
    if (s5) s5.value = shuttlePrefs.skipBtn5;
    if (pp) pp.value = String(shuttlePrefs.playPauseBtn);
    if (jog) jog.value = String(shuttlePrefs.jogStep);
    if (scale) scale.value = String(shuttlePrefs.shuttleScale);
  }

  function setShuttleHighlight(part) {
    document.querySelectorAll('.omt-sx-part, .omt-sx-num, .omt-sx-label').forEach((el) => {
      const match = !!part && el.getAttribute('data-part') === part;
      el.classList.toggle('is-active', match);
      el.classList.toggle('is-hover', false);
    });
    document.querySelectorAll('.omt-shuttle-row').forEach((row) => {
      const rowPart = resolveShuttlePartFromRow(row);
      row.classList.toggle('is-active', !!part && rowPart === part);
    });
  }

  function setShuttleHover(part) {
    document.querySelectorAll('.omt-sx-part, .omt-sx-num, .omt-sx-label').forEach((el) => {
      const match = !!part && el.getAttribute('data-part') === part;
      if (!el.classList.contains('is-active')) el.classList.toggle('is-hover', match);
    });
  }

  function refreshAll() {
    mountShuttleDiagrams();
    updateClockPreview();
    renderGeneralShortcuts();
    renderGeneralShuttle();
    renderHotkeyEditor();
    fillShuttleForm();
    updateShuttleDiagramLabels();
  }

  chrome.storage.local.get(
    {
      [KEYS.clockPos]: 'top-left',
      [KEYS.clockSize]: 'medium',
      [KEYS.clockShape]: 'rounded',
      [KEYS.hotkeys]: null,
      [KEYS.shuttlePrefs]: null,
      [KEYS.autoPauseOnBlur]: false
    },
    (result) => {
      clockPos.value = result[KEYS.clockPos] || 'top-left';
      clockSize.value = result[KEYS.clockSize] || 'medium';
      clockShape.value = result[KEYS.clockShape] || 'rounded';
      if (autoPause) autoPause.checked = !!result[KEYS.autoPauseOnBlur];
      hotkeys = mergeHotkeys(result[KEYS.hotkeys]);
      shuttlePrefs = mergeShuttle(result[KEYS.shuttlePrefs]);
      refreshAll();
    }
  );

  if (autoPause) {
    autoPause.addEventListener('change', () => {
      chrome.storage.local.set({ [KEYS.autoPauseOnBlur]: !!autoPause.checked });
    });
  }

  const openLocal = document.getElementById('omt-open-local-player');
  if (openLocal) {
    openLocal.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('player.html') });
    });
  }

  document.querySelectorAll('.omt-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.getAttribute('data-tab');
      document.querySelectorAll('.omt-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      document.querySelectorAll('.omt-pane').forEach((p) => {
        p.classList.toggle('is-active', p.getAttribute('data-pane') === id);
      });
    });
  });

  function persistClock() {
    chrome.storage.local.set({
      [KEYS.clockPos]: clockPos.value,
      [KEYS.clockSize]: clockSize.value,
      [KEYS.clockShape]: clockShape.value
    });
    updateClockPreview();
  }
  clockPos.addEventListener('change', persistClock);
  clockSize.addEventListener('change', persistClock);
  clockShape.addEventListener('change', persistClock);

  document.getElementById('omt-clock-reset-pos').addEventListener('click', () => {
    chrome.storage.local.set({ [KEYS.clockCustom]: null });
  });

  document.getElementById('omt-hotkey-editor').addEventListener('click', (e) => {
    const resetBtn = e.target.closest('[data-reset-hotkey]');
    if (resetBtn) {
      const id = resetBtn.getAttribute('data-reset-hotkey');
      const def = HOTKEY_DEFAULTS[id];
      hotkeys[id] = {
        key: def.key, ctrl: !!def.ctrl, shift: !!def.shift, alt: !!def.alt, meta: !!def.meta, label: def.label
      };
      listeningId = null;
      saveHotkeys();
      refreshAll();
      return;
    }
    const bindBtn = e.target.closest('[data-bind]');
    if (bindBtn) {
      listeningId = bindBtn.getAttribute('data-bind');
      renderHotkeyEditor();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!listeningId) return;
    e.preventDefault();
    e.stopPropagation();
    const key = normalizeKey(e.key);
    if (!key || key === 'escape') {
      listeningId = null;
      renderHotkeyEditor();
      return;
    }
    if (key === 'shift' || key === 'control' || key === 'alt' || key === 'meta' || key === 'tab') return;
    hotkeys[listeningId] = {
      key,
      ctrl: !!e.ctrlKey,
      shift: !!e.shiftKey,
      alt: !!e.altKey,
      meta: !!e.metaKey,
      label: HOTKEY_DEFAULTS[listeningId].label
    };
    listeningId = null;
    saveHotkeys();
    refreshAll();
  }, true);

  document.getElementById('omt-hotkeys-reset-all').addEventListener('click', () => {
    hotkeys = mergeHotkeys(null);
    chrome.storage.local.set({ [KEYS.hotkeys]: null });
    refreshAll();
  });

  function readShuttleFromForm() {
    shuttlePrefs = mergeShuttle({
      skipBtn1: Number(document.getElementById('omt-sx-skip1').value),
      skipBtn2: Number(document.getElementById('omt-sx-skip2').value),
      skipBtn4: Number(document.getElementById('omt-sx-skip4').value),
      skipBtn5: Number(document.getElementById('omt-sx-skip5').value),
      playPauseBtn: Number(document.getElementById('omt-sx-playpause').value),
      jogStep: Number(document.getElementById('omt-sx-jog').value),
      shuttleScale: Number(document.getElementById('omt-sx-scale').value)
    });
    saveShuttle();
    renderGeneralShuttle();
    updateShuttleDiagramLabels();
  }

  document.getElementById('omt-shuttle-edit-list').addEventListener('change', (e) => {
    if (e.target.matches('input, select')) readShuttleFromForm();
  });
  document.getElementById('omt-shuttle-edit-list').addEventListener('input', (e) => {
    if (e.target.matches('input[type="number"]')) readShuttleFromForm();
  });
  document.getElementById('omt-shuttle-edit-list').addEventListener('focusin', (e) => {
    const row = e.target.closest('.omt-shuttle-row');
    if (row) setShuttleHighlight(resolveShuttlePartFromRow(row));
  });
  document.getElementById('omt-shuttle-edit-list').addEventListener('mouseover', (e) => {
    const row = e.target.closest('.omt-shuttle-row');
    if (row) setShuttleHover(resolveShuttlePartFromRow(row));
  });
  document.getElementById('omt-shuttle-edit-list').addEventListener('mouseout', (e) => {
    const row = e.target.closest('.omt-shuttle-row');
    if (row) setShuttleHover(null);
  });
  document.getElementById('omt-shuttle-edit-list').addEventListener('click', (e) => {
    const resetBtn = e.target.closest('[data-reset]');
    if (!resetBtn) return;
    const key = resetBtn.getAttribute('data-reset');
    shuttlePrefs[key] = SHUTTLE_DEFAULTS[key];
    fillShuttleForm();
    saveShuttle();
    renderGeneralShuttle();
    updateShuttleDiagramLabels();
    const partMap = {
      skipBtn1: 'btn1', skipBtn2: 'btn2', skipBtn4: 'btn4', skipBtn5: 'btn5',
      playPauseBtn: 'btn' + shuttlePrefs.playPauseBtn,
      jogStep: 'jog', shuttleScale: 'ring'
    };
    setShuttleHighlight(partMap[key] || null);
  });


  const diagramWrap = document.getElementById('omt-shuttle-diagram-wrap');
  if (diagramWrap) {
    diagramWrap.addEventListener('click', (e) => {
      const hit = e.target.closest('[data-part]');
      if (!hit || !diagramWrap.contains(hit)) return;
      const part = hit.getAttribute('data-part');
      if (!part || !/^(btn[1-5]|jog|ring)$/.test(part)) return;
      focusShuttlePart(part);
    });
    diagramWrap.addEventListener('mouseover', (e) => {
      const hit = e.target.closest('.omt-sx-part[data-part]');
      if (!hit || !diagramWrap.contains(hit)) return;
      setShuttleHover(hit.getAttribute('data-part'));
    });
    diagramWrap.addEventListener('mouseout', (e) => {
      const hit = e.target.closest('.omt-sx-part[data-part]');
      if (!hit || !diagramWrap.contains(hit)) return;
      setShuttleHover(null);
    });
  }

  document.getElementById('omt-sx-reset-all').addEventListener('click', () => {
    shuttlePrefs = mergeShuttle(null);
    chrome.storage.local.set({ [KEYS.shuttlePrefs]: null });
    fillShuttleForm();
    renderGeneralShuttle();
    updateShuttleDiagramLabels();
    setShuttleHighlight(null);
  });

  document.getElementById('omt-reset-all-custom').addEventListener('click', () => {
    if (!confirm('Reset all customizations (clock, shortcuts, ShuttleXpress) to defaults?')) return;
    clockPos.value = 'top-left';
    clockSize.value = 'medium';
    clockShape.value = 'rounded';
    hotkeys = mergeHotkeys(null);
    shuttlePrefs = mergeShuttle(null);
    chrome.storage.local.set({
      [KEYS.clockPos]: 'top-left',
      [KEYS.clockSize]: 'medium',
      [KEYS.clockShape]: 'rounded',
      [KEYS.clockCustom]: null,
      [KEYS.hotkeys]: null,
      [KEYS.shuttlePrefs]: null
    });
    refreshAll();
    setShuttleHighlight(null);
  });
})();
