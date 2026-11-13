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
  <!-- Hand-built outline from Vasco foto.png — 2 tall sides + 3 top-arc -->
  <g class="omt-sx-root">
    <circle class="omt-sx-body" cx="100" cy="100" r="88"/>
    <g class="omt-sx-part" data-part="ring" tabindex="-1" role="button" aria-label="Ring">
      <circle cx="100" cy="100" r="53"/>
      <circle cx="100" cy="100" r="33"/>
      <g class="omt-sx-ticks"><line x1="100.0" y1="65.0" x2="100.0" y2="49.0"/><line x1="104.9" y1="65.3" x2="107.1" y2="49.5"/><line x1="109.6" y1="66.4" x2="114.1" y2="51.0"/><line x1="114.2" y1="68.0" x2="120.7" y2="53.4"/><line x1="118.5" y1="70.3" x2="127.0" y2="56.7"/><line x1="122.5" y1="73.2" x2="132.8" y2="60.9"/><line x1="126.0" y1="76.6" x2="137.9" y2="65.9"/><line x1="129.0" y1="80.4" x2="142.3" y2="71.5"/><line x1="131.5" y1="84.7" x2="145.8" y2="77.6"/><line x1="133.3" y1="89.2" x2="148.5" y2="84.2"/><line x1="134.5" y1="93.9" x2="150.2" y2="91.1"/><line x1="135.0" y1="98.8" x2="151.0" y2="98.2"/><line x1="134.8" y1="103.7" x2="150.7" y2="105.3"/><line x1="134.0" y1="108.5" x2="149.5" y2="112.3"/><line x1="132.5" y1="113.1" x2="147.3" y2="119.1"/><line x1="130.3" y1="117.5" x2="144.2" y2="125.5"/><line x1="127.6" y1="121.5" x2="140.2" y2="131.4"/><line x1="124.3" y1="125.2" x2="135.4" y2="136.7"/><line x1="120.6" y1="128.3" x2="130.0" y2="141.3"/><line x1="116.4" y1="130.9" x2="123.9" y2="145.0"/><line x1="112.0" y1="132.9" x2="117.4" y2="147.9"/><line x1="107.3" y1="134.2" x2="110.6" y2="149.9"/><line x1="102.4" y1="134.9" x2="103.6" y2="150.9"/><line x1="97.6" y1="134.9" x2="96.4" y2="150.9"/><line x1="92.7" y1="134.2" x2="89.4" y2="149.9"/><line x1="88.0" y1="132.9" x2="82.6" y2="147.9"/><line x1="83.6" y1="130.9" x2="76.1" y2="145.0"/><line x1="79.4" y1="128.3" x2="70.0" y2="141.3"/><line x1="75.7" y1="125.2" x2="64.6" y2="136.7"/><line x1="72.4" y1="121.5" x2="59.8" y2="131.4"/><line x1="69.7" y1="117.5" x2="55.8" y2="125.5"/><line x1="67.5" y1="113.1" x2="52.7" y2="119.1"/><line x1="66.0" y1="108.5" x2="50.5" y2="112.3"/><line x1="65.2" y1="103.7" x2="49.3" y2="105.3"/><line x1="65.0" y1="98.8" x2="49.0" y2="98.2"/><line x1="65.5" y1="93.9" x2="49.8" y2="91.1"/><line x1="66.7" y1="89.2" x2="51.5" y2="84.2"/><line x1="68.5" y1="84.7" x2="54.2" y2="77.6"/><line x1="71.0" y1="80.4" x2="57.7" y2="71.5"/><line x1="74.0" y1="76.6" x2="62.1" y2="65.9"/><line x1="77.5" y1="73.2" x2="67.2" y2="60.9"/><line x1="81.5" y1="70.3" x2="73.0" y2="56.7"/><line x1="85.8" y1="68.0" x2="79.3" y2="53.4"/><line x1="90.4" y1="66.4" x2="85.9" y2="51.0"/><line x1="95.1" y1="65.3" x2="92.9" y2="49.5"/></g>
    </g>
    <g class="omt-sx-part" data-part="jog" tabindex="-1" role="button" aria-label="Jog">
      <circle cx="100" cy="100" r="29.5"/>
      <circle class="omt-sx-dimple" cx="90.0" cy="94.2" r="4.6"/>
    </g>
    <path class="omt-sx-part omt-sx-btn" data-part="btn1" tabindex="-1" role="button" aria-label="Button 1" d="M33.81,151.72 A84,84 0 0,1 27.25,58.00 L50.64,71.50 A57,57 0 0,0 55.08,135.09 Z"/>
    <path class="omt-sx-part omt-sx-btn" data-part="btn2" tabindex="-1" role="button" aria-label="Button 2" d="M33.81,48.28 A84,84 0 0,1 65.83,23.26 L76.82,47.93 A57,57 0 0,0 55.08,64.91 Z"/>
    <path class="omt-sx-part omt-sx-btn" data-part="btn3" tabindex="-1" role="button" aria-label="Button 3" d="M74.04,20.11 A84,84 0 0,1 125.96,20.11 L117.61,45.79 A57,57 0 0,0 82.39,45.79 Z"/>
    <path class="omt-sx-part omt-sx-btn" data-part="btn4" tabindex="-1" role="button" aria-label="Button 4" d="M146.97,30.36 A84,84 0 0,1 174.17,60.56 L150.33,73.24 A57,57 0 0,0 131.87,52.74 Z"/>
    <path class="omt-sx-part omt-sx-btn" data-part="btn5" tabindex="-1" role="button" aria-label="Button 5" d="M172.75,58.00 A84,84 0 0,1 166.19,151.72 L144.92,135.09 A57,57 0 0,0 149.36,71.50 Z"/>
    <circle class="omt-sx-badge" data-part="btn1" cx="22.2" cy="105.4" r="4.4"/>
    <text class="omt-sx-num" data-part="btn1" x="22.2" y="105.4" text-anchor="middle" dominant-baseline="central">1</text>
    <circle class="omt-sx-badge" data-part="btn2" cx="52.0" cy="38.5" r="4.4"/>
    <text class="omt-sx-num" data-part="btn2" x="52.0" y="38.5" text-anchor="middle" dominant-baseline="central">2</text>
    <circle class="omt-sx-badge" data-part="btn3" cx="100.0" cy="22.0" r="4.4"/>
    <text class="omt-sx-num" data-part="btn3" x="100.0" y="22.0" text-anchor="middle" dominant-baseline="central">3</text>
    <circle class="omt-sx-badge" data-part="btn4" cx="158.0" cy="47.8" r="4.4"/>
    <text class="omt-sx-num" data-part="btn4" x="158.0" y="47.8" text-anchor="middle" dominant-baseline="central">4</text>
    <circle class="omt-sx-badge" data-part="btn5" cx="177.8" cy="105.4" r="4.4"/>
    <text class="omt-sx-num" data-part="btn5" x="177.8" y="105.4" text-anchor="middle" dominant-baseline="central">5</text>
    <text class="omt-sx-label" data-part="btn1" x="34.7" y="104.6" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label" data-part="btn2" x="59.7" y="48.4" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label" data-part="btn3" x="100.0" y="34.5" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label" data-part="btn4" x="148.7" y="56.2" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label" data-part="btn5" x="165.3" y="104.6" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label" data-part="ring" x="100.0" y="143.0" text-anchor="middle" dominant-baseline="central">Speed</text>
    <text class="omt-sx-label" data-part="jog" x="100" y="101" text-anchor="middle" dominant-baseline="central">Frame</text>
  </g>
