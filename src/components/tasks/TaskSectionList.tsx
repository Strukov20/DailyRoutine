import { SectionList } from 'react-native';

import type { Category } from '@/domain/categories/types';
import type { Task } from '@/domain/tasks/types';

import { EmptyState } from '../ui/EmptyState';
import { SectionHeader } from './SectionHeader';
import { TaskRow } from './TaskRow';

export interface TaskSection {
  key: string;
  title: string;
  data: Task[];
  /** Rows in this section render the OverdueIndicator (the "overdue" bucket only). */
  showOverdue?: boolean;
}

interface TaskSectionListProps {
  sections: TaskSection[];
  categoriesById: Record<string, Category>;
  onToggleComplete: (task: Task) => void;
  togglingTaskId: string | null;
  onEdit: (task: Task) => void;
  onMoveToToday?: (task: Task) => void;
  onMoveToTomorrow?: (task: Task) => void;
  onMoveToInbox?: (task: Task) => void;
  onArchive: (task: Task) => void;
  emptyTitle: string;
  emptyDescription?: string;
  contentTopInset?: React.ReactElement;
}

/**
 * Shared list rendering for Inbox/Today/Tomorrow — each screen only
 * supplies its own bucketed `sections` (see src/domain/tasks/sections.ts)
 * and which quick actions apply. Empty state shows when every section is
 * empty, not per-section (a lone empty "Timed" section with a populated
 * "Anytime" section isn't an empty *screen*).
 */
export function TaskSectionList({
  sections,
  categoriesById,
  onToggleComplete,
  togglingTaskId,
  onEdit,
  onMoveToToday,
  onMoveToTomorrow,
  onMoveToInbox,
  onArchive,
  emptyTitle,
  emptyDescription,
  contentTopInset,
}: TaskSectionListProps) {
  const nonEmptySections = sections.filter((section) => section.data.length > 0);

  if (nonEmptySections.length === 0) {
    return (
      <>
        {contentTopInset}
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </>
    );
  }

  return (
    <SectionList
      sections={nonEmptySections}
      keyExtractor={(task) => task.id}
      ListHeaderComponent={contentTopInset}
      renderSectionHeader={({ section }) => (
        <SectionHeader title={section.title} count={section.data.length} />
      )}
      renderItem={({ item, section }) => (
        <TaskRow
          task={item}
          category={item.categoryId ? categoriesById[item.categoryId] : undefined}
          onToggleComplete={() => onToggleComplete(item)}
          isTogglingComplete={togglingTaskId === item.id}
          onEdit={() => onEdit(item)}
          onMoveToToday={onMoveToToday ? () => onMoveToToday(item) : undefined}
          onMoveToTomorrow={onMoveToTomorrow ? () => onMoveToTomorrow(item) : undefined}
          onMoveToInbox={onMoveToInbox ? () => onMoveToInbox(item) : undefined}
          onArchive={() => onArchive(item)}
          showOverdue={(section as TaskSection).showOverdue ?? false}
        />
      )}
      stickySectionHeadersEnabled={false}
    />
  );
}
