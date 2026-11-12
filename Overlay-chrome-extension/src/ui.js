/* Inject Overlay MatchTimer HUD, cache element refs, compact layout, fullscreen reparent. */
    /* =========================================================
       4. INJECT UI INTO THE PAGE
       ========================================================= */
    function injectUI() {
        const anchor = site.findAnchor(vid);

        if (!anchor) { console.error('[OMT] Could not find anchor element.'); return; }

        // Ensure relative positioning so absolute children work
        const cs = getComputedStyle(anchor);
        if (cs.position === 'static') anchor.style.position = 'relative';

        omtRoot = document.createElement('div');
        omtRoot.id = 'omt-root';
        omtRoot.classList.add(site.rootClass);
        omtRoot.innerHTML = buildHTML();
        anchor.appendChild(omtRoot);

        updateCompactLayout();
        ensureFullscreenHook();
    }

    function updateCompactLayout() {
        if (!omtRoot) return;
        // Examino popup players are often ~465×261 — shrink chrome so the HUD fits.
        const anchor = omtRoot.parentElement;
        const w = (anchor && anchor.clientWidth) || window.innerWidth;
        const h = (anchor && anchor.clientHeight) || window.innerHeight;
        const compact = site.id === 'examino' && (w < 720 || h < 420);
        omtRoot.classList.toggle('omt-compact', compact);
    }

    function ensureFullscreenHook() {
        if (fullscreenHooked) return;
        fullscreenHooked = true;
        document.addEventListener('fullscreenchange', () => {
            if (!vid || !omtRoot) return;
            updateCompactLayout();
            // If OpenPlayer (or the browser) fullscreens a parent that does not
            // contain our root, reparent so the overlay stays visible.
            const fs = document.fullscreenElement;
            if (fs && fs.contains(vid) && !fs.contains(omtRoot)) {
                fs.appendChild(omtRoot);
                const cs = getComputedStyle(fs);
                if (cs.position === 'static') fs.style.position = 'relative';
            } else if (!fs && vid.isConnected) {
                const anchor = site.findAnchor(vid);
                if (anchor && omtRoot.parentElement !== anchor) {
                    anchor.appendChild(omtRoot);
                }
            }
        });
        window.addEventListener('resize', () => updateCompactLayout());
    }

    function buildHTML() {
        return `
<div id="match-timer">00:00</div>
<div id="osd-message">MatchTimer</div>

<!-- SETUP PANEL -->
<div id="setup-panel" class="glass-panel">
    <div class="drag-handle" id="setup-handle">
        <div class="drag-side-left">
            <button class="handle-btn" style="cursor:default;opacity:0.6;">⚙️</button>
        </div>
        <div class="drag-center-grip">≡</div>
        <div class="drag-side-right">
            <button class="handle-btn" id="omt-btn-close-setup" style="color:#ff4444;font-weight:bold;" title="Close">✕</button>
        </div>
    </div>
    <div class="setup-content">

        <div class="brand-container">
            <svg width="260" height="50" viewBox="0 0 260 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g transform="translate(5,4)">
                    <circle cx="20" cy="23" r="17" fill="#151515" stroke="#66b3ff" stroke-width="2.5"/>
                    <rect x="16" y="2" width="8" height="4" rx="1" fill="#66b3ff"/>
                    <path d="M33 9 L36 6" stroke="#66b3ff" stroke-width="2.5" stroke-linecap="round"/>
                    <rect x="10" y="15" width="20" height="14" rx="1" stroke="#00ff88" stroke-width="1.2" fill="none"/>
                    <line x1="20" y1="15" x2="20" y2="29" stroke="#00ff88" stroke-width="1.2"/>
                    <circle cx="20" cy="22" r="3" stroke="#00ff88" stroke-width="1.2" fill="none"/>
                    <line x1="20" y1="22" x2="26" y2="15" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
                    <circle cx="20" cy="22" r="2" fill="#ffffff"/>
                </g>
                <text x="56" y="25" fill="#ffffff" font-family="'Segoe UI',sans-serif" font-size="16" font-weight="800" letter-spacing="1">OVERLAY</text>
                <text x="138" y="25" fill="#00ff88" font-family="'Segoe UI',sans-serif" font-size="16" font-weight="800" letter-spacing="1">MATCHTIMER</text>
                <text x="56" y="39" fill="#888" font-family="'Segoe UI',sans-serif" font-size="9" font-weight="600" letter-spacing="0.5">DEVELOPED BY VASCO OLIVEIRA</text>
            </svg>
        </div>

        <div class="control-group" id="omt-examino-settings" style="display:none;border:1px solid rgba(0,255,136,0.18);border-radius:6px;padding:8px 10px;background:rgba(0,255,136,0.04);">
            <label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px;">0. Source (Examino)</label>
            <select id="omt-examino-source" style="width:100%;box-sizing:border-box;padding:6px;background:rgba(0,0,0,0.35);border:1px solid #444;color:white;border-radius:4px;font-size:12px;">
                <option value="DVR">DVR</option>
                <option value="VOD">VOD</option>
            </select>
            <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:#ddd;margin-top:8px;">
                <span>Auto-switch to VOD</span>
                <input type="checkbox" id="omt-examino-auto-vod" checked>
            </label>
        </div>

        <div class="control-group">
            <label>1. Match Half</label>
            <select id="omt-half-select">
                <option value="1">1st Half (Starts at 00:00)</option>
                <option value="2">2nd Half (Starts at 45:00)</option>
                <option value="custom1">Custom 1 &mdash; 1st Extra Time / Youth 2nd Half</option>
                <option value="custom2">Custom 2 &mdash; 2nd Extra Time</option>
            </select>
            <div id="omt-custom-c1" style="display:none;margin-top:5px;">
                <input type="number" id="omt-custom-minute-c1" placeholder="Starting minute for Custom 1 (e.g. 90)" min="0"
                    style="width:100%;box-sizing:border-box;padding:8px;background:rgba(0,0,0,0.3);border:1px solid #444;color:white;border-radius:4px;font-size:12px;outline:none;">
            </div>
            <div id="omt-custom-c2" style="display:none;margin-top:5px;">
                <input type="number" id="omt-custom-minute-c2" placeholder="Starting minute for Custom 2 (e.g. 105)" min="0"
                    style="width:100%;box-sizing:border-box;padding:8px;background:rgba(0,0,0,0.3);border:1px solid #444;color:white;border-radius:4px;font-size:12px;outline:none;">
            </div>
        </div>

        <div class="control-group">
            <label>2. Whistle Time (Hr : Min : Sec)</label>
            <div class="time-inputs">
                <input type="number" id="omt-sync-hr"  placeholder="0" min="0"> :
                <input type="number" id="omt-sync-min" placeholder="0" min="0"> :
                <input type="number" id="omt-sync-sec" placeholder="0" min="0" max="59">
            </div>
        </div>

        <div style="display:flex;gap:5px;">
            <button class="btn-sync" id="omt-btn-set-kickoff" style="flex:1;">SET KICK-OFF TIME</button>
            <button id="omt-btn-clear-timer"
                style="background:rgba(255,68,68,0.15);color:#ff4444;border:1px solid rgba(255,68,68,0.3);
                       padding:10px;font-weight:bold;border-radius:4px;cursor:pointer;transition:0.2s;
                       margin-top:5px;display:flex;align-items:center;justify-content:center;font-family:inherit;"
                title="Clear/Disable Timer">✕</button>
        </div>

        <div class="control-group" id="omt-shuttle-toggle-group" style="margin-top:10px;border-top:1px solid rgba(255,255,255,0.08);padding-top:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
                <span style="font-size:11px;color:#ddd;user-select:none;">Enable ShuttleXpress</span>
                <label class="omt-shuttle-switch" style="position:relative;display:inline-block;width:38px;height:20px;margin:0;">
                    <input type="checkbox" id="omt-shuttle-enable-toggle" style="opacity:0;width:0;height:0;margin:0;position:absolute;">
                    <span class="omt-shuttle-slider"></span>
                </label>
            </div>
        </div>

        <div class="cheatsheet" id="omt-shuttle-cheatsheet" style="display:none;margin-top:10px;">
            <div class="cheatsheet-title" style="color:#00ff88;border-bottom-color:rgba(0,255,136,0.15);">ShuttleXpress Controls</div>
            <div class="shortcut-item"><span>Button 1 (Far Left)</span><span class="shortcut-key">-2 min</span></div>
            <div class="shortcut-item"><span>Button 2</span><span class="shortcut-key">-10 sec</span></div>
            <div class="shortcut-item"><span>Button 3 (Center)</span><span class="shortcut-key">Play / Pause</span></div>
            <div class="shortcut-item"><span>Button 4</span><span class="shortcut-key">+10 sec</span></div>
            <div class="shortcut-item"><span>Button 5 (Far Right)</span><span class="shortcut-key">+2 min</span></div>
            <div class="shortcut-item"><span>Inner Wheel</span><span class="shortcut-key">Frame by Frame</span></div>
            <div class="shortcut-item"><span>Outer Ring</span><span class="shortcut-key">Fast Fwd / Rewind</span></div>
        </div>

        <div class="cheatsheet">
            <div class="cheatsheet-title">Shortcuts</div>
            <div class="shortcut-item"><span>Play / Pause</span><span class="shortcut-key">Space</span></div>
            <div class="shortcut-item"><span>Skip ±2s</span><span class="shortcut-key">← / →</span></div>
            <div class="shortcut-item"><span>Skip ±10s</span><span class="shortcut-key">Shift + →</span></div>
            <div class="shortcut-item"><span>Skip ±2m</span><span class="shortcut-key">Ctrl + →</span></div>
            <div class="shortcut-item"><span>Frame by Frame</span><span class="shortcut-key">↑ / ↓</span></div>
            <div class="shortcut-item"><span>Speed ±</span><span class="shortcut-key">Z / C</span></div>
            <div class="shortcut-item"><span>Speed 1.0x</span><span class="shortcut-key">X</span></div>
            <div class="shortcut-item"><span>Hide/Show Controls</span><span class="shortcut-key">H</span></div>
        </div>
    </div>
</div>

<!-- CONTROLS PANEL -->
<div id="controls-panel" class="glass-panel">
    <div class="drag-handle" id="controls-handle">
        <div class="drag-side-left">
            <button class="handle-btn" id="omt-btn-show-setup" title="Settings">⚙️</button>
            <select id="omt-speed-select" class="top-select">
                <option value="0.25">0.25x</option>
                <option value="0.5">0.50x</option>
                <option value="1.0" selected>1.00x</option>
                <option value="1.5">1.50x</option>
                <option value="2.0">2.00x</option>
            </select>
        </div>
        <div class="drag-center-grip">≡</div>
        <div class="drag-side-right">
            <div style="display:flex;align-items:center;gap:6px;margin-right:10px;">
                <button id="omt-live-btn" title="Go to Live Edge">
                    <span class="live-dot"></span> LIVE
                </button>
                <span class="omt-live-spacer" aria-hidden="true"></span>
                <button class="handle-btn" id="omt-volume-icon-btn" title="Mute/Unmute" style="font-size:12px;padding:0 2px;">🔊</button>
                <input type="range" id="omt-volume-range" min="0" max="1" step="0.05" value="1" style="-webkit-appearance: none; appearance: none; width: 60px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.2); outline: none; cursor: pointer;">
            </div>
            <button class="handle-btn" id="omt-btn-fullscreen" title="Fullscreen">⛶</button>
        </div>
    </div>

    <div class="timeline-container">
        <div class="timeline-badges-row" id="omt-kickoff-jumps">
            <button id="omt-jump-k1"  class="kickoff-badge k1"  style="display:none;" title="Jump to 1st Half Kickoff">⚽ 1st</button>
            <button id="omt-jump-k2"  class="kickoff-badge k2"  style="display:none;" title="Jump to 2nd Half Kickoff">⚽ 2nd</button>
            <button id="omt-jump-kc1" class="kickoff-badge kc1" style="display:none;" title="Jump to Custom 1 Kickoff">⚽ C1</button>
            <button id="omt-jump-kc2" class="kickoff-badge kc2" style="display:none;" title="Jump to Custom 2 Kickoff">⚽ C2</button>
        </div>
        <div class="timeline-slider-row">
            <span id="omt-v-time-current">00:00:00</span>
            <div style="position:relative;flex:1;display:flex;align-items:center;">
                <input type="range" id="omt-timeline-slider" class="timeline-slider" min="0" max="100" value="0" step="0.01">
                <div id="omt-timeline-markers" style="position:absolute;left:6px;right:6px;height:6px;top:50%;transform:translateY(-50%);pointer-events:none;"></div>
            </div>
            <span id="omt-v-time-duration">00:00:00</span>
        </div>
    </div>

    <div class="controls-content">
        <div class="ctrl-group-left">
            <button class="ctrl-btn" id="omt-m120">2m ⏪</button>
            <button class="ctrl-btn" id="omt-m10">10s ⏪</button>
            <button class="ctrl-btn" id="omt-m2">2s ◀</button>
        </div>
        <div class="ctrl-group-center">
            <div class="separator"></div>
            <button class="ctrl-btn btn-frame" id="omt-prev-frame" title="Previous Frame">|⏴</button>
            <button class="ctrl-btn btn-play"  id="omt-btn-play">⏯ Play</button>
            <button class="ctrl-btn btn-frame" id="omt-next-frame" title="Next Frame">⏵|</button>
            <div class="separator"></div>
        </div>
        <div class="ctrl-group-right">
            <button class="ctrl-btn" id="omt-p2">2s ▶</button>
            <button class="ctrl-btn" id="omt-p10">10s ⏩</button>
            <button class="ctrl-btn" id="omt-p120">2m ⏩</button>
        </div>
    </div>
</div>`;
    }

    /* =========================================================
       5. CACHE UI ELEMENT REFERENCES
       ========================================================= */
    function q(id) { return omtRoot.querySelector('#' + id); }

    function cacheUIRefs() {
        timerUI = q('match-timer');
        osd = q('osd-message');
        setupPanel = q('setup-panel');
        controlsPanel = q('controls-panel');
        timelineSlider = q('omt-timeline-slider');
        vTimeCurrent = q('omt-v-time-current');
        vTimeDuration = q('omt-v-time-duration');
        liveBtn = q('omt-live-btn');
        btnMainPlay = q('omt-btn-play');
        speedSelect = q('omt-speed-select');
        volumeRange = q('omt-volume-range');
        volumeIconBtn = q('omt-volume-icon-btn');
        shuttleToggle = q('omt-shuttle-enable-toggle');
        shuttleCheatsheet = q('omt-shuttle-cheatsheet');
    }
