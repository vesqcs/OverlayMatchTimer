# Overlay MatchTimer ⚽⏱️

**Overlay MatchTimer** is a high-performance Google Chrome Extension designed for professional football and sports match analysts. It injects a highly accurate, customisable match timer overlay and a full tactical video control suite directly over live and DVR video streams powered by Video.js — specifically tailored for platforms such as **Xeatre**, **Inplayip.tv**, **Examino** (statsperform.io), and local video files.

This tool eliminates the limitations of native web video players, providing video stability, drift-proof synchronisation, precise scrubbing, hardware device integration, and a smart responsive layout that adapts seamlessly to any window size.

---

## 🌟 Key Features

### 1. Advanced Synchronisation & Stability

* **HLS PDT Absolute Sync:** Automatically reads `programDateTime` (PDT) from HLS.js fragment data and Video.js VHS segment internals. The match clock is calibrated to absolute wall-clock time, making it completely bulletproof against stream drifts, buffering events, or reconnections.
* **Anti-Live-Snap Engine:** A custom protection mechanism prevents the HLS player from forcefully pulling the playhead back to the live edge during active analysis. A 4-second safety window preserves the analyst's exact position after every manual seek.
* **Persistent Local State:** All session variables — whistle offsets, kickoff markers, volume levels, selected half, and custom period boundaries — are automatically persisted via `localStorage`. After a page refresh or crash, the full timeline state is instantly restored with no re-configuration required.

---

### 2. Intelligent Responsive Control Panel

The controls panel dynamically adapts its layout based on the current window geometry, ensuring the interface is never obstructive regardless of window size or platform.

#### Docked Mode (Letterbox-Embedded)
When the video container has a bottom black letterbox bar of at least **110 px** (the typical result of 16:9 content in a non-16:9 window), the controls panel automatically docks into that black bar, spanning the full container width. The docking position is determined by a pure **CSS Flexbox layout** — the browser's rendering engine positions both the video spacer and the controls panel in the exact same paint frame, achieving **0 ms resize latency** with no JavaScript measurement involved. Resizing the window vertically feels completely native with no jumping or delay.

#### Overlay Mode (Floating)
In compact windows or fullscreen, the controls panel floats as a centred glassmorphism overlay above the video. It auto-hides after **2.5 seconds** of mouse inactivity and reappears instantly on any mouse movement.

#### Platform Normalisation
Across all supported platforms, the extension enforces consistent video geometry:
* **Xeatre, Inplayip & Local files:** The `<video>` element is top-aligned (`object-position: top center`) so that all letterbox space is consolidated at the bottom — the exact region the docked panel occupies.
* **Xeatre:** Native `#ControlBar` overlay is suppressed in both normal and fullscreen modes.
* **Examino:** Native button bar, progress bar, and settings button are hidden via both CSS `!important` rules and a persistent `MutationObserver` that suppresses any re-injected controls.
* **Fullscreen:** The docked panel automatically reverts to Overlay Mode when entering fullscreen, and re-evaluates on exit.

---

### 3. Contour ShuttleXpress Hardware Integration

Native support for the **Contour ShuttleXpress** USB device via the **WebHID API**, providing hands-on, tactile control of video playback without touching the keyboard or mouse.

| Control | Action |
| :--- | :--- |
| **Inner Jog Wheel** | Frame-by-frame navigation (±0.04s per click). Automatically pauses the video. Supports multi-step scrolls |
| **Outer Shuttle Ring** | Variable-speed continuous scrubbing. Supports 7 speed steps in each direction: `0.2×`, `0.5×`, `1.0×`, `2.0×`, `4.0×`, `8.0×`, `16.0×` |
| **Button 1 (Far Left)** | Skip −2 minutes |
| **Button 2** | Skip −10 seconds |
| **Button 3 (Centre)** | Play / Pause toggle |
| **Button 4** | Skip +10 seconds |
| **Button 5 (Far Right)** | Skip +2 minutes |

**Connection flow:** Toggle the *Enable ShuttleXpress* switch in the Setup Panel. If the device has not been paired before, Chrome will display a WebHID permission prompt. On subsequent page loads, the device is reconnected automatically in the background. If fullscreen is active when pairing is initiated, the extension exits fullscreen automatically before requesting device access (a Chrome WebHID requirement).

---

### 4. Tailored Tactical Playback Controls

* **Frame-by-Frame Scrubbing:** Step forward or backward with surgical precision (±0.04s per frame) to freeze-frame offsides, defensive lines, or passing lanes.
* **Smart Timeline Markers & Kickoff Jumps:** Dynamically calculates coloured tick-marks on the timeline for the 1st Half, 2nd Half, and up to two Custom Extra-Time periods. Dedicated badge buttons allow instant one-click jumping to the exact moment of each kick-off.
* **Timeline Precision Zoom:** Once kickoff markers are set, the timeline slider automatically adjusts its start point to 15 minutes before the 1st Half kickoff, zooming the scrub range to the relevant match window and improving scrubbing resolution.
* **Variable Playback Speed:** Scale playback speed from `0.25×` to `2.00×` via the speed selector or keyboard hotkeys. The speed display stays synchronised across all input methods.
* **Draggable Glassmorphism UI:** Both the *Setup Panel* and the *Controls Panel* (when in Overlay Mode) feature independent drag-and-drop handles for free positioning over the video canvas. Dragging is blocked in Docked Mode.
* **Volume Control & Mute:** Persistent volume slider with mute toggle. Volume level is restored across page loads.
* **Live Edge Button:** Instantly seeks to the live edge of an HLS stream using `hls.liveSyncPosition` or the seekable buffer end. The button visually pulses red when at the live edge (within 8 seconds).

