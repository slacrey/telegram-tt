import { onBeforeUnload } from './schedulers';

const REFRESH_INTERVAL = 5 * 60 * 60 * 1000; // 5 hours in milliseconds

let refreshTimer: number | undefined;

export function startAutoRefresh() {
  // Clear any existing timer
  if (refreshTimer) {
    window.clearTimeout(refreshTimer);
  }

  // Set new timer
  refreshTimer = window.setTimeout(() => {
    window.location.reload();
  }, REFRESH_INTERVAL);

  // Clean up timer when page is unloaded
  onBeforeUnload(() => {
    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }
  });
}

export function stopAutoRefresh() {
  if (refreshTimer) {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
}
