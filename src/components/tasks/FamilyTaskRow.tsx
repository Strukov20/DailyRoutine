import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import type { Category } from '@/domain/categories/types';
import type { FamilyMember } from '@/domain/family/types';
import type { Task } from '@/domain/tasks/types';
import { useAppTheme } from '@/theme';

import { AssigneeLabel } from './AssigneeLabel';
import { AssigneePicker } from './AssigneePicker';
import { CategoryBadge } from './CategoryBadge';
import { CompletionCheckbox } from './CompletionCheckbox';
import { PriorityIndicator } from './PriorityIndicator';
import { TaskActionMenu } from './TaskActionMenu';
import { TimeLabel } from './TimeLabel';

interface FamilyTaskRowProps {
  task: Task;
  category?: Category;
  members: FamilyMember[];
  currentProfileId: string;
  currentMemberId: string | null;
  /** Creator or family owner — the only roles allowed to edit/assign/unassign/archive. */
  canManage: boolean;
  /** A mutation is currently in flight *for this task* — shows a loading spinner. */
  isBusy: boolean;
  /**
   * Assignment-state actions are unavailable for a reason other than "in
   * flight" (currently: offline — see docs/DECISIONS.md, "Phase 5,"
   * Section 12's offline guard). Disables the same controls as `isBusy`
   * but without implying a spinner.
   */
  disabled?: boolean;
  onTake: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onAssign: (memberId: string) => void;
  onReassign: (memberId: string) => void;
  onUnassign: () => void;
  onToggleComplete: () => void;
  onEdit: () => void;
  onArchive: () => void;
}

/**
 * A shared-task row — presentational, like TaskRow, but with the
 * assignment state machine's contextual actions surfaced directly (Take/
 * Accept/Decline are primary buttons, not buried in a menu, since they are
 * the board's core interactions) rather than delegating to hooks itself.
 * See docs/ARCHITECTURE.md, "business rules outside presentation components."
 */
export function FamilyTaskRow({
  task,
  category,
  members,
  currentProfileId,
  currentMemberId,
  canManage,
  isBusy,
  disabled = false,
  onTake,
  onAccept,
  onDecline,
  onAssign,
  onReassign,
  onUnassign,
  onToggleComplete,
  onEdit,
  onArchive,
}: FamilyTaskRowProps) {
  const { t } = useTranslation('tasks');
  const theme = useAppTheme();
  const completed = task.completedAt !== null;
  const isMyAssignment = currentMemberId !== null && task.assigneeMemberId === currentMemberId;
  const assignee = members.find((member) => member.id === task.assigneeMemberId);
  const canComplete =
    task.ownerProfileId === currentProfileId ||
    (isMyAssignment && task.assignmentStatus === 'accepted');
  const controlsDisabled = isBusy || disabled;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {canComplete ? (
          <CompletionCheckbox
            completed={completed}
            onToggle={onToggleComplete}
            disabled={controlsDisabled}
            testIDSuffix={task.id}
          />
        ) : (
          <View style={styles.checkboxSpacer} />
        )}
        <Pressable
          testID={`family-task-row-${task.id}`}
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
            {task.startTime ? (
              <TimeLabel startTime={task.startTime} durationMinutes={task.durationMinutes} />
            ) : null}
            <PriorityIndicator priority={task.priority} compact />
            {category ? <CategoryBadge category={category} /> : null}
            <AssigneeLabel
              assignmentStatus={task.assignmentStatus}
              assigneeName={assignee?.displayName ?? null}
              isMe={isMyAssignment}
            />
          </View>
        </Pressable>
        {canManage ? (
          <TaskActionMenu onEdit={onEdit} onArchive={onArchive} testIDSuffix={task.id} />
        ) : null}
      </View>

      {!completed ? (
        <View style={styles.actions}>
          {task.assignmentStatus === 'unassigned' ? (
            <Button
              testID={`family-task-take-${task.id}`}
              mode="contained-tonal"
              onPress={onTake}
              loading={isBusy}
              disabled={controlsDisabled}
              compact
            >
              {t('board.take')}
            </Button>
          ) : null}
          {isMyAssignment && task.assignmentStatus === 'pending_acceptance' ? (
            <>
              <Button
                testID={`family-task-accept-${task.id}`}
                mode="contained"
                onPress={onAccept}
                loading={isBusy}
                disabled={controlsDisabled}
                compact
              >
                {t('board.accept')}
              </Button>
              <Button
                testID={`family-task-decline-${task.id}`}
                mode="outlined"
                onPress={onDecline}
                disabled={controlsDisabled}
                compact
              >
                {t('board.decline')}
              </Button>
            </>
          ) : null}
          {canManage && task.assignmentStatus === 'unassigned' ? (
            <AssigneePicker
              testID={`family-task-assign-${task.id}`}
              members={members}
              label={t('board.assign')}
              onSelect={onAssign}
              disabled={controlsDisabled}
            />
          ) : null}
          {canManage &&
          (task.assignmentStatus === 'pending_acceptance' ||
            task.assignmentStatus === 'accepted') ? (
            <>
              <AssigneePicker
                testID={`family-task-reassign-${task.id}`}
                members={members}
                label={t('board.reassign')}
                onSelect={onReassign}
                disabled={controlsDisabled}
              />
              <Button mode="text" onPress={onUnassign} disabled={controlsDisabled} compact>
                {t('board.unassign')}
              </Button>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  checkboxSpacer: {
    width: 44,
    height: 44,
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
    flexWrap: 'wrap',
  },
  completedTitle: {
    textDecorationLine: 'line-through',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingLeft: 44,
    paddingBottom: 8,
  },
});
