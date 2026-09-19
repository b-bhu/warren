import { useMemo, useState } from 'react';
import { Input, Separator, Text, XStack, YStack } from 'tamagui';

import { marketStocks } from './catalog';
import { MarketHeader, MarketScreen, StockRow } from './MarketPrimitives';

export function MarketHomeScreen() {
  const [query, setQuery] = useState('');
  const filteredStocks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return marketStocks;

    return marketStocks.filter((stock) =>
      [stock.company, stock.ticker, stock.sector, stock.instrument.symbol]
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    );
  }, [query]);

  return (
    <MarketScreen>
      <MarketHeader action="guest" />

      <YStack gap="$3" paddingBottom="$2" paddingTop="$4">
        <Text
          role="heading"
          color="$ink"
          fontFamily="$serif"
          fontSize={40}
          fontWeight="700"
          letterSpacing={-1.5}
          lineHeight={44}>
          Markets
        </Text>
        <Text color="$muted" fontFamily="$body" fontSize={17} lineHeight={25} maxWidth={520}>
          Find a company first, then inspect the exact stock instrument available to buy.
        </Text>
      </YStack>

      <YStack gap="$4">
        <YStack gap="$2">
          <XStack alignItems="flex-end" justifyContent="space-between">
            <YStack gap="$1">
              <Text color="$ink" fontFamily="$serif" fontSize={27} fontWeight="700">
                Browse companies
              </Text>
              <Text color="$muted" fontFamily="$body" fontSize={14}>
                Curated catalog · sample prices
              </Text>
            </YStack>
            <Text color="$muted" fontFamily="$mono" fontSize={10} letterSpacing={0.6}>
              DEMO DATA
            </Text>
          </XStack>

          <Input
            aria-label="Search companies"
            autoCapitalize="characters"
            autoCorrect={false}
            backgroundColor="$surface"
            borderColor="$outline"
            borderRadius="$control"
            color="$ink"
            fontFamily="$body"
            fontSize={16}
            height={52}
            onChangeText={setQuery}
            placeholder="Search company or ticker"
            placeholderTextColor="$muted"
            returnKeyType="search"
            value={query}
          />
        </YStack>

        <YStack gap="$2">
          {filteredStocks.length ? (
            filteredStocks.map((stock) => <StockRow key={stock.ticker} stock={stock} />)
          ) : (
            <YStack
              backgroundColor="$surface"
              borderColor="$outline"
              borderRadius="$card"
              borderWidth={1}
              gap="$2"
              padding="$4">
              <Text color="$ink" fontFamily="$body" fontSize={16} fontWeight="700">
                No company found
              </Text>
              <Text color="$muted" fontFamily="$body" fontSize={14} lineHeight={21}>
                Try a company name, stock ticker, or token symbol from this demo catalog.
              </Text>
            </YStack>
          )}
        </YStack>
      </YStack>

      <YStack gap="$4" paddingBottom="$4" paddingTop="$2">
        <Separator borderColor="$outline" />
        <Text color="$muted" fontFamily="$body" fontSize={13} lineHeight={20}>
          Prices and listings on this screen are controlled product fixtures, not live
          quotes or an offer to trade. Live registry and market-data connections come in
          the next delivery slice.
        </Text>
      </YStack>
    </MarketScreen>
  );
}
