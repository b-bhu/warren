import { createContext, useContext, type PropsWithChildren } from 'react';

export type ViewerStatus = 'guest' | 'loading' | 'signed-in';

const ViewerStatusContext = createContext<ViewerStatus>('guest');

/** Web and unsupported native runtimes remain truthful guest discovery surfaces. */
export function ViewerStatusProvider({ children }: PropsWithChildren) {
  return <ViewerStatusContext.Provider value="guest">{children}</ViewerStatusContext.Provider>;
}

export function useViewerStatus() {
  return useContext(ViewerStatusContext);
}
