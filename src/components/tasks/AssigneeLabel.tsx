import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';

import type { AssignmentStatus } from '@/domain/tasks/types';
import { useAppTheme } from '@/theme';

interface AssigneeLabelProps {
  assignmentStatus: AssignmentStatus;
  /** Display name of the current assignee, or null if unassigned. */
  assigneeName: string | null;
  /** True when the current assignee is the viewer themselves. */
  isMe: boolean;
}

/** "Unassigned" / "Assigned to Dad" / "Pending: you" / "Pending: Dad" — never color-only. */
export function AssigneeLabel({ assignmentStatus, assigneeName, isMe }: AssigneeLabelProps) {
  const { t } = useTranslation('tasks');
  const theme = useAppTheme();

  const label = (() => {
    if (assignmentStatus === 'unassigned' || !assigneeName) {
      return t('board.unassigned');
    }
    const who = isMe ? t('board.you') : assigneeName;
    if (assignmentStatus === 'pending_acceptance') {
      return t('board.pendingOn', { who });
    }
    return t('board.assignedTo', { who });
  })();

  return (
    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
      {label}
    </Text>
  );
}
