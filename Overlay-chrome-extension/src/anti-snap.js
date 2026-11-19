/* Keep seeks inside seekable range; resist VHS live-edge snap. */
    /* =========================================================
       7. ANTI-LIVE-SNAP ENGINE
       Prevents the HLS player from auto-advancing the playhead
       back to the live edge after a user-initiated seek.
       ========================================================= */

    // User-gesture latch so autoplay-policy play() is only attempted after
    // pointer/key (avoids NotAllowedError noise on Xeatre dvrplayer).
    let omtUserGestureSeen = false;
    try {
        const markGesture = () => { omtUserGestureSeen = true; };
        document.addEventListener('pointerdown', markGesture, true);
        document.addEventListener('keydown', markGesture, true);
    } catch (_) {}

    /** Always catch play() rejection (AbortError / NotAllowedError) so the
     *  console never shows an uncaught promise from our code.
     *  Xeatre: skip speculative play() until a user gesture (host also autoplays). */
    function safePlay(media) {
        if (!media) return Promise.resolve();
        try {
            if (site && site.id === 'xeatre' && !omtUserGestureSeen && media.paused) {
                return Promise.resolve();
            }
            const p = media.play();
            if (p && typeof p.then === 'function') {
                return p.catch(() => {});
            }
        } catch (_) {}
        return Promise.resolve();
    }

    function omtVideoInFullscreen(media) {
        try {
            const el = media || vid;
            const fs = document.fullscreenElement;
            return !!(fs && el && (fs === el || fs.contains(el)));
        } catch (_) {
            return false;
        }
    }

    /**
     * After Alt+Tab / visibility return, Chrome can leave a fullscreen
     * <video> "playing" with a frozen last frame until FS exit. Re-assert
     * play() only when media already thinks it is playing — never unpauses
     * a user pause, never starts a play/pause loop.
     */
    function wakeFullscreenDecode() {
        if (!vid || !vid.isConnected) return;
        if (!omtVideoInFullscreen(vid)) return;
        if (vid.paused || vid.ended) return;
        safePlay(vid);
    }

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
        if (!vid) return;
        const t = clampToSeekable(time);
        userIntendedTime = t;
        seekLockUntil = Date.now() + 4000; // 4-second protection window
        const wasPlaying = !vid.paused && !vid.ended;
        vid.currentTime = t;
        wakeAfterFullscreenSeek(wasPlaying);
    }

    /** Local/FS: Chrome can leave decode stalled after a seek while the
     *  element is fullscreen (frames only catch up on exit). Re-assert play
     *  only if we were already playing — never toggles pause/play. */
    function wakeAfterFullscreenSeek(wasPlaying) {
        if (wasPlaying && omtVideoInFullscreen(vid)) safePlay(vid);
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
