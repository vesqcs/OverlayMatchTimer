(function () {
  'use strict';

  const KEYS = {
    shuttle: 'shuttleXpressEnabled',
    clockPos: 'omtClockPosition',
    clockSize: 'omtClockSize',
    clockShape: 'omtClockShape'
  };

  const shuttle = document.getElementById('shuttle-toggle');
  const clockPos = document.getElementById('clock-pos');
  const clockSize = document.getElementById('clock-size');
  const clockShape = document.getElementById('clock-shape');

  chrome.storage.local.get(
    {
      [KEYS.shuttle]: false,
      [KEYS.clockPos]: 'top-left',
      [KEYS.clockSize]: 'medium',
      [KEYS.clockShape]: 'rounded'
    },
    (result) => {
      shuttle.checked = !!result[KEYS.shuttle];
      clockPos.value = result[KEYS.clockPos] || 'top-left';
      clockSize.value = result[KEYS.clockSize] || 'medium';
      clockShape.value = result[KEYS.clockShape] || 'rounded';
    }
  );

  shuttle.addEventListener('change', () => {
    chrome.storage.local.set({ [KEYS.shuttle]: !!shuttle.checked });
  });

  // Personalizar controls are disabled (em breve) — values are still read for future wiring.
  document.querySelectorAll('.omt-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.getAttribute('data-tab');
      document.querySelectorAll('.omt-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      document.querySelectorAll('.omt-pane').forEach((p) => {
        p.classList.toggle('is-active', p.getAttribute('data-pane') === id);
      });
    });
  });

  const logoAbove = document.getElementById('brand-logo-above');
  const wordAbove = document.getElementById('brand-wordmark-above');
  document.getElementById('brand-layout-toggle').addEventListener('click', () => {
    const showingLogoFirst = !logoAbove.hidden;
    logoAbove.hidden = showingLogoFirst;
    wordAbove.hidden = !showingLogoFirst;
  });
})();