---

### 5. Interactive Timer Navigation (Jump to Minute)

Analysts can click directly on the on-screen match timer to transform it into an editable input field:

* **Type any target match minute** (e.g., `13`, `67`, or `46.5`) and press **`Enter`** to instantly seek the video to that exact game moment.
* Press **`Escape`** to cancel and restore the live running clock without seeking.
* Clicking away from the field confirms the value automatically.

**Smart context-aware seeking:** The extension resolves the correct video timestamp relative to the active period (1st Half, 2nd Half, Custom 1, Custom 2) and all stored kickoff markers. If the typed minute falls within a different period, the extension automatically maps the seek target to the correct kickoff boundary — including injury time handling and cross-period disambiguation.

---

### 6. Examino DVR Automation

On **Examino (statsperform.io)**, the extension automatically switches the player to DVR mode on page load. After a 2.5-second delay (to allow the player to fully initialise), it opens the player settings menu and clicks the DVR source option — eliminating a manual step that would otherwise be required on every stream load.

---

### 7. Single-Page Application (SPA) Resilience

A background monitor polls every **1.5 seconds** to detect stream changes in single-page application environments (e.g., navigating between matches without a full page reload). It automatically:
* **Tears down** the HUD cleanly when leaving a stream page.
* **Reinitialises** the full extension when a new video element is detected.
* **Handles stream switches** mid-session when the underlying `<video>` element is replaced.

---

## 🛠️ Project Structure

The project repository consists of two main components:

1. **The Chrome Extension** (`Overlay-chrome-extension/`): Injects the professional analysis interface over the remote stream platform. Contains `manifest.json`, `content.js`, and `content.css`.
2. **The HTML Companion App:** A local analytical dashboard file that acts as a local hub and links directly to documentation and extension deployment.

---

## 🚀 Installation & Setup

Since the extension is currently tailored for professional internal workflows, it can be loaded instantly in Developer Mode at no cost:

### Loading the Chrome Extension

1. Download or clone this repository to your local computer.
2. Open Google Chrome and navigate to: `chrome://extensions/`
3. In the top-right corner, toggle the **"Developer mode"** switch to **ON**.
4. In the top-left corner, click **"Load unpacked"** (Carregar extensão expandida).
5. Select the `Overlay-chrome-extension/` folder (the one containing `manifest.json`).
6. *(Optional — Local File Testing):* Click **"Details"** on the extension card and enable **"Allow access to file URLs"** to use the extension with offline video files.

### Launching the Dashboard App

Double-click the `OverlayMatchTimer v.x.html` app file to launch the local hub console. From there you can load stream URLs directly or access documentation.

---

## 🕹️ How to Use (Workflow)

1. Open a supported stream (Xeatre, Examino, Inplayip, or a local video file).
2. The **Overlay MatchTimer** HUD loads automatically over the video within approximately 2 seconds.
3. Click the **⚙️ icon** to open the **Setup Panel**.
4. Select the **Match Half** (1st Half, 2nd Half, or Custom Extra-Times with configurable starting minutes).
5. **Sync the Clock:** Enter the exact Hour:Minute:Second timestamp of the referee's whistle. Alternatively, leave the fields empty and click **"SET KICK-OFF TIME"** to capture the current video frame as the 00:00 reference anchor.
6. Close the setup panel. The timer, timeline markers, and kickoff jump badges are now active.
7. Use the timeline, buttons, keyboard shortcuts, or ShuttleXpress device to execute your analysis.

---

## ⌨️ Keyboard Shortcuts Cheatsheet

All shortcuts use global capture-phase interception and override any native browser or Video.js key bindings.

| Action | Shortcut |
| :--- | :--- |
| **Play / Pause** | `Spacebar` |
| **Skip ±2s** | `→` / `←` |
| **Skip ±10s** | `Shift` + `→` / `←` |
| **Skip ±2m** | `Ctrl` + `→` / `←` |
| **Next Frame (+0.04s)** | `↑` |
| **Previous Frame (−0.04s)** | `↓` |
| **Increase Speed (+0.25×)** | `C` |
| **Decrease Speed (−0.25×)** | `Z` |
| **Reset Speed to 1.00×** | `X` |
| **Toggle Controls Visibility** | `H` |

---

## 👥 Author & License

* **Developer:** Vasco Oliveira
* Designed for professional performance analysis. All rights reserved.
