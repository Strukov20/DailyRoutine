import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, Menu } from 'react-native-paper';

interface TaskActionMenuProps {
  onEdit: () => void;
  onMoveToToday?: () => void;
  onMoveToTomorrow?: () => void;
  onMoveToInbox?: () => void;
  onArchive: () => void;
}

/** Trailing "..." action menu for a task row — see docs/DATA_MODEL.md task lifecycle. */
export function TaskActionMenu({
  onEdit,
  onMoveToToday,
  onMoveToTomorrow,
  onMoveToInbox,
  onArchive,
}: TaskActionMenuProps) {
  const { t } = useTranslation('tasks');
  const [visible, setVisible] = useState(false);

  const runAndClose = (action: () => void) => {
    setVisible(false);
    action();
  };

  return (
    <Menu
      visible={visible}
      onDismiss={() => setVisible(false)}
      anchor={
        <IconButton
          icon="dots-vertical"
          size={20}
          onPress={() => setVisible(true)}
          accessibilityLabel={t('row.actions')}
        />
      }
    >
      <Menu.Item
        leadingIcon="pencil-outline"
        title={t('row.edit')}
        onPress={() => runAndClose(onEdit)}
      />
      {onMoveToToday ? (
        <Menu.Item
          leadingIcon="calendar-today"
          title={t('row.moveToToday')}
          onPress={() => runAndClose(onMoveToToday)}
        />
      ) : null}
      {onMoveToTomorrow ? (
        <Menu.Item
          leadingIcon="calendar-arrow-right"
          title={t('row.moveToTomorrow')}
          onPress={() => runAndClose(onMoveToTomorrow)}
        />
      ) : null}
      {onMoveToInbox ? (
        <Menu.Item
          leadingIcon="tray-arrow-down"
          title={t('row.moveToInbox')}
          onPress={() => runAndClose(onMoveToInbox)}
        />
      ) : null}
      <Menu.Item
        leadingIcon="archive-outline"
        title={t('row.archive')}
        onPress={() => runAndClose(onArchive)}
      />
    </Menu>
  );
}
