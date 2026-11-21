/* Draggable glass panels. */
    /* =========================================================
       15. PANEL DRAG SYSTEM
       ========================================================= */
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
            const maxLeft = Math.max(0, rootRect.width - panelW);
            const maxTop = Math.max(0, rootRect.height - panelH);

            let newLeft = e.clientX - rootRect.left - grabOffsetX;
            let newTop = e.clientY - rootRect.top - grabOffsetY;
            newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            newTop = Math.max(0, Math.min(newTop, maxTop));

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
            if (e.target.closest && e.target.closest('button, select, input')) return;
            // Only primary button / touch.
            if (e.button != null && e.button !== 0) return;
            e.preventDefault();

            const rootRect = dragRootRect();
            const rect = panel.getBoundingClientRect();

            // Convert whatever CSS (bottom / left:50% / transform) into left+top px
            // before the first move — one consistent anchor for the whole gesture.
            panel.style.left = (rect.left - rootRect.left) + 'px';
            panel.style.top = (rect.top - rootRect.top) + 'px';
            panel.style.bottom = 'auto';
            panel.style.right = 'auto';
            panel.style.transform = 'none';
            try { delete panel.dataset.omtXeatreAutoClamp; } catch (_) {}

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
                if (e.pointerId != null && handle.setPointerCapture) {
                    handle.setPointerCapture(e.pointerId);
                }
            } catch (_) {}
        }

        handle.addEventListener('pointerdown', startDrag);
        // Older paths / synthetic tests may only fire mousedown.
        handle.addEventListener('mousedown', function (e) {
            if (e.pointerType) return; // pointerdown already handled
            startDrag(e);
        });
    }
