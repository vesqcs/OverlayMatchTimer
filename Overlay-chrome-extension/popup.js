(function () {
  'use strict';

  const KEYS = {
    clockPos: 'omtClockPosition',
    clockSize: 'omtClockSize',
    clockShape: 'omtClockShape',
    autoPauseOnBlur: 'omtAutoPauseOnBlur'
  };

  const clockPos = document.getElementById('clock-pos');
  const clockSize = document.getElementById('clock-size');
  const clockShape = document.getElementById('clock-shape');
  const autoPause = document.getElementById('omt-auto-pause-blur');

  chrome.storage.local.get(
    {
      [KEYS.clockPos]: 'top-left',
      [KEYS.clockSize]: 'medium',
      [KEYS.clockShape]: 'rounded',
      [KEYS.autoPauseOnBlur]: false
    },
    (result) => {
      clockPos.value = result[KEYS.clockPos] || 'top-left';
      clockSize.value = result[KEYS.clockSize] || 'medium';
      clockShape.value = result[KEYS.clockShape] || 'rounded';
      if (autoPause) autoPause.checked = !!result[KEYS.autoPauseOnBlur];
    }
  );

  if (autoPause) {
    autoPause.addEventListener('change', () => {
      const enabled = !!autoPause.checked;
      chrome.storage.local.set({ [KEYS.autoPauseOnBlur]: enabled });
    });
  }

  const openLocal = document.getElementById('omt-open-local-player');
  if (openLocal) {
    openLocal.addEventListener('click', () => {
      const url = chrome.runtime.getURL('player.html');
      chrome.tabs.create({ url });
    });
  }

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
