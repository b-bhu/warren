// Install Node-compatible globals before Expo Router evaluates the application
// module graph. Solana and wallet dependencies can read Buffer during import,
// before feature-level imports have a chance to run.
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}
