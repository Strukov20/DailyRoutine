import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { HelperText, IconButton, TextInput } from 'react-native-paper';

import { useCreatePersonalTask, useCreateSharedFamilyTask } from '@/domain/tasks/hooks';
import { quickAddTaskSchema } from '@/domain/tasks/schemas';
import { TaskServiceError } from '@/lib/tasks/taskService';
import { createLogger } from '@/lib/logger/logger';
import { useAppTheme } from '@/theme';

const logger = createLogger('quick-add-input');

interface QuickAddInputProps {
  /** "YYYY-MM-DD" to create directly on a date (Today/Tomorrow); omit for the Inbox. */
  date?: string;
  /**
   * When set, creates a shared (visibility=family) task in this family
   * instead of a personal one — used by the Family task board's own
   * quick-add. Mutually exclusive with `date` in practice (the board has
   * no date concept), but nothing enforces that here — the caller decides.
   */
  familyId?: string;
  /**
   * Disambiguates this instance's testIDs (quick-add-input-<screen>,
   * quick-add-submit-<screen>) for automation. Today/Tomorrow/Inbox all
   * mount their own QuickAddInput simultaneously — React Navigation's tab
   * navigator keeps sibling tab screens mounted after their first visit —
   * so a single static testID would match multiple on-screen elements at
   * once. Required, not optional-with-a-fallback: a silently-reused
   * default would reintroduce the exact ambiguity this exists to prevent.
   */
  screenId: string;
}

/**
 * Inline title-only task creation for Inbox/Today/Tomorrow/the Family
 * board (see docs/PRODUCT.md, "Quick creation should require only a
 * title"). Owns its own create-task mutation directly (unlike TaskRow) —
 * this widget's whole job *is* that one action, so there's no
 * screen-level orchestration to keep it out of.
 */
export function QuickAddInput({ date, familyId, screenId }: QuickAddInputProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const theme = useAppTheme();
  const [title, setTitle] = useState('');
  const [justAdded, setJustAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Both hooks are always called (React hooks can't be conditional) — only
  // the one matching `familyId` is ever actually invoked below.
  const createPersonalTask = useCreatePersonalTask();
  const createSharedTask = useCreateSharedFamilyTask(familyId ?? '');
  const isPending = familyId ? createSharedTask.isPending : createPersonalTask.isPending;

  const canSubmit = title.trim().length > 0 && !isPending;

  const onSubmit = async () => {
    // Guards duplicate submissions from a repeated tap/Enter while the
    // previous call is still in flight — useMutation does not dedupe
    // concurrent mutate() calls on its own.
    if (!canSubmit) return;

    const parsed = quickAddTaskSchema.safeParse({ title });
    if (!parsed.success) return;

    setError(null);
    try {
      if (familyId) {
        await createSharedTask.mutateAsync({ title: parsed.data.title });
      } else {
        await createPersonalTask.mutateAsync({ title: parsed.data.title, date });
      }
      setTitle('');
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 1500);
    } catch (caught) {
      const code = caught instanceof TaskServiceError ? caught.code : 'unknown';
      logger.warn('quick add failed', { code });
      setError(t('tasks:quickAdd.error'));
    }
  };

  return (
    <View>
      <View style={styles.row}>
        <TextInput
          testID={`quick-add-input-${screenId}`}
          mode="outlined"
          dense
          style={styles.input}
          placeholder={t('tasks:quickAdd.placeholder')}
          value={title}
          onChangeText={(value) => {
            setTitle(value);
            setJustAdded(false);
          }}
          onSubmitEditing={() => void onSubmit()}
          returnKeyType="done"
          right={
            justAdded ? <TextInput.Icon icon="check" color={theme.colors.success} /> : undefined
          }
        />
        <IconButton
          testID={`quick-add-submit-${screenId}`}
          icon="plus"
          mode="contained"
          disabled={!canSubmit}
          onPress={() => void onSubmit()}
          accessibilityLabel={t('tasks:quickAdd.submit')}
        />
      </View>
      <HelperText type="error" visible={Boolean(error)}>
        {error}
      </HelperText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  input: {
    flex: 1,
  },
});
