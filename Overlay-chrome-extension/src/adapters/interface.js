/* =========================================================
   SITE ADAPTER INTERFACE
   =========================================================
   Each site adapter is a plain object with this shape. Adding a
   new host (e.g. a real Xeatre injector) means: add a file under
   src/adapters/, register it in detect.js, and keep host-only
   extras in a dedicated *-features.js fragment.

   Required members:
     id: string
     rootClass: string                 // CSS class on #omt-root
     findVideo(): HTMLVideoElement|null
     findAnchor(videoEl): Element|null
     findFullscreenTarget(videoEl): Element|null
     isReviewStream(): boolean         // true → inject HUD
     isLiveStream(): boolean           // Inplay idle + SPA watch
     suppressHostControls(videoEl): void
     mediaReady(videoEl): boolean      // auto-hide gate
     effectiveDuration(videoEl): number

   Optional:
     stub: true                        // detectSite idles the script
   ========================================================= */
