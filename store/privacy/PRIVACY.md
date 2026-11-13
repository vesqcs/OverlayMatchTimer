# Privacy Policy — Overlay MatchTimer

**Last updated:** 2026-11-13  
**Developer:** Vasco Oliveira (Stats Perform / RunningBall operations tooling)  
**Contact:** Use your internal Stats Perform channel for the extension owner.

## Summary

Overlay MatchTimer does **not** collect, sell, or send personal data to a developer-operated server. It runs locally in your Chrome browser to overlay a match clock and controls on supported video pages.

## Data stored on your device

The extension may store the following in **Chrome local extension storage** (`chrome.storage.local`) and, for page-bridge sync, mirrored keys in the page’s `localStorage` on sites where the content script runs:

- Match clock position, size, and style
- Custom keyboard shortcut bindings
- ShuttleXpress button skip values, Play/Pause assignment, jog/ring settings
- Popup UI preferences (which sections are expanded)
- Per-window Shuttle enable flag (page localStorage)
- Optional kickoff-sync settings (enable flag, project URL, anon key, optional room id) — **off by default**

This data stays on the machine/profile that installed the extension unless you enable kickoff sync (below).

## Data we do not collect

- No analytics SDKs
- No advertising identifiers
- No account login to a developer backend
- No transmission of match video or keystrokes to a remote Overlay MatchTimer server

## Optional kickoff sync (v1.7.0+, default off)

When **Kickoff sync** is left off (the default), the extension makes **no** network requests related to sync and does not use optional Supabase host access.

If you turn it on in Customize and enter a Supabase project URL + anon key that you control:

- The extension requests optional host permission for that project origin at enable time only
- Kickoff / clock-reference values for the current match room may be sent to and read from your project’s `kickoff_sync` table
- No service-role keys are used; credentials are stored only in `chrome.storage.local` on your device

Turn sync off at any time to stop further sync traffic.

## Third parties

Video is provided by InplayIP / Examino / local files under your existing access. This extension does not share data with those services beyond what the browser already does when you visit those pages. Optional sync talks only to the Supabase project URL you configure.

## Host access

The extension injects scripts on declared hosts (InplayIP, Examino play URLs, and localhost/127.0.0.1 for local player / test pages). Optional access to `https://*.supabase.co/*` is requested only when kickoff sync is enabled.

## Changes

Material privacy changes will update this document and the date above.
