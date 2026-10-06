import React, { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii } from '../theme/styles';

export default function ExpandableProductImage({ uri, style, resizeMode = 'contain', label = 'Imagine produs' }) {
  const [open, setOpen] = useState(false);
  if (!uri) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Mărește ${label.toLowerCase()}`}
        onPress={(event) => { event?.stopPropagation?.(); setOpen(true); }}
        style={styles.trigger}
      >
        <Image source={{ uri }} style={style} resizeMode={resizeMode} accessibilityLabel={label} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Închide imaginea mărită">
          <View style={styles.preview} onStartShouldSetResponder={() => true}>
            <Image source={{ uri }} style={styles.fullImage} resizeMode="contain" accessibilityLabel={`${label} mărită`} />
          </View>
          <View style={styles.closeBadge} pointerEvents="none">
            <Text style={styles.closeText}>×</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { flexShrink: 0 },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    backgroundColor: 'rgba(0,0,0,0.92)',
  },
  preview: { width: '100%', height: '88%', alignItems: 'center', justifyContent: 'center' },
  fullImage: { width: '100%', height: '100%' },
  closeBadge: {
    position: 'absolute', top: 46, right: 18, width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center', borderRadius: radii.button,
    backgroundColor: colors.cardBg,
  },
  closeText: { color: colors.textPrimary, fontSize: 32, lineHeight: 34 },
});
