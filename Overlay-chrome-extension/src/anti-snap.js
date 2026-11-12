/* Keep seeks inside seekable range; resist VHS live-edge snap. */
    /* =========================================================
       7. ANTI-LIVE-SNAP ENGINE
       Prevents the HLS player from auto-advancing the playhead
       back to the live edge after a user-initiated seek.
       ========================================================= */
    function clampToSeekable(time) {
        if (!vid || !vid.seekable || vid.seekable.length === 0) return time;
        try {
            const start = vid.seekable.start(0);
            const end = vid.seekable.end(vid.seekable.length - 1);
            if (!isFinite(start) || !isFinite(end)) return time;
            return Math.min(Math.max(time, start), end);
        } catch (_) {
            return time;
        }
    }

    function seekTo(time) {
        const t = clampToSeekable(time);
        userIntendedTime = t;
        seekLockUntil = Date.now() + 4000; // 4-second protection window
        vid.currentTime = t;
    }

    function antiLiveSnap() {
        if (!userIntendedTime || Date.now() > seekLockUntil) return;

        const drift = vid.currentTime - userIntendedTime;
        // If the stream has pulled us more than 8s forward from where we wanted to be, snap back
        if (drift > 8) {
            vid.currentTime = userIntendedTime;
        } else {
            // Update intended time naturally as playback progresses normally
            userIntendedTime = vid.currentTime;
        }
    }
