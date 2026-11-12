/* Contour ShuttleXpress via WebHID. */
    /* =========================================================
       16B. CONTOUR SHUTTLEXPRESS WEBHID MODULE
       ========================================================= */
    let shuttleDevice = null;
    let lastJogValue = null;
    let prevBytes3 = 0;
    let prevBytes4 = 0;
    let shuttleInterval = null;
    let currentShuttleSpeed = 0;

    function getShuttleSpeedFactor(b0) {
        if (b0 >= 1 && b0 <= 7) {
            const factors = [0.2, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0];
            return factors[b0 - 1];
        } else if (b0 >= 249 && b0 <= 255) {
            const factors = [-0.2, -0.5, -1.0, -2.0, -4.0, -8.0, -16.0];
            const index = 255 - b0;
            return factors[index];
        }
        return 0;
    }

    function showShuttleCheatsheet(visible) {
        if (shuttleCheatsheet) {
            shuttleCheatsheet.style.display = visible ? 'block' : 'none';
        }
    }

    function updateToggleUI(checked) {
        if (shuttleToggle) {
            shuttleToggle.checked = checked;
        }
    }

    function cleanupShuttle() {
        if (shuttleInterval) {
            clearInterval(shuttleInterval);
            shuttleInterval = null;
        }
        currentShuttleSpeed = 0;

        if (shuttleDevice) {
            try {
                shuttleDevice.removeEventListener('inputreport', handleInputReport);
                if (shuttleDevice.opened) {
                    shuttleDevice.close();
                }
            } catch (e) {
                console.error('[OMT] Error closing ShuttleXpress device:', e);
            }
            shuttleDevice = null;
        }
        lastJogValue = null;
        prevBytes3 = 0;
        prevBytes4 = 0;

        updateToggleUI(false);
        localStorage.setItem('shuttleXpressEnabled', 'false');
        showShuttleCheatsheet(false);
    }

    function handleInputReport(event) {
        const { data } = event;
        const bytes = new Uint8Array(data.buffer);

        // A) 5 Buttons edge detection
        if (bytes[3] === 16 && prevBytes3 !== 16) {
            vid.currentTime -= 120;
            mostrarOSD('Skip -2m');
        } else if (bytes[3] === 32 && prevBytes3 !== 32) {
            vid.currentTime -= 10;
            mostrarOSD('Skip -10s');
        } else if (bytes[3] === 64 && prevBytes3 !== 64) {
            if (vid.paused) {
                vid.play().catch(e => {});
                mostrarOSD('Play');
            } else {
                vid.pause();
                mostrarOSD('Pause');
            }
        } else if (bytes[3] === 128 && prevBytes3 !== 128) {
            vid.currentTime += 10;
            mostrarOSD('Skip +10s');
        }

        if (bytes[4] === 1 && prevBytes4 !== 1) {
            vid.currentTime += 120;
            mostrarOSD('Skip +2m');
        }

        prevBytes3 = bytes[3];
        prevBytes4 = bytes[4];

        // B) Inner Jog Wheel (Frame-by-frame)
        const currentJog = bytes[1];
        if (lastJogValue !== null && currentJog !== lastJogValue) {
            if (!vid.paused) vid.pause();

            let delta = currentJog - lastJogValue;
            if (delta > 128) delta -= 256;
            else if (delta < -128) delta += 256;

            if (delta !== 0) {
                vid.currentTime += delta * 0.04;
                mostrarOSD(delta > 0 ? `+${delta} Frame${delta > 1 ? 's' : ''}` : `${delta} Frame${delta < -1 ? 's' : ''}`);
            }
        }
        lastJogValue = currentJog;

        // C) Outer Shuttle Ring
        const b0 = bytes[0];
        if (b0 === 0) {
            if (shuttleInterval) {
                clearInterval(shuttleInterval);
                shuttleInterval = null;
            }
            currentShuttleSpeed = 0;
        } else {
            currentShuttleSpeed = getShuttleSpeedFactor(b0);
            if (currentShuttleSpeed !== 0 && !shuttleInterval) {
                vid.pause();
                shuttleInterval = setInterval(() => {
                    let nextTime = vid.currentTime + currentShuttleSpeed * 0.05;
                    if (nextTime < 0) nextTime = 0;
                    if (nextTime > vid.duration) nextTime = vid.duration;
                    vid.currentTime = nextTime;
                    mostrarOSD(`Scrub: ${currentShuttleSpeed > 0 ? '+' : ''}${currentShuttleSpeed.toFixed(1)}x`);
                }, 50);
            }
        }
    }

    async function connectDevice(device) {
        if (!device) return;
        try {
            if (!device.opened) {
                await device.open();
            }
            shuttleDevice = device;
            shuttleDevice.addEventListener('inputreport', handleInputReport);
            lastJogValue = null;
            prevBytes3 = 0;
            prevBytes4 = 0;

            showShuttleCheatsheet(true);
            updateToggleUI(true);
            console.log('[OMT] ShuttleXpress connected:', device.productName);
        } catch (err) {
            console.error('[OMT] Failed to open ShuttleXpress:', err);
            updateToggleUI(false);
            showShuttleCheatsheet(false);
        }
    }

    function handleHidDisconnect(event) {
        if (shuttleDevice && event.device === shuttleDevice) {
            cleanupShuttle();
            console.log('[OMT] ShuttleXpress disconnected');
        }
    }

    /**
     * If the document is currently in native fullscreen, exit it and wait
     * until the browser has fully unwound the fullscreen layout before
     * resolving. This is required so that browser-modal prompts (e.g. the
     * WebHID device-picker) can open without glitching the UI.
     *
     * Resolution order:
     *  1. The `fullscreenchange` event fires  → resolves immediately.
     *  2. Fallback: 400 ms safety timeout     → resolves unconditionally.
     */
    function exitFullscreenSafely() {
        return new Promise(resolve => {
            if (!document.fullscreenElement) {
                resolve();
                return;
            }

            let settled = false;
            const settle = () => {
                if (settled) return;
                settled = true;
                document.removeEventListener('fullscreenchange', onChanged);
                resolve();
            };

            const onChanged = () => settle();
            document.addEventListener('fullscreenchange', onChanged, { once: true });

            // Safety net: if fullscreenchange never fires, unblock after 400 ms.
            setTimeout(settle, 400);

            document.exitFullscreen().catch(() => {
                // exitFullscreen can throw if the document is not the
                // fullscreen owner (e.g. inside an iframe). Settle anyway.
                settle();
            });
        });
    }

    async function handleToggleChange() {
        if (shuttleToggle.checked) {
            storageSetShuttleEnabled(true);
            try {
                const devices = await navigator.hid.getDevices();
                let device = devices.find(d => d.vendorId === 0x0b33);
                if (!device) {
                    // Exit fullscreen first so the device-picker popup can
                    // open cleanly without freezing or glitching the UI.
                    await exitFullscreenSafely();
                    const requested = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x0b33 }] });
                    if (requested && requested.length > 0) {
                        device = requested[0];
                    }
                }
                if (device) {
                    await connectDevice(device);
                } else {
                    updateToggleUI(false);
                    storageSetShuttleEnabled(false);
                }
            } catch (err) {
                console.error('[OMT] Failed to request ShuttleXpress:', err);
                updateToggleUI(false);
                storageSetShuttleEnabled(false);
            }
        } else {
            storageSetShuttleEnabled(false);
            cleanupShuttle();
        }
    }

    async function initShuttleXpress() {
        if (!navigator.hid) {
            console.warn('[OMT] WebHID is not supported in this browser.');
            if (shuttleToggle) {
                shuttleToggle.disabled = true;
                shuttleToggle.parentElement.title = 'WebHID is not supported in this browser.';
            }
            return;
        }

        navigator.hid.addEventListener('disconnect', handleHidDisconnect);

        if (localStorage.getItem('shuttleXpressEnabled') === 'true') {
            try {
                const devices = await navigator.hid.getDevices();
                const device = devices.find(d => d.vendorId === 0x0b33);
                if (device) {
                    await connectDevice(device);
                }
            } catch (err) {
                console.error('[OMT] Failed to auto-connect ShuttleXpress:', err);
            }
        }
    }
