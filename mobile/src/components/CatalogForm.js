import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Text, { TextInput } from './LocalizedText';
import { colors, buttonStyles } from '../theme/styles';

export function CatalogButton({ title, secondary, disabled, onPress }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[secondary ? buttonStyles.buttonSecondary : buttonStyles.buttonPrimary, catalogStyles.button, disabled && buttonStyles.buttonDisabled]}>
    <Text style={secondary ? buttonStyles.buttonSecondaryText : buttonStyles.buttonPrimaryText}>{title}</Text>
  </TouchableOpacity>;
}

export function CatalogField({ label, ...props }) {
  return <View style={catalogStyles.stack}><Text style={catalogStyles.label}>{label}</Text><TextInput accessibilityLabel={label} style={[catalogStyles.input, props.multiline && catalogStyles.multiline]} {...props} /></View>;
}

export const catalogStyles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { padding: 14, gap: 12, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.cardBg, borderRadius: 12 },
  stack: { gap: 6 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  help: { color: colors.textSecondary, lineHeight: 21 },
  error: { color: colors.danger, lineHeight: 21 },
  input: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 8, backgroundColor: colors.inputBg, color: colors.textPrimary, padding: 12, fontSize: 16, minHeight: 48 },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  button: { paddingHorizontal: 12 },
  imageActions: { flexDirection: 'row', gap: 8 },
  imageGrid: { gap: 10 },
  imageCard: { gap: 8, padding: 8, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 10, backgroundColor: colors.background },
  productImage: { width: '100%', height: 220, borderRadius: 8, backgroundColor: colors.cardBg },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.cardBorder, overflow: 'hidden' },
  fill: { height: 10, backgroundColor: colors.accentRed },
});
