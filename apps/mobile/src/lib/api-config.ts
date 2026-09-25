let didWarnAboutMissingApiUrl = false;

export function configuredApiUrl(): string | undefined {
  const value = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (value) return value.replace(/\/$/, '');

  if (!didWarnAboutMissingApiUrl && typeof __DEV__ !== 'undefined' && __DEV__) {
    didWarnAboutMissingApiUrl = true;
    console.warn('[Warren API] EXPO_PUBLIC_API_URL is not configured for this build.');
  }

  return undefined;
}
