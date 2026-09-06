import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import type { Category } from '@/domain/categories/types';
import type { Task } from '@/domain/tasks/types';
import { useAppTheme } from '@/theme';

import { CategoryBadge } from './CategoryBadge';
import { CompletionCheckbox } from './CompletionCheckbox';
import { OverdueIndicator } from './OverdueIndicator';
import { PriorityIndicator } from './PriorityIndicator';
import { TaskActionMenu } from './TaskActionMenu';
import { TimeLabel } from './TimeLabel';

interface TaskRowProps {
  task: Task;
  category?: Category;
  onToggleComplete: () => void;
  isTogglingComplete?: boolean;
  onEdit: () => void;
  onMoveToToday?: () => void;
  onMoveToTomorrow?: () => void;
  onMoveToInbox?: () => void;
  onArchive: () => void;
  showOverdue?: boolean;
}

/**
 * A single task row — presentational only (no hooks calling taskService
 * directly): every action is a prop the owning screen wires up, so this
 * stays reusable and testable without a QueryClientProvider. See
 * docs/ARCHITECTURE.md, "business rules outside presentation components."
 */
export function TaskRow({
  task,
  category,
  onToggleComplete,
  isTogglingComplete = false,
  onEdit,
  onMoveToToday,
  onMoveToTomorrow,
  onMoveToInbox,
  onArchive,
  showOverdue = false,
}: TaskRowProps) {
  const theme = useAppTheme();
  const completed = task.completedAt !== null;

  return (
    <View style={styles.row}>
      <CompletionCheckbox
        completed={completed}
        onToggle={onToggleComplete}
        disabled={isTogglingComplete}
        testIDSuffix={task.id}
      />
      <Pressable
        testID={`task-row-${task.id}`}
        onPress={onEdit}
        style={styles.content}
        accessibilityRole="button"
      >
        <Text
          variant="bodyMedium"
          numberOfLines={1}
          style={[
            completed && styles.completedTitle,
            { color: completed ? theme.colors.onSurfaceVariant : theme.colors.onSurface },
          ]}
        >
          {task.title}
        </Text>
        <View style={styles.meta}>
          {showOverdue ? <OverdueIndicator /> : null}
          {task.startTime ? (
            <TimeLabel startTime={task.startTime} durationMinutes={task.durationMinutes} />
          ) : null}
          <PriorityIndicator priority={task.priority} compact />
          {category ? <CategoryBadge category={category} /> : null}
        </View>
      </Pressable>
      <TaskActionMenu
        onEdit={onEdit}
        onMoveToToday={onMoveToToday}
        onMoveToTomorrow={onMoveToTomorrow}
        onMoveToInbox={onMoveToInbox}
        onArchive={onArchive}
        testIDSuffix={task.id}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  content: {
    flex: 1,
    gap: 4,
    paddingVertical: 8,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  completedTitle: {
    textDecorationLine: 'line-through',
  },
});
