export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      categories: {
        Row: {
          color_token: string;
          created_at: string;
          created_by: string | null;
          family_id: string | null;
          id: string;
          is_system: boolean;
          name: string;
          updated_at: string;
        };
        Insert: {
          color_token: string;
          created_at?: string;
          created_by?: string | null;
          family_id?: string | null;
          id?: string;
          is_system?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          color_token?: string;
          created_at?: string;
          created_by?: string | null;
          family_id?: string | null;
          id?: string;
          is_system?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'categories_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'categories_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
        ];
      };
      event_participants: {
        Row: {
          created_at: string;
          event_id: string;
          family_id: string;
          family_member_id: string;
          id: string;
        };
        Insert: {
          created_at?: string;
          event_id: string;
          family_id: string;
          family_member_id: string;
          id?: string;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          family_id?: string;
          family_member_id?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_participants_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_participants_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'family_schedule';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_participants_same_family';
            columns: ['family_member_id', 'family_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'family_id'];
          },
        ];
      };
      events: {
        Row: {
          created_at: string;
          created_by: string;
          description: string | null;
          ends_at: string;
          family_id: string | null;
          id: string;
          location: string | null;
          owner_profile_id: string;
          recurrence_rule_id: string | null;
          starts_at: string;
          timezone: string;
          title: string;
          updated_at: string;
          visibility: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          description?: string | null;
          ends_at: string;
          family_id?: string | null;
          id?: string;
          location?: string | null;
          owner_profile_id: string;
          recurrence_rule_id?: string | null;
          starts_at: string;
          timezone: string;
          title: string;
          updated_at?: string;
          visibility?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          description?: string | null;
          ends_at?: string;
          family_id?: string | null;
          id?: string;
          location?: string | null;
          owner_profile_id?: string;
          recurrence_rule_id?: string | null;
          starts_at?: string;
          timezone?: string;
          title?: string;
          updated_at?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'events_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_owner_profile_id_fkey';
            columns: ['owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_recurrence_rule_id_fkey';
            columns: ['recurrence_rule_id'];
            isOneToOne: false;
            referencedRelation: 'recurrence_rules';
            referencedColumns: ['id'];
          },
        ];
      };
      families: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          owner_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'families_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'families_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      family_invitations: {
        Row: {
          created_at: string;
          created_by: string;
          expires_at: string;
          family_id: string;
          id: string;
          invited_by: string;
          invited_email: string;
          responded_at: string | null;
          status: string;
          token_hash: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          expires_at: string;
          family_id: string;
          id?: string;
          invited_by: string;
          invited_email: string;
          responded_at?: string | null;
          status?: string;
          token_hash: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          expires_at?: string;
          family_id?: string;
          id?: string;
          invited_by?: string;
          invited_email?: string;
          responded_at?: string | null;
          status?: string;
          token_hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'family_invitations_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'family_invitations_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'family_invitations_invited_by_fkey';
            columns: ['invited_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      family_members: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          created_by: string;
          date_of_birth: string | null;
          display_name: string;
          family_id: string;
          id: string;
          invited_by: string | null;
          member_type: string;
          profile_id: string | null;
          removed_at: string | null;
          role: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          created_by: string;
          date_of_birth?: string | null;
          display_name: string;
          family_id: string;
          id?: string;
          invited_by?: string | null;
          member_type: string;
          profile_id?: string | null;
          removed_at?: string | null;
          role: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          created_by?: string;
          date_of_birth?: string | null;
          display_name?: string;
          family_id?: string;
          id?: string;
          invited_by?: string | null;
          member_type?: string;
          profile_id?: string | null;
          removed_at?: string | null;
          role?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'family_members_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'family_members_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'family_members_invited_by_fkey';
            columns: ['invited_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'family_members_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_tokens: {
        Row: {
          created_at: string;
          device_platform: string;
          expo_push_token: string;
          id: string;
          last_seen_at: string;
          profile_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          device_platform: string;
          expo_push_token: string;
          id?: string;
          last_seen_at?: string;
          profile_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          device_platform?: string;
          expo_push_token?: string;
          id?: string;
          last_seen_at?: string;
          profile_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_tokens_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string;
          id: string;
          preferred_color_scheme: string;
          preferred_language: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name: string;
          id: string;
          preferred_color_scheme?: string;
          preferred_language?: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          preferred_color_scheme?: string;
          preferred_language?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      recurrence_rules: {
        Row: {
          by_weekday: number[] | null;
          created_at: string;
          created_by: string | null;
          frequency: string;
          id: string;
          interval: number;
          timezone: string;
          until: string | null;
          updated_at: string;
        };
        Insert: {
          by_weekday?: number[] | null;
          created_at?: string;
          created_by?: string | null;
          frequency: string;
          id?: string;
          interval?: number;
          timezone: string;
          until?: string | null;
          updated_at?: string;
        };
        Update: {
          by_weekday?: number[] | null;
          created_at?: string;
          created_by?: string | null;
          frequency?: string;
          id?: string;
          interval?: number;
          timezone?: string;
          until?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recurrence_rules_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      reminders: {
        Row: {
          created_at: string;
          delivered_at: string | null;
          id: string;
          offset_minutes_before: number | null;
          profile_id: string;
          remind_at: string;
          task_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          delivered_at?: string | null;
          id?: string;
          offset_minutes_before?: number | null;
          profile_id: string;
          remind_at: string;
          task_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          delivered_at?: string | null;
          id?: string;
          offset_minutes_before?: number | null;
          profile_id?: string;
          remind_at?: string;
          task_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reminders_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reminders_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'family_task_board';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reminders_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          },
        ];
      };
      responsibilities: {
        Row: {
          assignee_member_id: string | null;
          created_at: string;
          created_by: string;
          event_id: string;
          family_id: string;
          id: string;
          label: string | null;
          status: string;
          type: string;
          updated_at: string;
        };
        Insert: {
          assignee_member_id?: string | null;
          created_at?: string;
          created_by: string;
          event_id: string;
          family_id: string;
          id?: string;
          label?: string | null;
          status?: string;
          type: string;
          updated_at?: string;
        };
        Update: {
          assignee_member_id?: string | null;
          created_at?: string;
          created_by?: string;
          event_id?: string;
          family_id?: string;
          id?: string;
          label?: string | null;
          status?: string;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'responsibilities_assignee_same_family';
            columns: ['assignee_member_id', 'family_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'family_id'];
          },
          {
            foreignKeyName: 'responsibilities_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'responsibilities_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'responsibilities_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'family_schedule';
            referencedColumns: ['id'];
          },
        ];
      };
      task_assignments: {
        Row: {
          action: string;
          assigned_by_member_id: string | null;
          assigned_to_member_id: string;
          created_at: string;
          family_id: string;
          id: string;
          task_id: string;
        };
        Insert: {
          action: string;
          assigned_by_member_id?: string | null;
          assigned_to_member_id: string;
          created_at?: string;
          family_id: string;
          id?: string;
          task_id: string;
        };
        Update: {
          action?: string;
          assigned_by_member_id?: string | null;
          assigned_to_member_id?: string;
          created_at?: string;
          family_id?: string;
          id?: string;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'task_assignments_by_same_family';
            columns: ['assigned_by_member_id', 'family_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'family_id'];
          },
          {
            foreignKeyName: 'task_assignments_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'family_task_board';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_assignments_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_assignments_to_same_family';
            columns: ['assigned_to_member_id', 'family_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'family_id'];
          },
        ];
      };
      tasks: {
        Row: {
          assignee_member_id: string | null;
          assignment_status: string;
          category_id: string | null;
          completed_at: string | null;
          created_at: string;
          created_by: string;
          date: string | null;
          deleted_at: string | null;
          description: string | null;
          duration_minutes: number | null;
          family_id: string | null;
          id: string;
          owner_profile_id: string;
          priority: string;
          recurrence_rule_id: string | null;
          start_time: string | null;
          timezone: string | null;
          title: string;
          updated_at: string;
          visibility: string;
        };
        Insert: {
          assignee_member_id?: string | null;
          assignment_status?: string;
          category_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by: string;
          date?: string | null;
          deleted_at?: string | null;
          description?: string | null;
          duration_minutes?: number | null;
          family_id?: string | null;
          id?: string;
          owner_profile_id: string;
          priority?: string;
          recurrence_rule_id?: string | null;
          start_time?: string | null;
          timezone?: string | null;
          title: string;
          updated_at?: string;
          visibility?: string;
        };
        Update: {
          assignee_member_id?: string | null;
          assignment_status?: string;
          category_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string;
          date?: string | null;
          deleted_at?: string | null;
          description?: string | null;
          duration_minutes?: number | null;
          family_id?: string | null;
          id?: string;
          owner_profile_id?: string;
          priority?: string;
          recurrence_rule_id?: string | null;
          start_time?: string | null;
          timezone?: string | null;
          title?: string;
          updated_at?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tasks_assignee_same_family';
            columns: ['assignee_member_id', 'family_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'family_id'];
          },
          {
            foreignKeyName: 'tasks_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_owner_profile_id_fkey';
            columns: ['owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_recurrence_rule_id_fkey';
            columns: ['recurrence_rule_id'];
            isOneToOne: false;
            referencedRelation: 'recurrence_rules';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      family_schedule: {
        Row: {
          description: string | null;
          ends_at: string | null;
          family_id: string | null;
          id: string | null;
          location: string | null;
          owner_profile_id: string | null;
          starts_at: string | null;
          title: string | null;
          visibility: string | null;
        };
        Insert: {
          description?: never;
          ends_at?: string | null;
          family_id?: string | null;
          id?: string | null;
          location?: never;
          owner_profile_id?: string | null;
          starts_at?: string | null;
          title?: never;
          visibility?: string | null;
        };
        Update: {
          description?: never;
          ends_at?: string | null;
          family_id?: string | null;
          id?: string | null;
          location?: never;
          owner_profile_id?: string | null;
          starts_at?: string | null;
          title?: never;
          visibility?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'events_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'events_owner_profile_id_fkey';
            columns: ['owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      family_task_board: {
        Row: {
          assignee_member_id: string | null;
          assignment_status: string | null;
          category_id: string | null;
          date: string | null;
          description: string | null;
          duration_minutes: number | null;
          family_id: string | null;
          id: string | null;
          owner_profile_id: string | null;
          priority: string | null;
          start_time: string | null;
          timezone: string | null;
          title: string | null;
          visibility: string | null;
        };
        Insert: {
          assignee_member_id?: never;
          assignment_status?: string | null;
          category_id?: never;
          date?: string | null;
          description?: never;
          duration_minutes?: number | null;
          family_id?: string | null;
          id?: string | null;
          owner_profile_id?: string | null;
          priority?: never;
          start_time?: string | null;
          timezone?: string | null;
          title?: never;
          visibility?: string | null;
        };
        Update: {
          assignee_member_id?: never;
          assignment_status?: string | null;
          category_id?: never;
          date?: string | null;
          description?: never;
          duration_minutes?: number | null;
          family_id?: string | null;
          id?: string | null;
          owner_profile_id?: string | null;
          priority?: never;
          start_time?: string | null;
          timezone?: string | null;
          title?: never;
          visibility?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tasks_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_owner_profile_id_fkey';
            columns: ['owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      accept_family_invitation: {
        Args: { p_token: string };
        Returns: {
          family_id: string;
          family_member_id: string;
        }[];
      };
      accept_task_assignment: {
        Args: { p_task_id: string };
        Returns: undefined;
      };
      assign_family_task: {
        Args: { p_assignee_member_id: string; p_task_id: string };
        Returns: undefined;
      };
      complete_personal_task: {
        Args: { p_task_id: string };
        Returns: undefined;
      };
      complete_shared_task: { Args: { p_task_id: string }; Returns: undefined };
      create_child_profile: {
        Args: {
          p_avatar_url?: string;
          p_date_of_birth?: string;
          p_display_name: string;
          p_family_id: string;
        };
        Returns: string;
      };
      create_custom_category: {
        Args: { p_color_token: string; p_family_id: string; p_name: string };
        Returns: string;
      };
      create_family_invitation: {
        Args: {
          p_expires_in_hours?: number;
          p_family_id: string;
          p_invited_email: string;
        };
        Returns: {
          expires_at: string;
          invitation_id: string;
          token: string;
        }[];
      };
      create_family_with_owner: {
        Args: { p_name: string };
        Returns: {
          family_id: string;
          family_member_id: string;
        }[];
      };
      create_personal_task: {
        Args: {
          p_category_id?: string;
          p_date?: string;
          p_description?: string;
          p_duration_minutes?: number;
          p_family_id?: string;
          p_priority?: string;
          p_start_time?: string;
          p_timezone?: string;
          p_title: string;
          p_visibility?: string;
        };
        Returns: string;
      };
      create_shared_family_task: {
        Args: {
          p_assignee_member_id?: string;
          p_category_id?: string;
          p_date?: string;
          p_description?: string;
          p_duration_minutes?: number;
          p_family_id: string;
          p_priority?: string;
          p_start_time?: string;
          p_timezone?: string;
          p_title: string;
        };
        Returns: string;
      };
      current_family_ids: { Args: never; Returns: string[] };
      current_member_id: { Args: { p_family_id: string }; Returns: string };
      current_profile_id: { Args: never; Returns: string };
      decline_family_invitation: {
        Args: { p_token: string };
        Returns: undefined;
      };
      decline_task_assignment: {
        Args: { p_task_id: string };
        Returns: undefined;
      };
      delete_or_archive_personal_task: {
        Args: { p_task_id: string };
        Returns: undefined;
      };
      get_family_invitation_preview: {
        Args: { p_token: string };
        Returns: {
          expires_at: string;
          family_name: string;
          invited_by_display_name: string;
          is_valid: boolean;
          status: string;
        }[];
      };
      is_family_member: {
        Args: { p_family_id: string; p_profile_id?: string };
        Returns: boolean;
      };
      is_family_owner: {
        Args: { p_family_id: string; p_profile_id?: string };
        Returns: boolean;
      };
      move_task_to_inbox: { Args: { p_task_id: string }; Returns: undefined };
      reassign_family_task: {
        Args: { p_assignee_member_id: string; p_task_id: string };
        Returns: undefined;
      };
      remove_family_member: {
        Args: { p_member_id: string };
        Returns: undefined;
      };
      restore_personal_task: { Args: { p_task_id: string }; Returns: undefined };
      restore_shared_task: { Args: { p_task_id: string }; Returns: undefined };
      revoke_family_invitation: {
        Args: { p_invitation_id: string };
        Returns: undefined;
      };
      schedule_personal_task: {
        Args: {
          p_date: string;
          p_duration_minutes?: number;
          p_start_time?: string;
          p_task_id: string;
          p_timezone?: string;
        };
        Returns: undefined;
      };
      set_task_assignment: {
        Args: {
          p_action: string;
          p_assignee_member_id: string;
          p_task_id: string;
        };
        Returns: undefined;
      };
      take_family_task: { Args: { p_task_id: string }; Returns: undefined };
      unassign_family_task: { Args: { p_task_id: string }; Returns: undefined };
      update_child_profile: {
        Args: {
          p_avatar_url?: string;
          p_clear_avatar?: boolean;
          p_date_of_birth?: string;
          p_display_name?: string;
          p_member_id: string;
        };
        Returns: undefined;
      };
      update_personal_task: {
        Args: {
          p_category_id?: string;
          p_clear_category?: boolean;
          p_clear_description?: boolean;
          p_description?: string;
          p_family_id?: string;
          p_priority?: string;
          p_task_id: string;
          p_title?: string;
          p_visibility?: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
