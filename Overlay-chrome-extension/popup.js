(function () {
  'use strict';

  const KEYS = {
    clockPos: 'omtClockPosition',
    clockSize: 'omtClockSize',
    clockShape: 'omtClockShape',
    clockCustom: 'omtClockCustomOffset',
    hotkeys: 'omtHotkeys',
    shuttlePrefs: 'omtShuttlePrefs',
    autoPauseOnBlur: 'omtAutoPauseOnBlur',
    custSections: 'omtCustSectionsOpen'
  };

  const CUST_SECTION_DEFAULTS = { clock: true, hotkeys: false, shuttle: false };

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
  <!-- v1.6.2 outline: Vasco foto.png — centred btn3, mirrored 2/4 & 1/5, dimple at 12 o'clock -->
  <g class="omt-sx-root">
    <circle class="omt-sx-body" cx="100" cy="100" r="80"/>
    <g class="omt-sx-part" data-part="ring" tabindex="-1" role="button" aria-label="Shuttle ring">
      <circle cx="100" cy="100" r="49"/>
      <circle cx="100" cy="100" r="31"/>
      <g class="omt-sx-ticks"><line x1="100.0" y1="67.2" x2="100.0" y2="52.8"/><line x1="104.6" y1="67.5" x2="106.6" y2="53.3"/><line x1="109.0" y1="68.5" x2="113.0" y2="54.6"/><line x1="113.3" y1="70.0" x2="119.2" y2="56.9"/><line x1="117.4" y1="72.2" x2="125.0" y2="60.0"/><line x1="121.1" y1="74.9" x2="130.3" y2="63.8"/><line x1="124.4" y1="78.1" x2="135.1" y2="68.4"/><line x1="127.2" y1="81.7" x2="139.1" y2="73.6"/><line x1="129.5" y1="85.6" x2="142.4" y2="79.3"/><line x1="131.2" y1="89.9" x2="144.9" y2="85.4"/><line x1="132.3" y1="94.3" x2="146.5" y2="91.8"/><line x1="132.8" y1="98.9" x2="147.2" y2="98.4"/><line x1="132.6" y1="103.4" x2="146.9" y2="104.9"/><line x1="131.8" y1="107.9" x2="145.8" y2="111.4"/><line x1="130.4" y1="112.3" x2="143.8" y2="117.7"/><line x1="128.4" y1="116.4" x2="140.9" y2="123.6"/><line x1="125.8" y1="120.2" x2="137.2" y2="129.1"/><line x1="122.8" y1="123.6" x2="132.8" y2="134.0"/><line x1="119.3" y1="126.5" x2="127.7" y2="138.2"/><line x1="115.4" y1="129.0" x2="122.2" y2="141.7"/><line x1="111.2" y1="130.8" x2="116.1" y2="144.4"/><line x1="106.8" y1="132.1" x2="109.8" y2="146.2"/><line x1="102.3" y1="132.7" x2="103.3" y2="147.1"/><line x1="97.7" y1="132.7" x2="96.7" y2="147.1"/><line x1="93.2" y1="132.1" x2="90.2" y2="146.2"/><line x1="88.8" y1="130.8" x2="83.9" y2="144.4"/><line x1="84.6" y1="129.0" x2="77.8" y2="141.7"/><line x1="80.7" y1="126.5" x2="72.3" y2="138.2"/><line x1="77.2" y1="123.6" x2="67.2" y2="134.0"/><line x1="74.2" y1="120.2" x2="62.8" y2="129.1"/><line x1="71.6" y1="116.4" x2="59.1" y2="123.6"/><line x1="69.6" y1="112.3" x2="56.2" y2="117.7"/><line x1="68.2" y1="107.9" x2="54.2" y2="111.4"/><line x1="67.4" y1="103.4" x2="53.1" y2="104.9"/><line x1="67.2" y1="98.9" x2="52.8" y2="98.4"/><line x1="67.7" y1="94.3" x2="53.5" y2="91.8"/><line x1="68.8" y1="89.9" x2="55.1" y2="85.4"/><line x1="70.5" y1="85.6" x2="57.6" y2="79.3"/><line x1="72.8" y1="81.7" x2="60.9" y2="73.6"/><line x1="75.6" y1="78.1" x2="64.9" y2="68.4"/><line x1="78.9" y1="74.9" x2="69.7" y2="63.8"/><line x1="82.6" y1="72.2" x2="75.0" y2="60.0"/><line x1="86.7" y1="70.0" x2="80.8" y2="56.9"/><line x1="91.0" y1="68.5" x2="87.0" y2="54.6"/><line x1="95.4" y1="67.5" x2="93.4" y2="53.3"/></g>
    </g>
    <g class="omt-sx-part" data-part="jog" tabindex="-1" role="button" aria-label="Jog">
      <circle cx="100" cy="100" r="27.5"/>
      <circle class="omt-sx-dimple" cx="100" cy="78.0" r="4.2"/>
    </g>
    <path class="omt-sx-part omt-sx-btn" data-part="btn1" tabindex="-1" role="button" aria-label="Button 1" d="M32.28,134.50 A76,76 0 0,1 32.28,65.50 L52.78,75.94 A53,53 0 0,0 52.78,124.06 Z"/>
    <path class="omt-sx-part omt-sx-btn" data-part="btn2" tabindex="-1" role="button" aria-label="Button 2" d="M38.51,55.33 A76,76 0 0,1 66.68,31.69 L76.77,52.36 A53,53 0 0,0 57.12,68.85 Z"/>
    <path class="omt-sx-part omt-sx-btn" data-part="btn3" tabindex="-1" role="button" aria-label="Button 3" d="M77.78,27.32 A76,76 0 0,1 122.22,27.32 L115.50,49.32 A53,53 0 0,0 84.50,49.32 Z"/>
    <path class="omt-sx-part omt-sx-btn" data-part="btn4" tabindex="-1" role="button" aria-label="Button 4" d="M133.32,31.69 A76,76 0 0,1 161.49,55.33 L142.88,68.85 A53,53 0 0,0 123.23,52.36 Z"/>
    <path class="omt-sx-part omt-sx-btn" data-part="btn5" tabindex="-1" role="button" aria-label="Button 5" d="M167.72,65.50 A76,76 0 0,1 167.72,134.50 L147.22,124.06 A53,53 0 0,0 147.22,75.94 Z"/>
    <text class="omt-sx-label" data-part="btn1" x="35.5" y="100.0" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label" data-part="btn2" x="58.5" y="50.6" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label" data-part="btn3" x="100.0" y="35.5" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label" data-part="btn4" x="141.5" y="50.6" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label" data-part="btn5" x="164.5" y="100.0" text-anchor="middle" dominant-baseline="central">—</text>
    <text class="omt-sx-label omt-sx-label--ring" data-part="ring" x="100.0" y="140.0" text-anchor="middle" dominant-baseline="central">Shuttle ring</text>
    <text class="omt-sx-label" data-part="jog" x="100" y="103" text-anchor="middle" dominant-baseline="central">Jog</text>
    <text class="omt-sx-num" data-part="btn1" x="9.0" y="100.0" text-anchor="middle" dominant-baseline="central">1</text>
    <text class="omt-sx-num" data-part="btn2" x="41.5" y="30.3" text-anchor="middle" dominant-baseline="central">2</text>
    <text class="omt-sx-num" data-part="btn3" x="100.0" y="9.0" text-anchor="middle" dominant-baseline="central">3</text>
    <text class="omt-sx-num" data-part="btn4" x="158.5" y="30.3" text-anchor="middle" dominant-baseline="central">4</text>
    <text class="omt-sx-num" data-part="btn5" x="191.0" y="100.0" text-anchor="middle" dominant-baseline="central">5</text>
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
      ring: 'Shuttle ring',
      jog: 'Jog'
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
    rows.push(['Jog', shuttlePrefs.jogStep + 's / tick (frame by frame)']);
    rows.push(['Shuttle ring', shuttlePrefs.shuttleScale + '× scrub (speed, 7 steps)']);
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

  function applyCustSections(stored) {
    const state = Object.assign({}, CUST_SECTION_DEFAULTS);
    if (stored && typeof stored === 'object') {
      Object.keys(CUST_SECTION_DEFAULTS).forEach((k) => {
        if (typeof stored[k] === 'boolean') state[k] = stored[k];
      });
    }
    document.querySelectorAll('.omt-cust-details[data-section]').forEach((el) => {
      const key = el.getAttribute('data-section');
      if (!key) return;
      el.open = !!state[key];
    });
  }

  function persistCustSections() {
    const state = {};
    document.querySelectorAll('.omt-cust-details[data-section]').forEach((el) => {
      const key = el.getAttribute('data-section');
      if (key) state[key] = !!el.open;
    });
    chrome.storage.local.set({ [KEYS.custSections]: state });
  }

  document.querySelectorAll('.omt-cust-details[data-section]').forEach((el) => {
    el.addEventListener('toggle', persistCustSections);
  });

  chrome.storage.local.get(
    {
      [KEYS.clockPos]: 'top-left',
      [KEYS.clockSize]: 'medium',
      [KEYS.clockShape]: 'rounded',
      [KEYS.hotkeys]: null,
      [KEYS.shuttlePrefs]: null,
      [KEYS.autoPauseOnBlur]: false,
      [KEYS.custSections]: null
    },
    (result) => {
      clockPos.value = result[KEYS.clockPos] || 'top-left';
      clockSize.value = result[KEYS.clockSize] || 'medium';
      clockShape.value = result[KEYS.clockShape] || 'rounded';
      if (autoPause) autoPause.checked = !!result[KEYS.autoPauseOnBlur];
      hotkeys = mergeHotkeys(result[KEYS.hotkeys]);
      shuttlePrefs = mergeShuttle(result[KEYS.shuttlePrefs]);
      applyCustSections(result[KEYS.custSections]);
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
      [KEYS.clockShape]: clockShape.value,
      [KEYS.clockCustom]: null // legacy drag offsets discarded
    });
    updateClockPreview();
  }
  clockPos.addEventListener('change', persistClock);
  clockSize.addEventListener('change', persistClock);
  clockShape.addEventListener('change', persistClock);

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

  document.getElementById('omt-shuttle-edit-list').addEventListener('click', (e) => {
    const stepBtn = e.target.closest('.omt-stepper-btn');
    if (!stepBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const inputId = stepBtn.getAttribute('data-for');
    const input = inputId ? document.getElementById(inputId) : null;
    if (!input) return;
    const step = Number(stepBtn.getAttribute('data-step')) || 0;
    const min = Number(input.min) || 1;
    const max = Number(input.max) || 600;
    const cur = Number(input.value);
    const next = Math.min(max, Math.max(min, (Number.isFinite(cur) ? cur : min) + step));
    input.value = String(next);
    readShuttleFromForm();
    updateShuttleResetVisibility();
  });
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
