import { useEffect, useRef } from 'react';

export function useWakeLock(active) {
  const lockRef = useRef(null);

  useEffect(() => {
    if (!('wakeLock' in navigator)) return;

    async function acquire() {
      try {
        lockRef.current = await navigator.wakeLock.request('screen');
      } catch (_e) {
        // Permission denied or screen already locked — ignore silently
      }
    }

    async function release() {
      if (lockRef.current) {
        await lockRef.current.release();
        lockRef.current = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        acquire();
      }
    }

    if (active) {
      acquire();
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      release();
    };
  }, [active]);
}
