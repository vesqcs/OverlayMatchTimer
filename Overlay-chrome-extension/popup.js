(function () {
  'use strict';

  const KEYS = {
    clockPos: 'omtClockPosition',
    clockSize: 'omtClockSize',
    clockShape: 'omtClockShape'
  };

  const clockPos = document.getElementById('clock-pos');
  const clockSize = document.getElementById('clock-size');
  const clockShape = document.getElementById('clock-shape');

  chrome.storage.local.get(
    {
      [KEYS.clockPos]: 'top-left',
      [KEYS.clockSize]: 'medium',
      [KEYS.clockShape]: 'rounded'
    },
    (result) => {
      clockPos.value = result[KEYS.clockPos] || 'top-left';
      clockSize.value = result[KEYS.clockSize] || 'medium';
      clockShape.value = result[KEYS.clockShape] || 'rounded';
    }
  );

  // Customize controls are disabled (coming soon) — values are still read for future wiring.
  document.querySelectorAll('.omt-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.getAttribute('data-tab');
      document.querySelectorAll('.omt-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      document.querySelectorAll('.omt-pane').forEach((p) => {
        p.classList.toggle('is-active', p.getAttribute('data-pane') === id);
      });
    });
  });
})();
