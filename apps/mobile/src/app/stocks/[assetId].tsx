import { useLocalSearchParams } from 'expo-router';

import { StockDetailScreen } from '@/features/market';

export default function StockRoute() {
  const { assetId } = useLocalSearchParams<{ assetId?: string | string[] }>();
  const routeAssetId = Array.isArray(assetId) ? assetId[0] : assetId;
  return <StockDetailScreen key={routeAssetId ?? 'missing-asset'} />;
}
