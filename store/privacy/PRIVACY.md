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

This data stays on the machine/profile that installed the extension.

## Data we do not collect

- No analytics SDKs
- No advertising identifiers
- No account login to a developer backend
- No transmission of match video, keystrokes, or preferences to a remote Overlay MatchTimer server

## Cloud sync (future)

If a optional Supabase (or similar) sync feature is added later, it will be **off by default**, clearly labelled, and covered by an updated privacy policy before enablement. It is **not** present in v1.6.5.

## Third parties

Video is provided by InplayIP / Examino / local files under your existing access. This extension does not share data with those services beyond what the browser already does when you visit those pages.

## Host access

The extension only injects scripts on declared hosts (InplayIP, Examino play URLs, and localhost/127.0.0.1 for local player / test pages).

## Changes

Material privacy changes will update this document and the date above.
