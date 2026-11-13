# Permission justifications (Chrome Web Store)

Use these texts in the Developer Dashboard when asked to justify each permission / host access.

## `storage` (API permission)

**Justification:** Saves the user’s match-clock position/size/style, custom keyboard shortcuts, ShuttleXpress skip/Play-Pause preferences, popup section open-state, and (when the user opts in) kickoff-sync project URL / anon key / room id on this browser only. Required so settings persist between sessions without a remote account.

## Host permission: `*://*.inplayip.tv/*`

**Justification:** Content scripts inject the match-clock HUD on InplayIP match video pages under this domain so operators can see and edit match time while watching.

## Host permission: `*://examino.statsperform.io/*`

**Justification:** Declared so the extension can reach Examino. Active content scripts are limited to DVR/VOD play paths (`/play/dvr/*`, `/play/vod/*`); see review notes for a possible narrowing of this host permission to match.

## Host permission: `http://127.0.0.1/*` and `http://localhost/*`

**Justification:** Used only for local development / QA fixtures and the extension’s local player workflows on loopback. Not used to access arbitrary LAN devices. See review notes for narrowing to path-specific patterns already used by content scripts.

## Optional host permission: `https://*.supabase.co/*`

**Justification:** Requested **only at runtime** when the user turns on **Kickoff sync** in Customize and enters their own Supabase project URL. Used solely so the service worker can call that project’s REST API to share kickoff / clock-reference values with colleagues. Default off — no Supabase traffic and no optional host grant when the toggle is off. Not required for core match-timer use.

## Optional APIs not requested

The extension does **not** request `tabs`, `webRequest`, `cookies`, `history`, `identity`, or remote code. ShuttleXpress uses the **WebHID** API from the page context after the user enables it; WebHID is not a manifest permission but requires a user gesture / device chooser.
