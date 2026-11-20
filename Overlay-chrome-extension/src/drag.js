/* Draggable glass panels. */
    /* =========================================================
       15. PANEL DRAG SYSTEM
       ========================================================= */
    function fazerArrastavel(panel, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        let dragging = false;
        let activePointerId = null;

        function drag(e) {
            if (!dragging) return;
            // Prefer pointer events when available; fall back to mouse.
            if (e.pointerId != null && activePointerId != null && e.pointerId !== activePointerId) {
                return;
            }
            e.preventDefault();
            const clientX = e.clientX;
            const clientY = e.clientY;
            pos1 = pos3 - clientX;
            pos2 = pos4 - clientY;
            pos3 = clientX;
            pos4 = clientY;

            const rootRect = omtRoot ? omtRoot.getBoundingClientRect() : null;
            const maxTop = rootRect
                ? Math.max(0, rootRect.height - panel.offsetHeight)
                : Math.max(0, window.innerHeight - panel.offsetHeight);
            const maxLeft = rootRect
                ? Math.max(0, rootRect.width - panel.offsetWidth)
                : Math.max(0, window.innerWidth - panel.offsetWidth);

            let newTop = panel.offsetTop - pos2;
            let newLeft = panel.offsetLeft - pos1;

            newTop = Math.max(0, Math.min(newTop, maxTop));
            newLeft = Math.max(0, Math.min(newLeft, maxLeft));

            panel.style.top = newTop + 'px';
            panel.style.left = newLeft + 'px';
            panel.style.bottom = 'auto';
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

            // Anchor the panel at its current rendered position before clearing transforms
            const rect = panel.getBoundingClientRect();
            const rootRect = omtRoot.getBoundingClientRect();
            panel.style.top = (rect.top - rootRect.top) + 'px';
            panel.style.left = (rect.left - rootRect.left) + 'px';
            panel.style.transform = 'none';
            panel.style.bottom = 'auto';

            pos3 = e.clientX;
            pos4 = e.clientY;
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
