import type { PortfolioRequestError } from './portfolio-api';

export type PortfolioLoadState<T> =
  | { phase: 'loading' }
  | { error: PortfolioRequestError; phase: 'error' }
  | { data: T; phase: 'ready'; refreshError?: string; refreshing: boolean };

export function portfolioFailureState<T>(
  current: PortfolioLoadState<T>,
  error: PortfolioRequestError,
): PortfolioLoadState<T> {
  if (current.phase === 'ready' && error.failure !== 'session' && error.failure !== 'wallet') {
    return { ...current, refreshError: error.message, refreshing: false };
  }
  return { error, phase: 'error' };
}
