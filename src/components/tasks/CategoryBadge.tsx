import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import type { Category } from '@/domain/categories/types';
import { categoryColors, useAppTheme } from '@/theme';

const SYSTEM_COLOR_TOKENS = Object.keys(categoryColors);

interface CategoryBadgeProps {
  category: Category;
}

/**
 * `category.colorToken` is the identity used both for the color lookup and
 * (for a system category) the localized label — `category.name` is only
 * ever shown for a custom category, which has no translation key. See
 * docs/DATA_MODEL.md and docs/DECISIONS.md, "Phase 4."
 */
export function CategoryBadge({ category }: CategoryBadgeProps) {
  const { t } = useTranslation('common');
  const theme = useAppTheme();

  const isKnownToken = (SYSTEM_COLOR_TOKENS as string[]).includes(category.colorToken);
  const color = isKnownToken
    ? categoryColors[category.colorToken as keyof typeof categoryColors]
    : theme.colors.onSurfaceVariant;
  const label =
    category.isSystem && isKnownToken ? t(`category.${category.colorToken}`) : category.name;

  return (
    <View style={styles.row} accessible accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
