/* Delegate host-chrome suppression to the active site adapter. */
    /* =========================================================
       3. SUPPRESS NATIVE VIDEO.JS CONTROLS
       ========================================================= */
    function suppressNativeControls() {
        vid.controls = false;

        // Video.js / OpenPlayer may re-enable native controls during startup.
        // We watch for that race condition and immediately override it.
        // Performance contract:
        //   - The callback is debounced (10 ms) so rapid consecutive mutations
        //     collapse into a single correction instead of firing per-attribute-write.
        //   - The observer automatically disconnects after 10 s — more than enough
        //     time to win any VJS startup race — so it never polls continuously.
        //   - The module-level `controlsObserver` reference lets teardown() clean
        //     it up immediately on SPA navigation without waiting for the timer.
        let debounceTimer = null;
        controlsObserver = new MutationObserver(() => {
            if (debounceTimer) return; // already scheduled, collapse this mutation
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                if (vid && vid.controls) vid.controls = false;
            }, 10);
        });
        controlsObserver.observe(vid, { attributes: true, attributeFilter: ['controls'] });

        // Auto-disconnect once the VJS startup window has passed.
        const autoDisconnectMs = 10000;
        setTimeout(() => {
            if (controlsObserver) {
                controlsObserver.disconnect();
                controlsObserver = null;
                console.log('[OMT] controls-attribute observer disconnected (startup window elapsed).');
            }
        }, autoDisconnectMs);

        // Site-specific native chrome / focus suppression (Inplay VJS or OpenPlayer).
        site.suppressHostControls(vid);
    }
