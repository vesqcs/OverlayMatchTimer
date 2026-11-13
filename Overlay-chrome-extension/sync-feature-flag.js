/* ============================================================
   Kickoff sync — INTERNAL FEATURE FLAG (v1.7.1+)
   ============================================================
   Keep OMT_SYNC_FEATURE_ENABLED = false for shipped / QA builds.
   When false the feature is fully inert:
     - no Customize UI (section not in popup.html)
     - no sync message handlers / poll in SW or bridge
     - no network
     - manifest must NOT declare Supabase host / optional_host_permissions

   Planned PRODUCT design (always-on, zero config, bundled project) is
   documented in ARCHITECTURE.md and supabase/SETUP.md — do NOT implement
   by flipping this flag. The flag only resurrects the old per-user URL/key UI.

   To resurrect the v1.7.0 prototype UI for an internal lab build only:
     1. Set OMT_SYNC_FEATURE_ENABLED = true below
     2. Re-add to Overlay-chrome-extension/manifest.json:
          "optional_host_permissions": [ "https://*.supabase.co/*" ]
        (Future always-on design should use a FIXED single-project host
         permission instead — see supabase/SETUP.md.)
     3. Rebuild: node scripts/build-content.mjs
     4. Load unpacked; Customize injects popup-sync-section.html
   ============================================================ */
var OMT_SYNC_FEATURE_ENABLED = false;
