import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import Text from './LocalizedText';
import { colors, fonts, radii } from '../theme/styles';
import { useWorkspace } from '../workspace/WorkspaceContext';

export default function WorkspaceUndoButton() {
  const { canUndo, undo } = useWorkspace();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Anulează ultima acțiune"
      disabled={!canUndo}
      onPress={undo}
      style={[styles.button, !canUndo && styles.disabled]}
    >
      <Text style={styles.text}>{'↶ ANULEAZĂ'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: radii.small,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.cardBg,
  },
  disabled: { opacity: 0.35 },
  text: { color: colors.accentRed, fontFamily: fonts.mono, fontSize: 10, fontWeight: '700' },
});
