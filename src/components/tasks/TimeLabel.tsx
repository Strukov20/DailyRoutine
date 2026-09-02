import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';

import { formatTimeLabel } from '@/domain/tasks/dateUtils';
import { useAppTheme } from '@/theme';

interface TimeLabelProps {
  startTime: string;
  durationMinutes?: number | null;
}

export function TimeLabel({ startTime, durationMinutes }: TimeLabelProps) {
  const { i18n } = useTranslation();
  const theme = useAppTheme();
  const label = formatTimeLabel(startTime, i18n.language);
  const withDuration = durationMinutes ? `${label} · ${durationMinutes}m` : label;

  return (
    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
      {withDuration}
    </Text>
  );
}
