import React, { memo, useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

function getInitials(label: string): string {
  const cleaned = (label ?? '').trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

export type AvatarProps = {
  avatarUrl?: string | null;
  label: string; // used for initials fallback
  size: number;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
};

export function Avatar({ avatarUrl, label, size, backgroundColor, borderColor, textColor }: AvatarProps) {
  const initials = useMemo(() => getInitials(label), [label]);

  const imageStyle = useMemo(() => styles.image(size), [size]);

  return (
    <View
      style={[
        styles.root,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
          borderColor,
          // When avatar_url exists, we still show the same circle background beneath the image.
        },
      ]}
    >
      {avatarUrl?.trim() ? (
        <Image source={{ uri: avatarUrl }} style={imageStyle} resizeMode="cover" />
      ) : (
        <Text style={[styles.text, { color: textColor, fontSize: Math.max(10, Math.round(size * 0.34)) }]} numberOfLines={1}>
          {initials}
        </Text>
      )}
    </View>
  );
}

export default memo(Avatar);

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: (size: number) => ({
    width: size,
    height: size,
  }),
  text: {
    fontWeight: '700',
    textAlign: 'center',
  },
});

