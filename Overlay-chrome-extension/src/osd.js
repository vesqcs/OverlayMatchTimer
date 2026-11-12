/* Transient OSD toast messages. */
    /* =========================================================
       13. OSD NOTIFICATION
       ========================================================= */
    function mostrarOSD(texto) {
        if (!osd) return; // null-guard: may be called after teardown (e.g. deferred OSD timeouts)
        osd.innerText = texto;
        osd.classList.remove('visible');
        void osd.offsetWidth; // reflow
        osd.classList.add('visible');
        clearTimeout(osdTimeout);
        osdTimeout = setTimeout(() => { if (osd) osd.classList.remove('visible'); }, 1100);
    }
