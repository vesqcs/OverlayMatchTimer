# Overlay MatchTimer ⚽⏱️

**Overlay MatchTimer** is a high-performance Google Chrome Extension and web ecosystem designed for professional football/sports match analysts. It injects a highly accurate, customizable match timer overlay and custom tactical video controls directly over live and DVR video streams powered by Video.js (specifically tailored for platforms like `inplayip.tv`).

This tool eliminates the limitations of native web video players, providing video stability, drift-proof synchronization, precise scrubbing, and customizable half-time offsets.

---

## 🌟 Key Features

### 1. Advanced Synchronization & Stability
* **HLS PDT Absolute Sync:** Automatically reads `programDateTime` (PDT) and Master Playlist Controller streams from HLS.js / Video.js VHS internals. This ensures your match clock remains perfectly calibrated to absolute time, completely bulletproof against stream drifts, buffering, or drops.
* **Anti-Live-Snap Engine:** Custom anti-snapping mechanism. When reviewing key tactical moments, the video player is prevented from forcefully pulling your playhead back to the live edge, protecting your active analysis frame with a 4-second safety window.
* **Persistent Local State:** All setup variables—including calculated whistle offsets, kickoff markers, sound volume levels, and selected half-times—are automatically cached via `localStorage`. If the page refreshes or crashes, your timeline state is instantly restored.

### 2. Tailored Tactical Playback Controls
* **Frame-by-Frame Scrubbing:** Step forward or backward with surgical precision (+/- 0.04s per frame) to freeze-frame offsides, tactical defensive lines, or passing lanes.
* **Smart Timeline Markers & Kickoff Jumps:** Dynamically calculates timeline tick-marks for the 1st Half, 2nd Half, and Extra-time/Custom periods. Dedicated UI badges allow instant jumping to exactly when the ball rolled.
* **Variable Playback Speed:** Quickly scale speed from `0.25x` up to `2.00x` using smooth drop-downs or keyboard hotkeys.
* **Draggable Glassmorphism UI:** Both the *Setup Panel* and the *Controls Overlay* are built with an elegant glassmorphism styling and feature independent drag-and-drop handles so you can position them anywhere over your match display canvas.
* **Smart Auto-Hide HUD:** The HUD controls smoothly fade out after 2.5 seconds of mouse inactivity to ensure an uncompromised, full-screen tactical view, instantly reappearing upon mouse movement.

---

## 🛠️ Project Structure

The project repository consists of two main components:
1. **The Chrome Extension (Folder Content):** Injects the professional analysis interface over the remote stream platform. Includes `manifest.json`, `content.js`, and stylesheets.
2. **The HTML Companion App:** A local analytical dashboard file that bridges tools, acts as a local hub, and links directly to documentation and extensions deployment.

---

## 🚀 Installation & Setup

Since the extension is currently tailored for professional internal workflows, it can be loaded instantly in Developer Mode for free:

### Loading the Chrome Extension
1. Download or clone this repository to your local computer.
2. Open Google Chrome and navigate to: `chrome://extensions/`
3. In the top-right corner, toggle the **"Developer mode"** switch to **ON**.
4. In the top-left corner, click **"Load unpacked"** (Carregar extensão expandida).
5. Select the root folder containing the extension files (where `manifest.json` resides).
6. *(Optional for Home Testing)*: If you wish to test the extension locally on your machine with offline media files, click **"Details"** on the extension card and enable **"Allow access to file URLs"**.

### Launching the Dashboard App
* Simply double-click the `OverlayMatchTimer v.7.04.html` app file to launch the local hub console in your browser. From there, you can interface with instructions or jump straight to the stream channels.

---

## 🕹️ How to Use (Workflow)

1. Open a Xeatre or Examino DVR and copy the URL
2. Past the URL into the URL bar in the **Overlay MatchTimer** app and click LOAD.
3. The **Overlay MatchTimer** HUD will load automatically over the video within 2 seconds.
4. Click the ⚙️ icon to open the **Setup Panel**.
5. Select the **Match Half** (1st Half, 2nd Half, Custom Extra-Times).
6. **Sync the Clock:** Type the exact Hour:Minute:Second of the referee's whistle, or leave the inputs empty and hit **"SET KICK-OFF TIME"** to instantly capture the current video frame as the 00:00 reference anchor.
7. Close the setup panel and utilize the timeline and shortcuts to execute your analysis.

---

## ⌨️ Keyboard Shortcuts Cheatsheet

For continuous focus on the game, you can fully manipulate playback without ever touching your mouse using global capture overrides:

| Action | Shortcut Key |
| :--- | :--- |
| **Play / Pause** | `Spacebar` |
| **Skip Forward / Backward 2s** | `→` / `←` |
| **Skip Forward / Backward 10s** | `Shift` + `→` / `←` |
| **Skip Forward / Backward 2m** | `Ctrl` + `→` / `←` |
| **Frame by Frame Advance** | `↑` (Next Frame) |
| **Frame by Frame Rewind** | `↓` (Previous Frame) |
| **Increase Replay Speed (+0.25x)** | `C` |
| **Decrease Replay Speed (-0.25x)** | `Z` |
| **Reset Speed to Normal (1.00x)** | `X` |
| **Hide/Show Controls** | `H` |

---

## 👥 Author & License

* **Developer:** Vasco Oliveira
* Designed for professional performance analysis. All rights reserved.
