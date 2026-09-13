const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;

  // Privy's React Native setup requires these packages to bypass exports maps.
  if (moduleName === 'isows' || moduleName.startsWith('zustand')) {
    return resolve(
      { ...context, unstable_enablePackageExports: false },
      moduleName,
      platform,
    );
  }

  // Use jose's browser implementation so Metro never selects Node crypto APIs.
  if (moduleName === 'jose') {
    return resolve(
      { ...context, unstable_conditionNames: ['browser'] },
      moduleName,
      platform,
    );
  }

  return resolve(context, moduleName, platform);
};

module.exports = config;
