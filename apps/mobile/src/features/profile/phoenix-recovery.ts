import type {
  PortfolioOverviewResponse,
  PortfolioPositionsResponse,
  PortfolioWarning,
} from '@warren/portfolio-contract';

export const PHOENIX_APP_URL = 'https://www.phoenix.trade/';

type PortfolioPhoenixState = Pick<
  PortfolioOverviewResponse | PortfolioPositionsResponse,
  'perpetuals' | 'warnings'
>;

export type PhoenixRecoveryModel = {
  body: string;
  kind: 'onboarding' | 'unavailable';
  primaryAction: 'create-in-warren' | 'retry';
  secondaryAction: 'open-phoenix' | null;
  title: string;
};

export function phoenixRecoveryModel(portfolio: PortfolioPhoenixState): PhoenixRecoveryModel | null {
  if (portfolio.perpetuals.accountState === 'ready') return null;

  if (portfolio.perpetuals.accountState === 'not_initialized') {
    return {
      body: 'Create the default Phoenix trading account with this Warren wallet. This is one Solana transaction and does not open a trade.',
      kind: 'onboarding',
      primaryAction: 'create-in-warren',
      secondaryAction: null,
      title: 'Create your Phoenix account',
    };
  }

  return {
    body: 'Your wallet balances are still shown. Retry now, or open Phoenix to check or set up your trading account.',
    kind: 'unavailable',
    primaryAction: 'retry',
    secondaryAction: 'open-phoenix',
    title: 'Phoenix data could not be loaded',
  };
}

export function isPhoenixRecoveryWarning(warning: PortfolioWarning) {
  return warning.section === 'perpetuals'
    && (warning.code === 'PHOENIX_ACCOUNT_UNAVAILABLE' || warning.code === 'PHOENIX_AUTH_REQUIRED');
}

export async function launchPhoenixSetup(
  setupUrl: string,
  openUrl: (url: string) => Promise<unknown> | unknown,
) {
  const trustedUrl = trustedPhoenixUrl(setupUrl);
  if (!trustedUrl) return false;
  try {
    const result = await openUrl(trustedUrl);
    return !(result && typeof result === 'object' && 'type' in result && result.type === 'locked');
  } catch {
    return false;
  }
}

function trustedPhoenixUrl(value: string | null) {
  if (!value) return null;
  return /^https:\/\/(?:www\.)?phoenix\.trade(?:[/?#]|$)/i.test(value) ? value : null;
}
