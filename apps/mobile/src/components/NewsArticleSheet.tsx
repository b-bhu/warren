import { useState } from 'react';
import { Image } from 'expo-image';
import { openBrowserAsync } from 'expo-web-browser';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type NewsArticleContent = {
  id: string;
  headline: string;
  source: string;
  publishedAt: string;
  imageUrl: string | null;
  summary: string | null;
  url?: string | null;
};

export function NewsArticleSheet({
  article,
  eyebrow = 'Company news',
  onClose,
}: {
  article?: NewsArticleContent;
  eyebrow?: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [failedImageUrl, setFailedImageUrl] = useState<string>();
  const imageFailed = Boolean(article?.imageUrl && failedImageUrl === article.imageUrl);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={Boolean(article)}>
      <View accessibilityViewIsModal style={styles.root}>
        <Pressable
          accessibilityLabel="Close article preview"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        <SafeAreaView
          edges={['bottom']}
          style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
          <View style={[styles.handle, { backgroundColor: theme.outline }]} />
          {article ? (
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              <View style={[styles.artwork, { backgroundColor: theme.proofWash }]}>
                {article.imageUrl && !imageFailed ? (
                  <Image
                    accessibilityLabel={`Image for ${article.headline}`}
                    contentFit="cover"
                    onError={() => setFailedImageUrl(article.imageUrl ?? undefined)}
                    source={{ uri: article.imageUrl }}
                    style={StyleSheet.absoluteFill}
                    transition={150}
                  />
                ) : (
                  <Text style={[styles.fallback, { color: theme.proof }]}>
                    {article.source.slice(0, 2).toUpperCase()}
                  </Text>
                )}
              </View>

              <View style={styles.topLine}>
                <View style={styles.kicker}>
                  <Text style={[styles.eyebrow, { color: theme.proof }]}>{eyebrow}</Text>
                  <Text style={[styles.published, { color: theme.muted }]}>
                    {formatPublishedAt(article.publishedAt)}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Close article preview"
                  accessibilityRole="button"
                  onPress={onClose}
                  style={({ pressed }) => [
                    styles.close,
                    { borderColor: theme.outline, backgroundColor: pressed ? theme.proofWash : 'transparent' },
                  ]}>
                  <Text style={[styles.closeText, { color: theme.ink }]}>×</Text>
                </Pressable>
              </View>

              <Text accessibilityRole="header" style={[styles.headline, { color: theme.ink }]}>
                {article.headline}
              </Text>
              <View style={[styles.source, { borderBottomColor: theme.outline, borderTopColor: theme.outline }]}>
                <Text style={[styles.sourceLabel, { color: theme.muted }]}>Published by</Text>
                <Text style={[styles.sourceName, { color: theme.ink }]}>{article.source}</Text>
              </View>
              <Text style={[styles.summary, { color: theme.muted }]}>
                {article.summary ?? `This preview contains the headline and publishing details supplied by ${article.source}.`}
              </Text>
              {article.url ? (
                <Pressable
                  accessibilityHint="Opens the publisher page in an in-app browser"
                  accessibilityRole="link"
                  onPress={() => void openBrowserAsync(article.url!)}
                  style={({ pressed }) => [
                    styles.sourceButton,
                    { borderColor: theme.outline, backgroundColor: pressed ? theme.proofWash : 'transparent' },
                  ]}>
                  <Text style={[styles.sourceButtonText, { color: theme.proof }]}>Read at {article.source}</Text>
                  <Text style={[styles.sourceButtonArrow, { color: theme.proof }]}>↗</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function formatPublishedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Publication time not provided';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${months[date.getMonth()]} ${date.getDate()} · ${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0, 0, 0, 0.68)' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    maxHeight: '88%',
    minHeight: 360,
    paddingHorizontal: Spacing.three,
    paddingTop: 10,
  },
  handle: { alignSelf: 'center', borderRadius: 2, height: 4, marginBottom: 12, width: 38 },
  content: { paddingBottom: Spacing.four },
  artwork: { alignItems: 'center', aspectRatio: 1.75, borderRadius: Radii.card, justifyContent: 'center', overflow: 'hidden' },
  fallback: { fontFamily: Fonts.serif, fontSize: 36, fontWeight: '700' },
  topLine: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, justifyContent: 'space-between', marginTop: 16 },
  kicker: { flex: 1 },
  eyebrow: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  published: { fontFamily: Fonts.mono, fontSize: 9, marginTop: 5 },
  close: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  closeText: { fontFamily: Fonts.sans, fontSize: 24, lineHeight: 26 },
  headline: { fontFamily: Fonts.serif, fontSize: 25, fontWeight: '700', letterSpacing: -0.6, lineHeight: 31, marginTop: 18 },
  source: { borderBottomWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 20, paddingVertical: 13 },
  sourceLabel: { fontFamily: Fonts.mono, fontSize: 8, textTransform: 'uppercase' },
  sourceName: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700', marginTop: 5 },
  summary: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 22, marginTop: 18 },
  sourceButton: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 20, minHeight: 48, paddingHorizontal: 14 },
  sourceButtonText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700' },
  sourceButtonArrow: { fontFamily: Fonts.sans, fontSize: 16 },
});
