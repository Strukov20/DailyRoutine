import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Menu } from 'react-native-paper';

import type { FamilyMember } from '@/domain/family/types';

interface AssigneePickerProps {
  /** Current adult, non-removed members of the family — callers filter before passing in. */
  members: FamilyMember[];
  label: string;
  onSelect: (memberId: string) => void;
  disabled?: boolean;
}

/**
 * A small "assign to..." menu — used both for the shared-task editor's
 * optional assignee field and for the board's Assign/Reassign action.
 * Only ever lists adult/owner members: children cannot be assigned tasks
 * this phase (create_shared_family_task/assign_family_task reject it
 * server-side regardless — this is just keeping the picker honest about
 * what will actually work).
 */
export function AssigneePicker({
  members,
  label,
  onSelect,
  disabled = false,
}: AssigneePickerProps) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const adults = members.filter((member) => member.memberType === 'adult' && !member.removedAt);

  return (
    <Menu
      visible={open}
      onDismiss={() => setOpen(false)}
      anchor={
        <Button
          mode="outlined"
          icon="account-arrow-right-outline"
          disabled={disabled}
          onPress={() => setOpen(true)}
        >
          {label}
        </Button>
      }
    >
      {adults.length === 0 ? (
        <Menu.Item title={t('board.noAdultsToAssign')} disabled />
      ) : (
        adults.map((member) => (
          <Menu.Item
            key={member.id}
            title={member.displayName}
            onPress={() => {
              setOpen(false);
              onSelect(member.id);
            }}
          />
        ))
      )}
    </Menu>
  );
}