</svg>`;

  const ICON_RESET =
    '<svg class="omt-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>'
    + '<path d="M3 3v5h5"/>'
    + '</svg>';

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

  function setSvgLabelText(el, text) {
    const x = el.getAttribute('x') || '0';
    if (text === 'Play/Pause') {
      el.textContent = '';
      const t1 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      t1.setAttribute('x', x);
      t1.setAttribute('dy', '-0.4em');
      t1.textContent = 'Play/';
      const t2 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      t2.setAttribute('x', x);
      t2.setAttribute('dy', '1.1em');
      t2.textContent = 'Pause';
      el.appendChild(t1);
      el.appendChild(t2);
      return;
    }
    el.textContent = text;
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
      if (labels[part] != null) setSvgLabelText(el, labels[part]);
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
      const dirty = !bindingEqual(b, {
        key: HOTKEY_DEFAULTS[id].key,
        ctrl: !!HOTKEY_DEFAULTS[id].ctrl,
        shift: !!HOTKEY_DEFAULTS[id].shift,
        alt: !!HOTKEY_DEFAULTS[id].alt,
        meta: !!HOTKEY_DEFAULTS[id].meta
      });
      return '<div class="omt-hotkey-row" data-id="' + id + '">' +
        '<span>' + b.label + '</span>' +
        '<button type="button" class="' + cls + '" data-bind="' + id + '">' +
        (listening ? 'Press key…' : formatBinding(b)) + '</button>' +
        '<button type="button" class="omt-btn-icon' + (dirty ? ' is-dirty' : '') +
        '" data-reset-hotkey="' + id + '" title="Reset to default" aria-label="Reset to default">' +
        ICON_RESET + '</button>' +
        warn + '</div>';
    }).join('');
  }


  function updateShuttleResetVisibility() {
    if (!shuttlePrefs) return;
    document.querySelectorAll('#omt-shuttle-edit-list [data-reset]').forEach((btn) => {
      const key = btn.getAttribute('data-reset');
      const dirty = shuttlePrefs[key] !== SHUTTLE_DEFAULTS[key];
      btn.classList.toggle('is-dirty', dirty);
    });
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
    updateShuttleResetVisibility();
  }

  function setShuttleHighlight(part) {
    document.querySelectorAll('.omt-sx-part, .omt-sx-num, .omt-sx-label, .omt-sx-badge').forEach((el) => {
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
    document.querySelectorAll('.omt-sx-part, .omt-sx-num, .omt-sx-label, .omt-sx-badge').forEach((el) => {
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
    updateShuttleResetVisibility();
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
