import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'), PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().default('file:./warren.db'), AUTH_DOMAIN: z.string().default('localhost'), AUTH_URI: z.string().url().default('http://localhost:3000'),
  CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(900), ATTEMPT_TTL_SECONDS: z.coerce.number().int().min(900).default(1200), ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TTL_SECONDS: z.coerce.number().int().min(3600).default(2_592_000), SESSION_HMAC_PEPPER: z.string().min(24).default('development-only-change-this-pepper-value'), SESSION_RESULT_ENCRYPTION_KEY: z.string().min(32).default('development-only-result-encryption-key-change-me'),
  EVM_SUPPORTED_CHAIN_IDS: z.string().default('1'), SOLANA_SUPPORTED_CLUSTERS: z.string().default('devnet'),
  CORS_ORIGINS: z.string().default('http://localhost:8081'), RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60), RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  TOKENS_API_BASE_URL: z.string().url().default('https://api.tokens.xyz'), TOKENS_API_KEY: z.string().min(20).optional(),
  HOME_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(250).max(30_000).default(5_000),
  HOME_CATALOG_CACHE_SECONDS: z.coerce.number().int().min(1).default(60), HOME_CATALOG_STALE_SECONDS: z.coerce.number().int().min(0).default(900),
  HOME_HTTP_CACHE_SECONDS: z.coerce.number().int().min(0).default(15), HOME_HTTP_STALE_SECONDS: z.coerce.number().int().min(0).default(60),
  PRESTOCKS_API_URL: z.string().url().default('https://prestocks.com/api/prestocks'),
  PHOENIX_API_BASE_URL: z.string().url().default('https://perp-api.phoenix.trade'),
  MARKETS_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(250).max(30_000).default(8_000),
  MARKETS_REGISTRY_CACHE_SECONDS: z.coerce.number().int().min(1).default(60),
  MARKETS_REGISTRY_STALE_SECONDS: z.coerce.number().int().min(0).default(900),
  MARKETS_HTTP_CACHE_SECONDS: z.coerce.number().int().min(0).default(15),
  MARKETS_HTTP_STALE_SECONDS: z.coerce.number().int().min(0).default(60),
});
export type Config = z.infer<typeof configSchema>;
export const readConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const config = configSchema.parse(env);
  if (config.ATTEMPT_TTL_SECONDS < config.CHALLENGE_TTL_SECONDS) throw new Error('ATTEMPT_TTL_SECONDS must be at least CHALLENGE_TTL_SECONDS');
  const chainIds = config.EVM_SUPPORTED_CHAIN_IDS.split(',');
  if (!chainIds.length || chainIds.some((chainId) => !/^[1-9]\d*$/.test(chainId))) throw new Error('EVM_SUPPORTED_CHAIN_IDS must be comma-separated positive decimal chain IDs');
  const clusters = config.SOLANA_SUPPORTED_CLUSTERS.split(',').map((cluster) => cluster.trim());
  if (!clusters.length || clusters.some((cluster) => !cluster)) throw new Error('SOLANA_SUPPORTED_CLUSTERS must not be empty');
  if (config.NODE_ENV === 'production') {
    if (config.SESSION_HMAC_PEPPER.includes('development-only') || config.SESSION_HMAC_PEPPER.includes('change-this')) throw new Error('SESSION_HMAC_PEPPER must be a production secret');
    if (config.SESSION_RESULT_ENCRYPTION_KEY.includes('development-only') || config.SESSION_RESULT_ENCRYPTION_KEY.includes('change-me')) throw new Error('SESSION_RESULT_ENCRYPTION_KEY must be a production secret');
    if (!config.AUTH_URI.startsWith('https://')) throw new Error('AUTH_URI must use HTTPS in production');
    if (config.DATABASE_URL === 'file:./warren.db') throw new Error('DATABASE_URL must use a mounted production volume');
    const origins = config.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
    if (!origins.length || origins.includes('*')) throw new Error('CORS_ORIGINS must contain explicit production origins');
    if (!config.TOKENS_API_KEY) throw new Error('TOKENS_API_KEY is required in production');
  }
  return config;
};
