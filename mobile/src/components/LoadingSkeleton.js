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
      {Array.from({ length: 8 }).map((_, index) => (
        <View key={index} style={[styles.operationCard, index === 7 && styles.fullCard]}>
          <View style={styles.operationStripe} />
          <SkeletonLine width="62%" height={14} />
          <SkeletonLine width="88%" height={11} style={styles.operationLineGap} />
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
            <SkeletonLine width="70%" height={14} style={styles.lineGap} />
            <SkeletonLine width="54%" height={12} style={styles.lineGapSmall} />
          </View>
          <SkeletonLine width={92} height={36} style={styles.orderAction} />
        </View>
      ))}
    </View>
  );
}

export function CatalogListSkeleton({ count = 4 }) {
  return (
    <View style={styles.catalogList} accessibilityRole="progressbar" accessibilityLabel="Se încarcă produsele de verificat">
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={styles.catalogCard}>
          <SkeletonLine width="72%" height={18} />
          <SkeletonLine width="88%" height={14} />
          <SkeletonLine width="64%" height={13} />
          <SkeletonLine width="100%" height={48} style={styles.catalogAction} />
        </View>
      ))}
    </View>
  );
}

function CatalogFieldSkeleton({ labelWidth = '42%', multiline = false }) {
  return (
    <View style={styles.catalogField}>
      <SkeletonLine width={labelWidth} height={14} />
      <SkeletonLine width="100%" height={multiline ? 90 : 48} />
    </View>
  );
}

function CatalogHelpSkeleton({ short = false }) {
  return (
    <View style={styles.catalogHelp}>
      <SkeletonLine width="100%" height={13} />
      <SkeletonLine width={short ? '48%' : '78%'} height={13} />
    </View>
  );
}

export function CatalogDetailsSkeleton() {
  return (
    <View style={styles.catalogDetails} accessibilityRole="progressbar" accessibilityLabel="Se încarcă detaliile produsului">
      <View style={styles.catalogCard}>
        <SkeletonLine width="44%" height={18} />
        <CatalogFieldSkeleton labelWidth="66%" />
        <SkeletonLine width="100%" height={48} style={styles.catalogAction} />
        <CatalogHelpSkeleton />
      </View>
      <View style={styles.catalogCard}>
        <SkeletonLine width="38%" height={18} />
        <CatalogHelpSkeleton />
        <CatalogFieldSkeleton labelWidth="28%" />
        <CatalogFieldSkeleton labelWidth="46%" />
        <CatalogFieldSkeleton labelWidth="40%" />
        <CatalogFieldSkeleton labelWidth="30%" />
        <CatalogFieldSkeleton labelWidth="34%" multiline />
        <CatalogFieldSkeleton labelWidth="72%" multiline />
        <SkeletonLine width="48%" height={14} />
        <View style={styles.catalogPhotoActions}>
          <SkeletonLine width={118} height={48} style={styles.catalogAction} />
          <SkeletonLine width={118} height={48} style={styles.catalogAction} />
        </View>
        <SkeletonLine width="70%" height={13} />
        <CatalogFieldSkeleton labelWidth="58%" multiline />
        <SkeletonLine width="52%" height={14} />
        <SkeletonLine width="100%" height={48} style={styles.catalogAction} />
        <SkeletonLine width="100%" height={48} style={styles.catalogAction} />
      </View>
    </View>
  );
}

export function CatalogPhotoSkeleton() {
  return (
    <View style={styles.catalogPhoto} accessibilityRole="progressbar" accessibilityLabel="Se încarcă fotografia produsului">
      <SkeletonLine width="100%" height={220} style={styles.catalogPhotoPreview} />
      <SkeletonLine width="100%" height={48} style={styles.catalogAction} />
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
    width: '48.5%', minHeight: 84, padding: 14, paddingTop: 18, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.card,
    backgroundColor: colors.cardBg, overflow: 'hidden',
  },
  operationStripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 5, backgroundColor: '#b9d3f2' },
  operationLineGap: { marginTop: 6 },
  fullCard: { width: '100%' },
  orderRow: {
    minHeight: 92, padding: 14, marginBottom: 9, flexDirection: 'row',
    alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: radii.card, backgroundColor: colors.cardBg,
  },
  orderMain: { flex: 1, paddingRight: 16 },
  orderAction: { borderRadius: 18 },
  catalogList: { gap: 14 },
  catalogDetails: { gap: 14 },
  catalogCard: {
    padding: 14, gap: 12, borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: radii.card, backgroundColor: colors.cardBg,
  },
  catalogAction: { borderRadius: radii.button },
  catalogField: { gap: 6 },
  catalogHelp: { gap: 6 },
  catalogPhotoActions: { flexDirection: 'row', gap: 8 },
  catalogPhoto: {
    gap: 8, padding: 8, borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: 10, backgroundColor: colors.background,
  },
  catalogPhotoPreview: { borderRadius: 8 },
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
