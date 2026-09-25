import type { ViewerStatus } from './viewer-status';

export function viewerStatusFromPrivyState(isReady: boolean, hasUser: boolean): ViewerStatus {
  if (!isReady) return 'loading';
  return hasUser ? 'signed-in' : 'guest';
}
