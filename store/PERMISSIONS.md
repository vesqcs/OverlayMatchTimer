# Permission justifications (Chrome Web Store)

Use these texts in the Developer Dashboard when asked to justify each permission / host access.

## `storage` (API permission)

**Justification:** Saves the user’s match-clock position/size/style, custom keyboard shortcuts, ShuttleXpress skip/Play-Pause preferences, and popup section open-state on this browser only. Required so settings persist between sessions without a remote account.

## Host permission: `*://*.inplayip.tv/*`

**Justification:** Content scripts inject the match-clock HUD on InplayIP match video pages under this domain so operators can see and edit match time while watching.

## Host permission: `*://examino.statsperform.io/*`

**Justification:** Declared so the extension can reach Examino. Active content scripts are limited to DVR/VOD play paths (`/play/dvr/*`, `/play/vod/*`); see review notes for a possible narrowing of this host permission to match.

## Host permission: `http://127.0.0.1/*` and `http://localhost/*`

**Justification:** Used only for local development / QA fixtures and the extension’s local player workflows on loopback. Not used to access arbitrary LAN devices. See review notes for narrowing to path-specific patterns already used by content scripts.

## Optional APIs / hosts not requested (v1.7.1)

The extension does **not** request `tabs`, `webRequest`, `cookies`, `history`, `identity`, remote code, or Supabase / cloud host permissions in this build. ShuttleXpress uses the **WebHID** API from the page context after the user enables it; WebHID is not a manifest permission but requires a user gesture / device chooser.

> If Kickoff sync is enabled in a future release, add a fixed host permission for that single project origin and a matching justification — see `supabase/SETUP.md` and `ARCHITECTURE.md`. Do not re-add a `*.supabase.co` wildcard for the planned always-on design without owner review.
