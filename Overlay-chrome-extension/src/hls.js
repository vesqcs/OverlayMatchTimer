/* Locate hls.js / VHS and soften live-edge snap for DVR. */
    /* =========================================================
       2. HLS INSTANCE DISCOVERY & DVR PATCH
       ========================================================= */
    function getHlsInstance() {
        // ---- Try Video.js player registry ----
        if (window.videojs) {
            try {
                const players = videojs.getPlayers ? videojs.getPlayers() : {};
                for (const id in players) {
                    const player = players[id];
                    if (!player) continue;
                    // Access tech without triggering deprecation warning
                    const tech = player.tech_ || (player.tech && player.tech({ IWillNotUseThisInPlugins: true }));
                    if (!tech) continue;
                    if (tech.vhs) return tech.vhs;        // Video.js VHS
                    if (tech.hls) return tech.hls;        // older videojs-contrib-hls
                    if (tech.hlsProvider && tech.hlsProvider.hls) return tech.hlsProvider.hls;
                    if (tech.hls_) return tech.hls_;
                }
            } catch (e) { /* ignore */ }
        }
        // ---- Fallback: hls.js attached directly to the element ----
        if (vid._hls) return vid._hls;
        if (vid.hls) return vid.hls;
        return null;
    }

    function patchHlsForDvr() {
        if (!hlsInstance) return;
        try {
            // hls.js config object
            if (hlsInstance.config) {
                hlsInstance.config.liveMaxLatencyDuration = 86400;
                hlsInstance.config.liveSyncDuration = 5;
                console.log('[OMT] HLS DVR patch applied.');
            }
            // VHS: update playlist controller if available
            if (hlsInstance.masterPlaylistController_) {
                const mpc = hlsInstance.masterPlaylistController_;
                if (mpc.hls_ && mpc.hls_.config) {
                    mpc.hls_.config.liveMaxLatencyDuration = 86400;
                }
            }
        } catch (e) {
            console.log('[OMT] HLS patch skipped:', e.message);
        }
    }
