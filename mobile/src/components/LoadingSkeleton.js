import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Text from './LocalizedText';
import { colors, fonts, radii } from '../theme/styles';

function useSkeletonOpacity() {
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 650, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return opacity;
}

function SkeletonLine({ width = '100%', height = 12, style }) {
  const opacity = useSkeletonOpacity();
  return <Animated.View style={[styles.line, { width, height, opacity }, style]} />;
}

export function OperationGridSkeleton() {
  return (
    <View style={styles.grid} accessibilityRole="progressbar" accessibilityLabel="Se încarcă etapele depozitului">
      {Array.from({ length: 7 }).map((_, index) => (
        <View key={index} style={[styles.operationCard, index === 6 && styles.fullCard]}>
          <SkeletonLine width="58%" height={14} />
          <SkeletonLine width="82%" height={10} style={styles.lineGap} />
        </View>
      ))}
    </View>
  );
}

export function OrderListSkeleton({ count = 5 }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Se încarcă comenzile">
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={styles.orderRow}>
          <View style={styles.orderMain}>
            <SkeletonLine width="42%" height={17} />
            <SkeletonLine width="70%" height={12} style={styles.lineGap} />
            <SkeletonLine width="54%" height={10} style={styles.lineGapSmall} />
          </View>
          <SkeletonLine width={82} height={34} />
        </View>
      ))}
    </View>
  );
}

export function BusySkeleton({ title = 'Se procesează...', detail = 'Păstrează aplicația deschisă.' }) {
  return (
    <View style={styles.busyScreen} accessibilityRole="progressbar" accessibilityLabel={title}>
      <View style={styles.busyCard}>
        <SkeletonLine width="48%" height={18} />
        <SkeletonLine width="100%" height={54} style={styles.busyGap} />
        <SkeletonLine width="100%" height={54} style={styles.lineGap} />
        <Text style={styles.busyTitle}>{title}</Text>
        <Text style={styles.busyDetail}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { borderRadius: 6, backgroundColor: '#dce8f7' },
  lineGap: { marginTop: 10 },
  lineGapSmall: { marginTop: 7 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  operationCard: {
    width: '48.5%', minHeight: 82, padding: 14, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.card,
    backgroundColor: colors.cardBg,
  },
  fullCard: { width: '100%' },
  orderRow: {
    minHeight: 92, padding: 14, marginBottom: 9, flexDirection: 'row',
    alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: radii.card, backgroundColor: colors.cardBg,
  },
  orderMain: { flex: 1, paddingRight: 16 },
  busyScreen: {
    flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.background,
  },
  busyCard: {
    width: '100%', maxWidth: 440, padding: 20, borderWidth: 1,
    borderColor: colors.cardBorder, borderRadius: radii.card, backgroundColor: colors.cardBg,
  },
  busyGap: { marginTop: 24 },
  busyTitle: {
    marginTop: 22, fontFamily: fonts.mono, fontSize: 15, fontWeight: '800',
    textAlign: 'center', color: colors.accentRed,
  },
  busyDetail: { marginTop: 7, textAlign: 'center', color: colors.textMuted, fontSize: 12 },
});
