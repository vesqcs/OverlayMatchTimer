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
        if (found) vid = found;
        return vid;
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
        if (vid.paused || vid.ended) { vid.play(); mostrarOSD('Play'); }
        else { vid.pause(); mostrarOSD('Pause'); }
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
        if (!btnMainPlay) return;
        // Playing → orange pause icon; paused → grey/white play icon.
        btnMainPlay.innerHTML = playing ? omtIcon('pause', 22) : omtIcon('play', 22);
        btnMainPlay.classList.toggle('playing', !!playing);
        btnMainPlay.setAttribute('aria-pressed', playing ? 'true' : 'false');
    }

    function syncPlayButtonFromVideo() {
        if (!ensureLiveVideo()) return;
        const playing = !vid.paused && !vid.ended;
        atualizarBotaoPlay(playing);
        if (controlsPanel) controlsPanel.classList.toggle('playing-state', playing);
    }

    function irParaLive() {
        // Try to read the live sync position from hls.js directly
        // (seek target / timing logic unchanged from v1.2.2 / v1.3.0)
        if (hlsInstance && typeof hlsInstance.liveSyncPosition === 'number') {
            seekTo(hlsInstance.liveSyncPosition);
        } else if (vid.seekable && vid.seekable.length > 0) {
            seekTo(vid.seekable.end(vid.seekable.length - 1) - 3);
        } else if (vid.duration && isFinite(vid.duration)) {
            seekTo(vid.duration - 3);
        }
        // After going live, clear seek lock so stream can advance normally
        setTimeout(() => { userIntendedTime = null; seekLockUntil = 0; }, 3000);
        mostrarOSD('Going Live');
        liveBtn.blur();
    }

    function atualizarEstadoLive() {
        if (!vid || !liveBtn) return; // null-guard: called from timeupdate, may fire after teardown
        let liveEdge = 0;
        if (vid.seekable && vid.seekable.length > 0) {
            liveEdge = vid.seekable.end(vid.seekable.length - 1);
        } else if (vid.duration && isFinite(vid.duration)) {
            liveEdge = vid.duration;
        }
        const dist = liveEdge - vid.currentTime;
        const atLive = liveEdge > 0 && dist <= 8;
        liveBtn.classList.toggle('is-live', atLive);
        // Presentation only: drive scrubber colour (red at live / grey behind)
        const timelineBar = omtRoot ? omtRoot.querySelector('#omt-timeline-bar') : null;
        if (timelineBar) timelineBar.classList.toggle('omt-at-live', atLive);
        if (controlsPanel) controlsPanel.classList.toggle('omt-at-live', atLive);
        if (timelineSlider) {
            const min = parseFloat(timelineSlider.min) || 0;
            const max = parseFloat(timelineSlider.max) || 0;
            const val = parseFloat(timelineSlider.value) || 0;
            const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
            timelineSlider.style.setProperty('--omt-progress', Math.max(0, Math.min(100, pct)) + '%');
        }
    }

    function toggleFullScreen() {
        const container = site.findFullscreenTarget(vid);
        if (!document.fullscreenElement) {
            (container || vid).requestFullscreen().catch(() => vid.requestFullscreen().catch(() => { }));
        } else {
            document.exitFullscreen();
        }
    }

    function toggleMute() {
        if (vid.volume > 0 && !vid.muted) {
            ultimoVolume = vid.volume;
            vid.volume = 0;
            vid.muted = true;
            volumeRange.value = 0;
        } else {
            vid.volume = ultimoVolume > 0 ? ultimoVolume : 1;
            vid.muted = false;
            volumeRange.value = vid.volume;
        }
        atualizarIconeVolume(vid.volume);
        localStorage.setItem('matchTimerVolume', vid.volume);
        volumeIconBtn.blur();
    }

    function atualizarIconeVolume(vol) {
        if (!volumeIconBtn) return;
        const name = vol === 0 ? 'volume-x' : vol < 0.5 ? 'volume-1' : 'volume-2';
        volumeIconBtn.innerHTML = omtIcon(name, 15);
    }
