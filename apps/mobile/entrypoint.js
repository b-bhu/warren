// Privy requires these globals before Expo Router or application code loads.
import './polyfills.js';
import 'fast-text-encoding';
import 'react-native-get-random-values';
import '@ethersproject/shims';

import 'expo-router/entry';
