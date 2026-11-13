(function () {
  'use strict';

  const SYNC_FEATURE = (typeof OMT_SYNC_FEATURE_ENABLED !== 'undefined') && !!OMT_SYNC_FEATURE_ENABLED;

  const KEYS = {
    clockPos: 'omtClockPosition',
    clockSize: 'omtClockSize',
    clockShape: 'omtClockShape',
    clockCustom: 'omtClockCustomOffset',
    hotkeys: 'omtHotkeys',
    shuttlePrefs: 'omtShuttlePrefs',
    autoPauseOnBlur: 'omtAutoPauseOnBlur',
    custSections: 'omtCustSectionsOpen',
    syncEnabled: 'omtKickoffSyncEnabled',
    syncUrl: 'omtKickoffSyncUrl',
    syncAnon: 'omtKickoffSyncAnonKey',
    syncRoom: 'omtKickoffSyncRoom'
  };

  const CUST_SECTION_DEFAULTS = {
    // Customize
    clock: true, hotkeys: false, shuttle: false,
    // General (v1.6.3) — actions open; reference lists collapsed
    genActions: true, genShortcuts: false, genShuttle: false
  };
  if (SYNC_FEATURE) CUST_SECTION_DEFAULTS.sync = false;

  let selectedShuttlePart = null;

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
    skipBtn3: 120,
    skipBtn4: 10,
    skipBtn5: 120,
    playPauseBtn: 3,
    centreSkipSign: 1, // +1 / −1 when centre (btn 3) holds a skip
    jogStep: 0.04,
    shuttleScale: 1
  };

  const SHUTTLE_DIAGRAM_SVG = `<svg class="omt-shuttle-svg" viewBox="0 0 200 200" role="img" aria-label="Contour ShuttleXpress">
  <!-- v1.6.3 outline: Vasco foto.png — centred btn3, mirrored 2/4 & 1/5, dimple at 12 o'clock -->
  <g class="omt-sx-root">
    <circle class="omt-sx-body" cx="100" cy="100" r="80"/>
    <g class="omt-sx-part" data-part="ring" tabindex="-1" role="button" aria-label="Shuttle ring" fill-rule="evenodd">
      <path class="omt-sx-ring-disk" d="M100,51 A49,49 0 1,1 99.99,51 Z M100,69 A31,31 0 1,0 100.01,69 Z"/>
      <g class="omt-sx-ticks"><line x1="100.0" y1="67.2" x2="100.0" y2="52.8"/><line x1="104.6" y1="67.5" x2="106.6" y2="53.3"/><line x1="109.0" y1="68.5" x2="113.0" y2="54.6"/><line x1="113.3" y1="70.0" x2="119.2" y2="56.9"/><line x1="117.4" y1="72.2" x2="125.0" y2="60.0"/><line x1="121.1" y1="74.9" x2="130.3" y2="63.8"/><line x1="124.4" y1="78.1" x2="135.1" y2="68.4"/><line x1="127.2" y1="81.7" x2="139.1" y2="73.6"/><line x1="129.5" y1="85.6" x2="142.4" y2="79.3"/><line x1="131.2" y1="89.9" x2="144.9" y2="85.4"/><line x1="132.3" y1="94.3" x2="146.5" y2="91.8"/><line x1="132.8" y1="98.9" x2="147.2" y2="98.4"/><line x1="132.6" y1="103.4" x2="146.9" y2="104.9"/><line x1="131.8" y1="107.9" x2="145.8" y2="111.4"/><line x1="130.4" y1="112.3" x2="143.8" y2="117.7"/><line x1="128.4" y1="116.4" x2="140.9" y2="123.6"/><line x1="125.8" y1="120.2" x2="137.2" y2="129.1"/><line x1="122.8" y1="123.6" x2="132.8" y2="134.0"/><line x1="119.3" y1="126.5" x2="127.7" y2="138.2"/><line x1="115.4" y1="129.0" x2="122.2" y2="141.7"/><line x1="111.2" y1="130.8" x2="116.1" y2="144.4"/><line x1="106.8" y1="132.1" x2="109.8" y2="146.2"/><line x1="102.3" y1="132.7" x2="103.3" y2="147.1"/><line x1="97.7" y1="132.7" x2="96.7" y2="147.1"/><line x1="93.2" y1="132.1" x2="90.2" y2="146.2"/><line x1="88.8" y1="130.8" x2="83.9" y2="144.4"/><line x1="84.6" y1="129.0" x2="77.8" y2="141.7"/><line x1="80.7" y1="126.5" x2="72.3" y2="138.2"/><line x1="77.2" y1="123.6" x2="67.2" y2="134.0"/><line x1="74.2" y1="120.2" x2="62.8" y2="129.1"/><line x1="71.6" y1="116.4" x2="59.1" y2="123.6"/><line x1="69.6" y1="112.3" x2="56.2" y2="117.7"/><line x1="68.2" y1="107.9" x2="54.2" y2="111.4"/><line x1="67.4" y1="103.4" x2="53.1" y2="104.9"/><line x1="67.2" y1="98.9" x2="52.8" y2="98.4"/><line x1="67.7" y1="94.3" x2="53.5" y2="91.8"/><line x1="68.8" y1="89.9" x2="55.1" y2="85.4"/><line x1="70.5" y1="85.6" x2="57.6" y2="79.3"/><line x1="72.8" y1="81.7" x2="60.9" y2="73.6"/><line x1="75.6" y1="78.1" x2="64.9" y2="68.4"/><line x1="78.9" y1="74.9" x2="69.7" y2="63.8"/><line x1="82.6" y1="72.2" x2="75.0" y2="60.0"/><line x1="86.7" y1="70.0" x2="80.8" y2="56.9"/><line x1="91.0" y1="68.5" x2="87.0" y2="54.6"/><line x1="95.4" y1="67.5" x2="93.4" y2="53.3"/></g>
    </g>
    <g class="omt-sx-part" data-part="jog" tabindex="-1" role="button" aria-label="Jog">
      <circle class="omt-sx-jog-disk" cx="100" cy="100" r="27.5"/>
      <circle class="omt-sx-dimple" cx="100" cy="84.0" r="4.2"/>
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

  function positionalSkipSign(btn) {
    if (btn === 1 || btn === 2) return -1;
    if (btn === 4 || btn === 5) return 1;
    return 1;
  }

  function skipSignForButton(btn, prefs) {
    if (btn === 3) {
      const s = Number(prefs && prefs.centreSkipSign);
      return s < 0 ? -1 : 1;
    }
    return positionalSkipSign(btn);
  }

  function mergeShuttle(stored) {
    const out = Object.assign({}, SHUTTLE_DEFAULTS);
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
    // Migrate pre-1.6.4: no skipBtn3 stored while PP was moved off centre → seed centre skip
    if (stored.skipBtn3 == null && out.playPauseBtn !== 3) {
      out.skipBtn3 = SHUTTLE_DEFAULTS.skipBtn3;
      out.centreSkipSign = positionalSkipSign(out.playPauseBtn);
    }
    return out;
  }

  /** Move Play/Pause to newBtn, giving the destination's skip to the previous PP button. */
  function swapPlayPauseTo(newBtn) {
    if (!shuttlePrefs) return;
    const dest = Number(newBtn);
    if (![1, 2, 3, 4, 5].includes(dest)) return;
    const old = shuttlePrefs.playPauseBtn;
    if (dest === old) return;
    const movingSkip = Number(shuttlePrefs['skipBtn' + dest]);
    const secs = Number.isFinite(movingSkip) && movingSkip > 0
      ? movingSkip
      : SHUTTLE_DEFAULTS['skipBtn' + dest];
    shuttlePrefs['skipBtn' + old] = secs;
    if (old === 3) {
      shuttlePrefs.centreSkipSign = positionalSkipSign(dest);
    }
    shuttlePrefs.playPauseBtn = dest;
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
    const secs = shuttlePrefs['skipBtn' + btn];
    if (!Number.isFinite(secs)) return '—';
    const sign = skipSignForButton(btn, shuttlePrefs) < 0 ? '−' : '+';
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
        // General: action labels only — no Btn 1..5 numbers around the ring.
        svg.querySelectorAll('.omt-sx-num').forEach((el) => el.remove());
      }
    }
    if (edit && !edit.querySelector('.omt-shuttle-svg')) {
      edit.innerHTML = SHUTTLE_DIAGRAM_SVG;
      const svg = edit.querySelector('.omt-shuttle-svg');
      if (svg) {
        svg.id = 'omt-shuttle-svg';
        svg.classList.add('omt-shuttle-svg--edit');
        // Customize keeps Btn 1..5 numbers (editor rows refer to them).
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
    // General: diagram + note only (no text list).
  }

  function numFieldHtml(id, value) {
    return '<span class="omt-num-field">'
      + '<input type="number" id="' + id + '" class="omt-control" min="1" max="600" step="1" value="' + value + '" />'
      + '<span class="omt-num-chevrons" aria-hidden="true">'
      + '<button type="button" class="omt-chev" data-step="1" data-for="' + id + '" tabindex="-1" aria-label="Increase"></button>'
      + '<button type="button" class="omt-chev" data-step="-1" data-for="' + id + '" tabindex="-1" aria-label="Decrease"></button>'
      + '</span></span><span class="omt-unit">s</span>';
  }

  function renderShuttleEditor() {
    const host = document.getElementById('omt-shuttle-edit-list');
    if (!host || !shuttlePrefs) return;
    const pp = shuttlePrefs.playPauseBtn;
    const keepPart = selectedShuttlePart;
    let html = '';
    for (let i = 1; i <= 5; i++) {
      const part = 'btn' + i;
      const isPp = i === pp;
      const sign = skipSignForButton(i, shuttlePrefs) < 0 ? '−' : '+';
      const label = isPp ? ('Btn ' + i) : ('Btn ' + i + ' (' + sign + ')');
      let control;
      if (isPp) {
        control = '<select id="omt-sx-playpause" class="omt-control" aria-label="Play / Pause button">'
          + [1, 2, 3, 4, 5].map((n) => {
            const def = n === 3 ? ' (default)' : '';
            return '<option value="' + n + '"' + (n === pp ? ' selected' : '') + '>Play / Pause · Btn ' + n + def + '</option>';
          }).join('')
          + '</select>';
      } else {
        control = numFieldHtml('omt-sx-skip' + i, shuttlePrefs['skipBtn' + i]);
      }
      const resetKey = isPp ? 'playPauseBtn' : ('skipBtn' + i);
      html += '<div class="omt-shuttle-row' + (isPp ? ' omt-shuttle-row--playpause' : '') + '" data-part="' + part + '">'
        + '<span class="omt-shuttle-label">' + label + '</span>'
        + '<span class="omt-shuttle-control">' + control + '</span>'
        + '<button type="button" class="omt-btn-icon" data-reset="' + resetKey + '" title="Reset to default" aria-label="Reset to default">'
        + ICON_RESET + '</button></div>';
    }
    html += '<div class="omt-shuttle-row" data-part="jog">'
      + '<span class="omt-shuttle-label" title="Frame by frame">Jog</span>'
      + '<span class="omt-shuttle-control"><select id="omt-sx-jog" class="omt-control">'
      + '<option value="0.02">0.02s fine</option>'
      + '<option value="0.04">0.04s ≈1f</option>'
      + '<option value="0.08">0.08s</option>'
      + '<option value="0.12">0.12s</option>'
      + '</select></span>'
      + '<button type="button" class="omt-btn-icon" data-reset="jogStep" title="Reset to default" aria-label="Reset to default">'
      + ICON_RESET + '</button></div>';
    html += '<div class="omt-shuttle-row" data-part="ring">'
      + '<span class="omt-shuttle-label" title="Speed">Shuttle ring</span>'
      + '<span class="omt-shuttle-control"><select id="omt-sx-scale" class="omt-control">'
      + '<option value="0.5">0.5×</option>'
      + '<option value="1">1× (default)</option>'
      + '<option value="1.5">1.5×</option>'
      + '<option value="2">2×</option>'
      + '</select></span>'
      + '<button type="button" class="omt-btn-icon" data-reset="shuttleScale" title="Reset to default" aria-label="Reset to default">'
      + ICON_RESET + '</button></div>';
    host.innerHTML = html;
    const jog = document.getElementById('omt-sx-jog');
    const scale = document.getElementById('omt-sx-scale');
    if (jog) jog.value = String(shuttlePrefs.jogStep);
    if (scale) scale.value = String(shuttlePrefs.shuttleScale);
    updateShuttleResetVisibility();
    if (keepPart) setShuttleHighlight(keepPart);
  }

  function focusShuttlePart(part) {
    if (!part) return;
    setShuttleHighlight(part);
    const row = document.querySelector('#omt-shuttle-edit-list .omt-shuttle-row[data-part="' + part + '"]');
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
      let dirty = false;
      if (key === 'playPauseBtn') {
        dirty = shuttlePrefs.playPauseBtn !== SHUTTLE_DEFAULTS.playPauseBtn
          || shuttlePrefs.centreSkipSign !== SHUTTLE_DEFAULTS.centreSkipSign
          || [1, 2, 3, 4, 5].some((n) => shuttlePrefs['skipBtn' + n] !== SHUTTLE_DEFAULTS['skipBtn' + n]);
      } else {
        dirty = shuttlePrefs[key] !== SHUTTLE_DEFAULTS[key];
      }
      btn.classList.toggle('is-dirty', dirty);
    });
  }

  function fillShuttleForm() {
    renderShuttleEditor();
  }

  function editDiagramRoot() {
    return document.getElementById('omt-shuttle-diagram-wrap');
  }

  function setShuttleHighlight(part) {
    // Exactly one active part shared by edit diagram + settings rows.
    selectedShuttlePart = part || null;
    document.querySelectorAll(
      '.omt-sx-part.is-active, .omt-sx-num.is-active, .omt-sx-label.is-active, .omt-shuttle-row.is-active, .omt-sx-part.is-hover, .omt-sx-num.is-hover, .omt-sx-label.is-hover'
    ).forEach((el) => {
      el.classList.remove('is-active');
      el.classList.remove('is-hover');
    });
    const wrap = editDiagramRoot();
    if (wrap && selectedShuttlePart) {
      wrap.querySelectorAll('.omt-sx-part, .omt-sx-num, .omt-sx-label').forEach((el) => {
        if (el.getAttribute('data-part') === selectedShuttlePart) el.classList.add('is-active');
      });
    }
    document.querySelectorAll('#omt-shuttle-edit-list .omt-shuttle-row').forEach((row) => {
      if (selectedShuttlePart && row.getAttribute('data-part') === selectedShuttlePart) {
        row.classList.add('is-active');
      }
    });
  }

  function setShuttleHover(part) {
    const wrap = editDiagramRoot();
    if (!wrap) return;
    wrap.querySelectorAll('.omt-sx-part, .omt-sx-num, .omt-sx-label').forEach((el) => {
      const match = !!part && el.getAttribute('data-part') === part;
      if (el.classList.contains('is-active')) {
        el.classList.remove('is-hover');
      } else {
        el.classList.toggle('is-hover', match);
      }
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

  // Kickoff sync Customize UI — only when internal feature flag is on (v1.7.1: off).
  let syncEnable = null;
  let syncUrl = null;
  let syncAnon = null;
  let syncRoom = null;
  let syncStatus = null;

  function wireSyncUi() {
    if (!SYNC_FEATURE) return;
    syncEnable = document.getElementById('omt-kickoff-sync-enable');
    syncUrl = document.getElementById('omt-sync-url');
    syncAnon = document.getElementById('omt-sync-anon');
    syncRoom = document.getElementById('omt-sync-room');
    syncStatus = document.getElementById('omt-sync-status');

    function syncOriginPattern(urlStr) {
      try {
        const u = new URL(String(urlStr || '').trim());
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        return u.origin + '/*';
      } catch (_) {
        return null;
      }
    }

    function setSyncStatus(text, isError) {
      if (!syncStatus) return;
      syncStatus.textContent = text || '';
      syncStatus.style.color = isError ? '#f87171' : 'var(--omt-muted)';
    }

    function persistSyncPrefs(extra) {
      const payload = Object.assign({
        [KEYS.syncEnabled]: !!(syncEnable && syncEnable.checked),
        [KEYS.syncUrl]: syncUrl ? String(syncUrl.value || '').trim() : '',
        [KEYS.syncAnon]: syncAnon ? String(syncAnon.value || '').trim() : '',
        [KEYS.syncRoom]: syncRoom ? String(syncRoom.value || '').trim() : ''
      }, extra || {});
      chrome.storage.local.set(payload);
    }

    function requestSyncHostPermission(urlStr) {
      return new Promise((resolve) => {
        const origin = syncOriginPattern(urlStr);
        if (!origin) {
          resolve({ ok: false, error: 'Enter a valid Project URL first.' });
          return;
        }
        try {
          chrome.permissions.request({ origins: [origin] }, (granted) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message || 'Permission request failed.' });
              return;
            }
            resolve({ ok: !!granted, origin: origin });
          });
        } catch (err) {
          resolve({ ok: false, error: (err && err.message) || 'Permission request failed.' });
        }
      });
    }

    if (syncEnable) {
      syncEnable.addEventListener('change', async () => {
        if (syncEnable.checked) {
          const url = syncUrl ? String(syncUrl.value || '').trim() : '';
          const key = syncAnon ? String(syncAnon.value || '').trim() : '';
          if (!url || !key) {
            syncEnable.checked = false;
            setSyncStatus('Add Project URL and anon key before enabling.', true);
            const details = document.getElementById('omt-sync-details');
            if (details) details.open = true;
            return;
          }
          const perm = await requestSyncHostPermission(url);
          if (!perm.ok) {
            syncEnable.checked = false;
            setSyncStatus(perm.error || 'Host permission was not granted.', true);
            return;
          }
          persistSyncPrefs({ [KEYS.syncEnabled]: true });
          setSyncStatus('Sync on — kickoffs share for this project.', false);
        } else {
          persistSyncPrefs({ [KEYS.syncEnabled]: false });
          setSyncStatus('Sync off — no network requests.', false);
          try {
            chrome.runtime.sendMessage({ type: 'OMT_SYNC_STOP_POLL' }, () => {
              void chrome.runtime.lastError;
            });
          } catch (_) {}
        }
      });
    }

    function onSyncFieldBlur() {
      persistSyncPrefs();
      if (syncEnable && syncEnable.checked) {
        setSyncStatus('Saved. Host permission was already requested when enabling.', false);
      }
    }
    if (syncUrl) syncUrl.addEventListener('change', onSyncFieldBlur);
    if (syncAnon) syncAnon.addEventListener('change', onSyncFieldBlur);
    if (syncRoom) syncRoom.addEventListener('change', onSyncFieldBlur);
  }

  function ensureSyncSectionThenWire(done) {
    if (!SYNC_FEATURE) {
      done();
      return;
    }
    if (document.getElementById('omt-sync-details')) {
      wireSyncUi();
      done();
      return;
    }
    // Insert prototype markup from popup-sync-section.html before the foot actions.
    fetch(chrome.runtime.getURL('popup-sync-section.html'))
      .then((r) => r.text())
      .then((html) => {
        const foot = document.querySelector('.omt-cust-actions--foot');
        const pane = document.querySelector('.omt-pane[data-pane="customize"]');
        if (pane && foot) {
          const wrap = document.createElement('div');
          wrap.innerHTML = html.replace(/<!--[\s\S]*?-->/g, '').trim();
          while (wrap.firstChild) pane.insertBefore(wrap.firstChild, foot);
        }
        wireSyncUi();
        done();
      })
      .catch(() => {
        wireSyncUi();
        done();
      });
  }

  const storageDefaults = {
    [KEYS.clockPos]: 'top-left',
    [KEYS.clockSize]: 'medium',
    [KEYS.clockShape]: 'rounded',
    [KEYS.hotkeys]: null,
    [KEYS.shuttlePrefs]: null,
    [KEYS.autoPauseOnBlur]: false,
    [KEYS.custSections]: null
  };
  if (SYNC_FEATURE) {
    storageDefaults[KEYS.syncEnabled] = false;
    storageDefaults[KEYS.syncUrl] = '';
    storageDefaults[KEYS.syncAnon] = '';
    storageDefaults[KEYS.syncRoom] = '';
  }

  ensureSyncSectionThenWire(() => {
    chrome.storage.local.get(storageDefaults, (result) => {
      clockPos.value = result[KEYS.clockPos] || 'top-left';
      clockSize.value = result[KEYS.clockSize] || 'medium';
      clockShape.value = result[KEYS.clockShape] || 'rounded';
      if (autoPause) autoPause.checked = !!result[KEYS.autoPauseOnBlur];
      hotkeys = mergeHotkeys(result[KEYS.hotkeys]);
      shuttlePrefs = mergeShuttle(result[KEYS.shuttlePrefs]);
      applyCustSections(result[KEYS.custSections]);
      if (SYNC_FEATURE) {
        if (syncUrl) syncUrl.value = result[KEYS.syncUrl] || '';
        if (syncAnon) syncAnon.value = result[KEYS.syncAnon] || '';
        if (syncRoom) syncRoom.value = result[KEYS.syncRoom] || '';
        if (syncEnable) syncEnable.checked = !!result[KEYS.syncEnabled];
      }
      refreshAll();
    });
  });

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

  function readShuttleSkipsAndMetaFromForm() {
    if (!shuttlePrefs) return;
    for (let i = 1; i <= 5; i++) {
      if (i === shuttlePrefs.playPauseBtn) continue;
      const el = document.getElementById('omt-sx-skip' + i);
      if (!el) continue;
      const n = Number(el.value);
      if (Number.isFinite(n) && n > 0 && n <= 600) shuttlePrefs['skipBtn' + i] = n;
    }
    const jog = document.getElementById('omt-sx-jog');
    const scale = document.getElementById('omt-sx-scale');
    if (jog) {
      const j = Number(jog.value);
      if (Number.isFinite(j) && j > 0) shuttlePrefs.jogStep = j;
    }
    if (scale) {
      const s = Number(scale.value);
      if (Number.isFinite(s) && s > 0) shuttlePrefs.shuttleScale = s;
    }
  }

  function persistShuttleUi(opts) {
    const rebuild = !!(opts && opts.rebuild);
    const highlight = opts && opts.highlight;
    saveShuttle();
    renderGeneralShuttle();
    updateShuttleDiagramLabels();
    if (rebuild) renderShuttleEditor();
    else updateShuttleResetVisibility();
    if (highlight) setShuttleHighlight(highlight);
  }

  document.getElementById('omt-shuttle-edit-list').addEventListener('click', (e) => {
    const chev = e.target.closest('.omt-chev');
    if (chev) {
      e.preventDefault();
      e.stopPropagation();
      const inputId = chev.getAttribute('data-for');
      const input = inputId ? document.getElementById(inputId) : null;
      if (!input) return;
      const step = Number(chev.getAttribute('data-step')) || 0;
      const min = Number(input.min) || 1;
      const max = Number(input.max) || 600;
      const cur = Number(input.value);
      const next = Math.min(max, Math.max(min, (Number.isFinite(cur) ? cur : min) + step));
      input.value = String(next);
      readShuttleSkipsAndMetaFromForm();
      const row = chev.closest('.omt-shuttle-row');
      persistShuttleUi({ highlight: row ? row.getAttribute('data-part') : null });
      return;
    }
    const resetBtn = e.target.closest('[data-reset]');
    if (resetBtn) {
      const key = resetBtn.getAttribute('data-reset');
      if (key === 'playPauseBtn') {
        shuttlePrefs.playPauseBtn = SHUTTLE_DEFAULTS.playPauseBtn;
        shuttlePrefs.centreSkipSign = SHUTTLE_DEFAULTS.centreSkipSign;
        for (let i = 1; i <= 5; i++) shuttlePrefs['skipBtn' + i] = SHUTTLE_DEFAULTS['skipBtn' + i];
      } else if (key && Object.prototype.hasOwnProperty.call(SHUTTLE_DEFAULTS, key)) {
        shuttlePrefs[key] = SHUTTLE_DEFAULTS[key];
      }
      const partMap = {
        skipBtn1: 'btn1', skipBtn2: 'btn2', skipBtn3: 'btn3', skipBtn4: 'btn4', skipBtn5: 'btn5',
        playPauseBtn: 'btn' + shuttlePrefs.playPauseBtn,
        jogStep: 'jog', shuttleScale: 'ring'
      };
      persistShuttleUi({ rebuild: true, highlight: partMap[key] || null });
      return;
    }
    const row = e.target.closest('.omt-shuttle-row');
    if (row) setShuttleHighlight(row.getAttribute('data-part'));
  });
  document.getElementById('omt-shuttle-edit-list').addEventListener('change', (e) => {
    if (!e.target.matches('input, select')) return;
    if (e.target.id === 'omt-sx-playpause') {
      swapPlayPauseTo(Number(e.target.value));
      persistShuttleUi({ rebuild: true, highlight: 'btn' + shuttlePrefs.playPauseBtn });
      return;
    }
    readShuttleSkipsAndMetaFromForm();
    const row = e.target.closest('.omt-shuttle-row');
    persistShuttleUi({ highlight: row ? row.getAttribute('data-part') : null });
  });
  document.getElementById('omt-shuttle-edit-list').addEventListener('input', (e) => {
    if (!e.target.matches('input[type="number"]')) return;
    readShuttleSkipsAndMetaFromForm();
    const row = e.target.closest('.omt-shuttle-row');
    persistShuttleUi({ highlight: row ? row.getAttribute('data-part') : null });
  });
  document.getElementById('omt-shuttle-edit-list').addEventListener('focusin', (e) => {
    const row = e.target.closest('.omt-shuttle-row');
    if (row) setShuttleHighlight(row.getAttribute('data-part'));
  });
  document.getElementById('omt-shuttle-edit-list').addEventListener('mouseover', (e) => {
    const row = e.target.closest('.omt-shuttle-row');
    if (row) setShuttleHover(row.getAttribute('data-part'));
  });
  document.getElementById('omt-shuttle-edit-list').addEventListener('mouseout', (e) => {
    const row = e.target.closest('.omt-shuttle-row');
    if (row) setShuttleHover(null);
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
    const resetPayload = {
      [KEYS.clockPos]: 'top-left',
      [KEYS.clockSize]: 'medium',
      [KEYS.clockShape]: 'rounded',
      [KEYS.clockCustom]: null,
      [KEYS.hotkeys]: null,
      [KEYS.shuttlePrefs]: null
    };
    if (SYNC_FEATURE) {
      if (syncEnable) syncEnable.checked = false;
      if (syncUrl) syncUrl.value = '';
      if (syncAnon) syncAnon.value = '';
      if (syncRoom) syncRoom.value = '';
      if (syncStatus) syncStatus.textContent = '';
      resetPayload[KEYS.syncEnabled] = false;
      resetPayload[KEYS.syncUrl] = '';
      resetPayload[KEYS.syncAnon] = '';
      resetPayload[KEYS.syncRoom] = '';
      try {
        chrome.runtime.sendMessage({ type: 'OMT_SYNC_STOP_POLL' }, () => {
          void chrome.runtime.lastError;
        });
      } catch (_) {}
    }
    chrome.storage.local.set(resetPayload);
    refreshAll();
    setShuttleHighlight(null);
  });
})();
