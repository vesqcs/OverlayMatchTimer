/* Draggable glass panels + viewport clamp (v2.3.5/2.3.6). */
    /* =========================================================
       15. PANEL DRAG SYSTEM
       ========================================================= */

    /** Extra air below measured native top chrome. */
    const OMT_TOP_SAFE_GAP_PX = 4;

    /**
     * True only after the user actually dragged this panel (handle or edge).
     * Default CSS-centered panels must never be treated as positioned.
     */
    function omtPanelIsUserPositioned(panel) {
        if (!panel || !panel.style) return false;
        try {
            if (panel.dataset && panel.dataset.omtUserDragged === '1') return true;
        } catch (_) {}
        return false;
    }

    /**
     * Examino: measure the dark top overlay / invisible click-block band
     * (field ~100px at 1080p). Prefer real DOM boxes; fall back to probe.
     * The drag-handle row must sit just below this band.
     */
    function omtMeasureExaminoTopBlockPx(rootEl) {
        const root = rootEl || omtRoot;
        if (!root || !root.getBoundingClientRect) return 0;
        let fromDom = 0;
        try {
            const rr = root.getBoundingClientRect();
            const scope = (vid && vid.closest && (vid.closest('.op-player') || vid.closest('.op-wrapper') ||
                vid.closest('.main-container'))) || root.parentElement || document;
            let bottom = rr.top;

            // Named OvenPlayer / Examino top overlays (dark gradient band).
            const sels = [
                '.op-top-panel',
                '.op-gradient-top',
                '.op-controls-container .op-top-panel',
                '.op-ui .op-top-panel',
                '[class*="gradient-top"]',
                '[class*="op-top"]',
                '.hamburger-menu',
                '.top-clock',
                '.setting-holder'
            ];
            sels.forEach((sel) => {
                try {
                    scope.querySelectorAll(sel).forEach((el) => {
                        if (!el || (omtRoot && omtRoot.contains(el))) return;
                        const r = el.getBoundingClientRect();
                        if (r.height < 4 || r.width < 8) return;
                        // Top-anchored overlays only (ignore bottom control chrome).
                        if (r.top > rr.top + 24) return;
                        if (r.bottom < rr.top - 1) return;
                        bottom = Math.max(bottom, Math.min(r.bottom, rr.top + Math.min(200, rr.height * 0.35)));
                    });
                } catch (_) {}
            });

            // Any wide top-of-player element with a gradient background.
            try {
                const candidates = scope.querySelectorAll(
                    '.op-player [class*="gradient"], .op-ui [class*="gradient"], .op-controls-container > div, .op-player > div'
                );
                candidates.forEach((el) => {
                    if (!el || (omtRoot && omtRoot.contains(el))) return;
                    const r = el.getBoundingClientRect();
                    if (r.height < 40 || r.width < rr.width * 0.5) return;
                    if (Math.abs(r.top - rr.top) > 8) return;
                    if (r.bottom > rr.top + Math.min(200, rr.height * 0.4)) return;
                    let bg = '';
                    try { bg = getComputedStyle(el).backgroundImage || ''; } catch (_) {}
                    const cls = (el.className && String(el.className)) || '';
                    if (!/gradient/i.test(bg) && !/gradient|top-panel|top_panel/i.test(cls)) return;
                    bottom = Math.max(bottom, r.bottom);
                });
            } catch (_) {}

            fromDom = Math.max(0, Math.ceil(bottom - rr.top));

            // Probe for a still-clickable invisible layer along the top centre.
            const midX = rr.left + (rr.width / 2);
            let probe = 0;
            const limit = Math.min(160, Math.max(8, Math.floor(rr.height / 3)));
            for (let y = 1; y <= limit; y += 2) {
                let el = null;
                try { el = document.elementFromPoint(midX, rr.top + y); } catch (_) { el = null; }
                if (!el) continue;
                if (omtRoot && (el === omtRoot || omtRoot.contains(el))) break;
                if (el.tagName === 'VIDEO') break;
                if (el.closest && el.closest('video, .op-media-element-container')) break;
                probe = y;
            }
            return Math.max(fromDom, probe);
        } catch (_) {
            return fromDom;
        }
    }

    /**
     * InPlay: measure Stats Perform header + curtain tab against the player root.
     * Field CSS (.header-container) is height:60px at 1920; always re-read live.
     */
    function omtMeasureInplayTopChromePx(rootEl) {
        const root = rootEl || omtRoot;
        if (!root || !root.getBoundingClientRect) return 0;
        try {
            const rr = root.getBoundingClientRect();
            let bottom = rr.top;
            const sels = [
                '.header-container',
                '#header.header-container',
                '#header',
                '.toggle-btn',
                '.toggle-btn-hover',
                '#curtain-arrow'
            ];
            sels.forEach((sel) => {
                try {
                    document.querySelectorAll(sel).forEach((el) => {
                        if (!el) return;
                        const r = el.getBoundingClientRect();
                        if (r.height < 1 && r.width < 1) return;
                        // Curtain tab sits on the top edge (partially above root).
                        if (r.bottom < rr.top - 2) return;
                        if (r.top > rr.top + 130) return;
                        bottom = Math.max(bottom, Math.min(r.bottom, rr.top + 130));
                    });
                } catch (_) {}
            });
            return Math.max(0, Math.ceil(bottom - rr.top));
        } catch (_) {
            return 0;
        }
    }

    /** Top safe inset so panels stay below native hover/blocking chrome. */
    function omtPanelTopSafeMargin(rootEl) {
        try {
            const id = site && site.id;
            if (id === 'inplayip') {
                const measured = omtMeasureInplayTopChromePx(rootEl);
                // Field fallback: header-container height 60px (inplayip CSS).
                return (measured > 0 ? measured : 60) + OMT_TOP_SAFE_GAP_PX;
            }
            if (id === 'examino') {
                const measured = omtMeasureExaminoTopBlockPx(rootEl);
                // Field: ~100px dark top overlay at 1080p — scale with player height.
                let fallback = 100;
                try {
                    const rh = (rootEl || omtRoot).getBoundingClientRect().height || 1080;
                    fallback = Math.max(48, Math.round(rh * (100 / 1080)));
                } catch (_) {}
                return (measured > 0 ? measured : fallback) + OMT_TOP_SAFE_GAP_PX;
            }
        } catch (_) {}
        return 8;
    }

    /**
     * Clamp a floating panel fully inside its container. Keeps the user's
     * position when it already fits; otherwise pins to the nearest edge.
     * Uses unscaled offsetWidth/Height (same as Xeatre v2.2.20) so scaled
     * getBoundingClientRect never mixes with layout left/bottom.
     * v2.3.6: top safe margin (measured InPlay / Examino chrome) + NEVER
     * convert a default CSS-centered panel into left/top px.
     * Returns true when style was adjusted.
     */
    function omtClampPanelInContainer(panel, rootEl) {
        if (!panel || !rootEl || !panel.style) return false;
        let changed = false;
        try {
            // Default centered (never dragged) — leave CSS alone on every
            // resize / fullscreen change (InPlay, Examino, Xeatre).
            if (!omtPanelIsUserPositioned(panel)) return false;

            const rootRect = rootEl.getBoundingClientRect();
            const panelW = panel.offsetWidth || 0;
            const panelH = panel.offsetHeight || 0;
            if (panelW < 4 || panelH < 4 || rootRect.width < 4 || rootRect.height < 4) {
                return false;
            }

            const topSafe = omtPanelTopSafeMargin(rootEl);

            const parsePx = (v) => {
                if (!v || v === 'auto') return null;
                if (!/px$/i.test(v)) return null;
                const n = parseFloat(v);
                return Number.isFinite(n) ? n : null;
            };
            const styleLeft = parsePx(panel.style.left);
            const styleBottom = parsePx(panel.style.bottom);
            const styleTop = parsePx(panel.style.top);

            const rect = panel.getBoundingClientRect();

            let left;
            let bottom;
            const useBottom =
                styleBottom != null &&
                (panel.style.top === 'auto' || panel.style.top === '' || styleTop == null);

            if (useBottom && styleLeft != null) {
                left = styleLeft;
                bottom = styleBottom;
            } else if (styleLeft != null && styleTop != null) {
                left = styleLeft;
                bottom = Math.max(0, rootRect.height - styleTop - panelH);
            } else {
                left = rect.left - rootRect.left;
                bottom = rootRect.bottom - rect.bottom;
            }

            const maxLeft = Math.max(0, rootRect.width - panelW);
            // Cap bottom so panel top stays >= topSafe:
            // top = rootH - bottom - panelH >= topSafe
            // => bottom <= rootH - panelH - topSafe
            const maxBottom = Math.max(0, rootRect.height - panelH - topSafe);
            const nextLeft = Math.max(0, Math.min(left, maxLeft));
            const nextBottom = Math.max(0, Math.min(bottom, maxBottom));

            if (Math.abs(nextLeft - left) > 0.5 || Math.abs(nextBottom - bottom) > 0.5 ||
                panel.style.top !== 'auto' || panel.style.transform !== 'none') {
                panel.style.left = nextLeft + 'px';
                panel.style.bottom = nextBottom + 'px';
                panel.style.top = 'auto';
                panel.style.right = 'auto';
                panel.style.transform = 'none';
                changed = true;
            }
        } catch (_) {}
        return changed;
    }

    /** Clamp primary + every InPlay multi-view tile panel into its own root. */
    function omtClampAllPanels() {
        try {
            if (typeof controlsPanel !== 'undefined' && controlsPanel &&
                typeof omtRoot !== 'undefined' && omtRoot) {
                omtClampPanelInContainer(controlsPanel, omtRoot);
                if (typeof updateControlsTipFlip === 'function') {
                    try { updateControlsTipFlip(); } catch (_) {}
                }
            }
        } catch (_) {}
        try {
            document.querySelectorAll('[data-omt-tile-root]').forEach((tile) => {
                const panel = tile.querySelector('.omt-controls-panel');
                if (panel) omtClampPanelInContainer(panel, tile);
            });
        } catch (_) {}
    }

    let omtPanelClampTimer = 0;
    /** Debounced clamp — resize / fullscreen only (no polling, no rAF loop). */
    function omtSchedulePanelClamp() {
        if (omtPanelClampTimer) {
            try { clearTimeout(omtPanelClampTimer); } catch (_) {}
        }
        omtPanelClampTimer = setTimeout(() => {
            omtPanelClampTimer = 0;
            omtClampAllPanels();
        }, 50);
    }

    try { window.__omtClampAllPanels = omtClampAllPanels; } catch (_) {}
    try { window.__omtSchedulePanelClamp = omtSchedulePanelClamp; } catch (_) {}
    try { window.__omtPanelTopSafeMargin = omtPanelTopSafeMargin; } catch (_) {}
    try { window.__omtPanelIsUserPositioned = omtPanelIsUserPositioned; } catch (_) {}

    /** True when the pointer is within `margin` px of the panel's border/corner. */
    function omtPanelEdgeGrabHit(e, panel, margin) {
        const r = panel.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const m = margin == null ? 8 : margin;
        if (x < 0 || y < 0 || x > r.width || y > r.height) return false;
        return x < m || y < m || x > r.width - m || y > r.height - m;
    }

    /** Block Edge text-selection mini-menu on panel/bar dblclick (inputs stay editable). */
    function omtInstallPanelNoTextSelect(panel) {
        if (!panel || panel.dataset.omtNoSelectWired === '1') return;
        try { panel.dataset.omtNoSelectWired = '1'; } catch (_) {}
        panel.addEventListener('dblclick', (e) => {
            if (e.target && e.target.closest &&
                e.target.closest('input, textarea, select, [contenteditable="true"], #timer-edit-input, .is-editing')) {
                return;
            }
            e.preventDefault();
            try {
                const sel = window.getSelection && window.getSelection();
                if (sel && sel.removeAllRanges) sel.removeAllRanges();
            } catch (_) {}
        }, true);
    }

    function fazerArrastavel(panel, handle, rootEl) {
        let grabOffsetX = 0;
        let grabOffsetY = 0;
        let dragging = false;
        let activePointerId = null;

        function dragRootRect() {
            const root = rootEl || omtRoot;
            return root
                ? root.getBoundingClientRect()
                : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        }

        function drag(e) {
            if (!dragging) return;
            // Prefer pointer events when available; fall back to mouse.
            if (e.pointerId != null && activePointerId != null && e.pointerId !== activePointerId) {
                return;
            }
            e.preventDefault();

            // Unscaled size + pointer grab offset (v2.2.20). Never mix scaled
            // getBoundingClientRect with layout left/bottom — that drifted to
            // the corner on Xeatre. Same path Examino uses: left/top in px.
            // Optional rootEl: InPlay multi-view tile panels (v2.3.0).
            const rootRect = dragRootRect();
            const panelW = panel.offsetWidth || 0;
            const panelH = panel.offsetHeight || 0;
            const topSafe = omtPanelTopSafeMargin(rootEl || omtRoot);
            const maxLeft = Math.max(0, rootRect.width - panelW);
            const minTop = topSafe;
            const maxTop = Math.max(minTop, rootRect.height - panelH);

            let newLeft = e.clientX - rootRect.left - grabOffsetX;
            let newTop = e.clientY - rootRect.top - grabOffsetY;
            newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            newTop = Math.max(minTop, Math.min(newTop, maxTop));

            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
            panel.style.bottom = 'auto';
            panel.style.right = 'auto';
            panel.style.transform = 'none';
        }

        function stopDrag() {
            if (!dragging) return;
            dragging = false;
            activePointerId = null;
            window.removeEventListener('pointermove', drag, true);
            window.removeEventListener('mousemove', drag, true);
            window.removeEventListener('pointerup', stopDrag, true);
            window.removeEventListener('mouseup', stopDrag, true);
            window.removeEventListener('pointercancel', stopDrag, true);
            window.removeEventListener('blur', stopDrag, true);
            document.removeEventListener('visibilitychange', onVisibilityStop, true);
            // Store as bottom-anchored so a later more-panel expand grows UP.
            if (panel === controlsPanel && typeof anchorControlsPanelBottom === 'function') {
                anchorControlsPanelBottom();
            } else if (typeof omtClampPanelInContainer === 'function') {
                // Tile panels stay left/top during drag — clamp into tile root.
                omtClampPanelInContainer(panel, rootEl || omtRoot);
            }
            if (panel === controlsPanel && typeof updateControlsTipFlip === 'function') {
                updateControlsTipFlip();
            }
        }

        function onVisibilityStop() {
            if (document.visibilityState === 'hidden') stopDrag();
        }

        function startDrag(e) {
            // Ignore clicks on interactive child elements
            if (e.target.closest && e.target.closest('button, select, input, textarea, a, label')) return;
            // Only primary button / touch.
            if (e.button != null && e.button !== 0) return;
            if (dragging) return;
            e.preventDefault();
            try { e.stopPropagation(); } catch (_) {}

            const rootRect = dragRootRect();
            const rect = panel.getBoundingClientRect();

            // Mark as user-dragged BEFORE converting CSS center → left/top px.
            try { panel.dataset.omtUserDragged = '1'; } catch (_) {}
            try { delete panel.dataset.omtXeatreAutoClamp; } catch (_) {}

            // Convert whatever CSS (bottom / left:50% / transform) into left+top px
            // before the first move — one consistent anchor for the whole gesture.
            panel.style.left = (rect.left - rootRect.left) + 'px';
            panel.style.top = (rect.top - rootRect.top) + 'px';
            panel.style.bottom = 'auto';
            panel.style.right = 'auto';
            panel.style.transform = 'none';

            // Pointer offset inside the panel (client space).
            grabOffsetX = e.clientX - rect.left;
            grabOffsetY = e.clientY - rect.top;

            dragging = true;
            activePointerId = e.pointerId != null ? e.pointerId : null;

            // Capture-phase on window so mouseup/pointerup outside the panel
            // (and past omtRoot stopPropagation on click only) always ends drag.
            window.addEventListener('pointermove', drag, true);
            window.addEventListener('mousemove', drag, true);
            window.addEventListener('pointerup', stopDrag, true);
            window.addEventListener('mouseup', stopDrag, true);
            window.addEventListener('pointercancel', stopDrag, true);
            window.addEventListener('blur', stopDrag, true);
            document.addEventListener('visibilitychange', onVisibilityStop, true);

            try {
                if (e.pointerId != null && handle && handle.setPointerCapture) {
                    handle.setPointerCapture(e.pointerId);
                } else if (e.pointerId != null && panel.setPointerCapture) {
                    panel.setPointerCapture(e.pointerId);
                }
            } catch (_) {}
        }

        /** Handle drag OR ~8px edge/corner grab (v2.3.6). Buttons stay clickable. */
        function maybeStartFromPanel(e) {
            if (e.target.closest && e.target.closest('button, select, input, textarea, a, label')) return;
            const onHandle = !!(handle && e.target.closest && (
                e.target === handle || handle.contains(e.target) ||
                e.target.closest('.drag-handle, .drag-center-grip, [data-omt-tile-handle]')
            ));
            if (!onHandle && !omtPanelEdgeGrabHit(e, panel, 8)) return;
            startDrag(e);
        }

        if (handle) {
            handle.addEventListener('pointerdown', startDrag);
            // Older paths / synthetic tests may only fire mousedown.
            handle.addEventListener('mousedown', function (e) {
                if (e.pointerType) return; // pointerdown already handled
                startDrag(e);
            });
        }
        // Edge/corner grab on the panel itself (in addition to the handle).
        panel.addEventListener('pointerdown', maybeStartFromPanel);
        panel.addEventListener('mousedown', function (e) {
            if (e.pointerType) return;
            maybeStartFromPanel(e);
        });
        omtInstallPanelNoTextSelect(panel);
    }
