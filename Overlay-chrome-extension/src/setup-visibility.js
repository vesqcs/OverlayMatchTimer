/* Show / hide the legacy setup panel (unused in-video; kept null-safe). */
    /* =========================================================
       16. SETUP PANEL VISIBILITY
       ========================================================= */
    function esconderSetup() {
        if (setupPanel) setupPanel.style.display = 'none';
    }
    function mostrarSetup() {
        // Branding / Personalizar moved to the Chrome toolbar popup.
        if (setupPanel) setupPanel.style.display = 'none';
    }
