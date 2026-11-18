/* Transport: seek, play/pause, frames, speed, LIVE, mute, fullscreen. */
    /* =========================================================
       12. PLAYBACK CONTROLS
       ========================================================= */
    // Symmetric speed ladder (1x centre). Shared by chips, select, Z/C/X.
    const OMT_SPEED_RATES = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    const OMT_SPEED_SELECT_VALUES = {
        0.25: '0.25',
        0.5: '0.5',
        0.75: '0.75',
        1.0: '1.0',
        1.25: '1.25',
        1.5: '1.5',
        2.0: '2.0'
    };

    // Examino OpenPlayer may replace <video> during DVR/VOD switches.
    // Prefer the live connected element so transport/speed always hit the player.
    function ensureLiveVideo() {
        if (vid && vid.isConnected) return vid;
        const found = (site && typeof site.findVideo === 'function')
            ? site.findVideo()
            : document.querySelector('video');
        return found ? omtAdoptReplacedVideo(found) : vid;
    }

    function closestSpeedRate(rate) {
        const current = parseFloat(rate);
        if (!isFinite(current)) return 1.0;
        return OMT_SPEED_RATES.reduce((prev, curr) =>
            Math.abs(curr - current) < Math.abs(prev - current) ? curr : prev, 1.0);
    }

    function saltarVideo(segundos) {
        if (!ensureLiveVideo()) return;
        if (typeof clearAutoPauseFlag === 'function') clearAutoPauseFlag();
        seekTo(vid.currentTime + segundos);
        mostrarOSD((segundos > 0 ? '+' : '') + segundos + 's');
    }

    function togglePlay() {
        if (!ensureLiveVideo()) return;
        if (typeof clearAutoPauseFlag === 'function') clearAutoPauseFlag();
        if (vid.paused || vid.ended) {
            safePlay(vid);
            mostrarOSD('Play');
        } else {
            vid.pause();
            mostrarOSD('Pause');
        }
    }

    function avancarFrame() {
        if (!ensureLiveVideo()) return;
        if (typeof clearAutoPauseFlag === 'function') clearAutoPauseFlag();
        vid.pause();
        vid.currentTime += 0.04;
        mostrarOSD('+1 Frame');
    }

    function retrocederFrame() {
        if (!ensureLiveVideo()) return;
        if (typeof clearAutoPauseFlag === 'function') clearAutoPauseFlag();
        vid.pause();
        vid.currentTime -= 0.04;
        mostrarOSD('-1 Frame');
    }

    function selecionarVelocidade() {
        if (!ensureLiveVideo() || !speedSelect) return;
        applyPlaybackSpeed(speedSelect.value);
        speedSelect.blur();
    }

    function applyPlaybackSpeed(rate, { announce = true } = {}) {
        const valor = parseFloat(rate);
        if (!ensureLiveVideo() || !isFinite(valor) || valor <= 0) return;
        const closest = closestSpeedRate(valor);
        vid.playbackRate = closest;
        if (speedSelect) {
            speedSelect.value = OMT_SPEED_SELECT_VALUES[closest] || String(closest);
        }
        syncSpeedChips();
        if (announce) mostrarOSD('Speed: ' + closest.toFixed(2) + 'x');
    }

    function syncSpeedChips() {
        if (!omtRoot || !ensureLiveVideo()) return;
        const rate = closestSpeedRate(vid.playbackRate || 1);
        const chips = omtRoot.querySelectorAll('.omt-speed-chip');
        chips.forEach((chip) => {
            const chipRate = parseFloat(chip.getAttribute('data-speed'));
            const active = Math.abs(chipRate - rate) < 0.05;
            chip.classList.toggle('is-active', active);
            chip.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function atualizarBotaoPlay(playing) {
        const on = !!playing;
        if (btnMainPlay) {
            // Playing → orange pause icon; paused → grey/white play icon.
            btnMainPlay.innerHTML = on ? omtIcon('pause', 22) : omtIcon('play', 22);
            btnMainPlay.classList.toggle('playing', on);
            btnMainPlay.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        if (btnTimelinePlay) {
            btnTimelinePlay.innerHTML = on ? omtIcon('pause', 16) : omtIcon('play', 16);
            btnTimelinePlay.classList.toggle('playing', on);
            btnTimelinePlay.setAttribute('aria-pressed', on ? 'true' : 'false');
            btnTimelinePlay.setAttribute('aria-label', on ? 'Pause' : 'Play');
        }
    }

    function syncPlayButtonFromVideo() {
        if (!ensureLiveVideo()) return;
        const playing = !vid.paused && !vid.ended;
        atualizarBotaoPlay(playing);
        if (controlsPanel) controlsPanel.classList.toggle('playing-state', playing);
    }

    function irParaLive() {
        if (!ensureLiveVideo()) return;
        // Adaptive safe point behind seekable end (never raw edge — stalls).
        // Manual skips are not clamped to this margin.
        let target = null;
        if (typeof omtLiveSafePointSec === 'function') {
            target = omtLiveSafePointSec();
        }
        if (!(target > 0)) {
            try {
                if (vid.seekable && vid.seekable.length > 0) {
                    const edge = vid.seekable.end(vid.seekable.length - 1);
                    const margin = (typeof OMT_LIVE_SAFE_MARGIN_S === 'number') ? OMT_LIVE_SAFE_MARGIN_S : 10;
                    target = Math.max(0, edge - margin);
                } else if (vid.duration && isFinite(vid.duration)) {
                    const margin = (typeof OMT_LIVE_SAFE_MARGIN_S === 'number') ? OMT_LIVE_SAFE_MARGIN_S : 10;
                    target = Math.max(0, vid.duration - margin);
                }
            } catch (_) {}
        }
        if (target != null && isFinite(target)) {
            seekTo(target);
        }
        // After going live, clear seek lock so stream can advance normally
        setTimeout(() => { userIntendedTime = null; seekLockUntil = 0; }, 3000);
        const marginUsed = (typeof omtAdaptiveLiveSafeMarginSec === 'function')
            ? omtAdaptiveLiveSafeMarginSec()
            : OMT_LIVE_SAFE_MARGIN_S;
        mostrarOSD('Live −' + Math.round(marginUsed) + 's');
        if (liveBtn) liveBtn.blur();
    }

    // Redesign scrubber chrome only: skip redundant omt-at-live / --omt-progress
    // writes when presentation has not changed. Original is-live toggle is untouched.
    let _omtLiveUiAtLive = null;
    let _omtLiveUiProgressPct = null;

    /** Paint fill from current slider value (optimistic on click/drag; reconcile on timeupdate). */
    function paintTimelineScrubberProgress(force) {
        if (!timelineSlider) return;
        const min = parseFloat(timelineSlider.min) || 0;
        const max = parseFloat(timelineSlider.max) || 0;
        const val = parseFloat(timelineSlider.value) || 0;
        const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
        const rounded = Math.round(pct * 10) / 10;
        if (!force && _omtLiveUiProgressPct === rounded) return;
        _omtLiveUiProgressPct = rounded;
        timelineSlider.style.setProperty('--omt-progress', Math.max(0, Math.min(100, rounded)) + '%');
    }

    function atualizarEstadoLive() {
        if (!vid || !liveBtn) return; // null-guard: called from timeupdate, may fire after teardown
        let liveEdge = 0;
        if (vid.seekable && vid.seekable.length > 0) {
            liveEdge = vid.seekable.end(vid.seekable.length - 1);
        } else if (vid.duration && isFinite(vid.duration)) {
            liveEdge = vid.duration;
        }
        if (typeof omtNoteLiveEdgeAdvance === 'function') omtNoteLiveEdgeAdvance(liveEdge);
        const dist = liveEdge - vid.currentTime;
        const liveThresh = (typeof OMT_LIVE_SAFE_MARGIN_S === 'number' && OMT_LIVE_SAFE_MARGIN_S > 0)
            ? OMT_LIVE_SAFE_MARGIN_S : 10;
        const atLive = liveEdge > 0 && dist <= liveThresh;
        liveBtn.classList.toggle('is-live', atLive);
        // Presentation only (redesign): drive scrubber colour (red at live / grey behind)
        if (_omtLiveUiAtLive !== atLive) {
            _omtLiveUiAtLive = atLive;
            const timelineBar = omtRoot ? omtRoot.querySelector('#omt-timeline-bar') : null;
            if (timelineBar) timelineBar.classList.toggle('omt-at-live', atLive);
            if (controlsPanel) controlsPanel.classList.toggle('omt-at-live', atLive);
        }
        // Right-side LIVE delay / POST times (UI only; same liveEdge/playhead values).
        if (typeof atualizarTempoTimelineDireito === 'function') atualizarTempoTimelineDireito();
        // While the user is scrubbing, input handler owns the fill (avoid fighting the thumb).
        if (!isDraggingTimeline) paintTimelineScrubberProgress(false);
    }

    function toggleFullScreen() {
        const container = site.findFullscreenTarget(vid);
        if (!document.fullscreenElement) {
            (container || vid).requestFullscreen().catch(() => vid.requestFullscreen().catch(() => { }));
        } else {
            document.exitFullscreen();
        }
    }

    function syncVolumeControlsFromVideo() {
        if (!vid) return;
        const muted = !!(vid.muted || vid.volume === 0);
        const vol = muted ? 0 : (vid.volume || 0);
        if (volumeRange) volumeRange.value = vol;
        if (timelineVolRange) timelineVolRange.value = vol;
        atualizarIconeVolume(vol);
    }

    function toggleMute() {
        if (vid.volume > 0 && !vid.muted) {
            ultimoVolume = vid.volume;
            vid.volume = 0;
            vid.muted = true;
        } else {
            vid.volume = ultimoVolume > 0 ? ultimoVolume : 1;
            vid.muted = false;
        }
        syncVolumeControlsFromVideo();
        localStorage.setItem('matchTimerVolume', vid.muted ? 0 : vid.volume);
        if (volumeIconBtn) volumeIconBtn.blur();
        if (timelineVolBtn) timelineVolBtn.blur();
    }

    function atualizarIconeVolume(vol) {
        const name = vol === 0 ? 'volume-x' : vol < 0.5 ? 'volume-1' : 'volume-2';
        const html = omtIcon(name, 15);
        if (volumeIconBtn) volumeIconBtn.innerHTML = html;
        if (timelineVolBtn) {
            timelineVolBtn.innerHTML = omtIcon(name, 16);
            timelineVolBtn.setAttribute('aria-label', vol === 0 ? 'Unmute' : 'Mute');
            timelineVolBtn.setAttribute('aria-pressed', vol === 0 ? 'true' : 'false');
        }
    }
