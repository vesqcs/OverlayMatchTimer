/* Draggable glass panels. */
    /* =========================================================
       15. PANEL DRAG SYSTEM
       ========================================================= */
    function fazerArrastavel(panel, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        handle.onmousedown = function (e) {
            // Ignore clicks on interactive child elements
            if (e.target.closest('button, select, input')) return;
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

            document.onmousemove = drag;
            document.onmouseup = stopDrag;
        };

        function drag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;

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
            document.onmouseup = null;
            document.onmousemove = null;
            // Store as bottom-anchored so a later more-panel expand grows UP.
            if (panel === controlsPanel && typeof anchorControlsPanelBottom === 'function') {
                anchorControlsPanelBottom();
            }
            if (panel === controlsPanel && typeof updateControlsTipFlip === 'function') {
                updateControlsTipFlip();
            }
        }
    }
