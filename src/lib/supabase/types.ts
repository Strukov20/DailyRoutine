/**
 * Supabase database types.
 *
 * PROVISIONAL — hand-authored to mirror supabase/migrations/*.sql exactly,
 * because this environment has no Docker/local Postgres to run the real
 * generator against (see docs/DECISIONS.md, "Docker availability"). Once a
 * local Supabase stack is available, regenerate for real and this notice
 * should disappear:
 *
 *   npm run db:types
 *
 * (wraps `supabase gen types typescript --local`). Do not hand-edit table
 * shapes after that point — treat this file as generated.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          preferred_language: 'en' | 'uk';
          preferred_color_scheme: 'system' | 'light' | 'dark';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          avatar_url?: string | null;
          preferred_language?: 'en' | 'uk';
          preferred_color_scheme?: 'system' | 'light' | 'dark';
        };
        Update: Partial<{
          display_name: string;
          avatar_url: string | null;
          preferred_language: 'en' | 'uk';
          preferred_color_scheme: 'system' | 'light' | 'dark';
        }>;
      };

      families: {
        Row: {
          id: string;
          name: string;
          owner_id: string;
          created_at: string;
          updated_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          name: string;
          owner_id: string;
          created_by: string;
        };
        Update: Partial<{
          name: string;
        }>;
      };

      family_members: {
        Row: {
          id: string;
          family_id: string;
          member_type: 'adult' | 'child';
          role: 'owner' | 'adult' | 'child';
          profile_id: string | null;
          display_name: string;
          avatar_url: string | null;
          date_of_birth: string | null;
          invited_by: string | null;
          created_at: string;
          updated_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          member_type: 'adult' | 'child';
          role: 'owner' | 'adult' | 'child';
          profile_id?: string | null;
          display_name: string;
          avatar_url?: string | null;
          date_of_birth?: string | null;
          invited_by?: string | null;
          created_by: string;
        };
        Update: Partial<{
          display_name: string;
          avatar_url: string | null;
          date_of_birth: string | null;
        }>;
      };

      family_invitations: {
        Row: {
          id: string;
          family_id: string;
          invited_email: string;
          invited_by: string;
          status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
          responded_at: string | null;
          expires_at: string;
          created_at: string;
          updated_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          invited_email: string;
          invited_by: string;
          status?: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
          expires_at: string;
          created_by: string;
        };
        Update: Partial<{
          status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
          responded_at: string | null;
        }>;
      };

      categories: {
        Row: {
          id: string;
          family_id: string | null;
          name: string;
          color_token: string;
          is_system: boolean;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          family_id?: string | null;
          name: string;
          color_token: string;
          is_system?: boolean;
          created_by?: string | null;
        };
        Update: Partial<{
          name: string;
          color_token: string;
        }>;
      };

      tasks: {
        Row: {
          id: string;
          owner_profile_id: string;
          family_id: string | null;
          title: string;
          description: string | null;
          date: string | null;
          start_time: string | null;
          duration_minutes: number | null;
          timezone: string | null;
          priority: 'normal' | 'important' | 'critical';
          category_id: string | null;
          recurrence_rule_id: string | null;
          visibility: 'private' | 'family';
          completed_at: string | null;
          assignee_member_id: string | null;
          assignment_status: 'unassigned' | 'pending_acceptance' | 'accepted' | 'declined';
          created_at: string;
          updated_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          owner_profile_id: string;
          family_id?: string | null;
          title: string;
          description?: string | null;
          date?: string | null;
          start_time?: string | null;
          duration_minutes?: number | null;
          timezone?: string | null;
          priority?: 'normal' | 'important' | 'critical';
          category_id?: string | null;
          recurrence_rule_id?: string | null;
          visibility?: 'private' | 'family';
          created_by: string;
        };
        Update: Partial<{
          title: string;
          description: string | null;
          date: string | null;
          start_time: string | null;
          duration_minutes: number | null;
          timezone: string | null;
          priority: 'normal' | 'important' | 'critical';
          category_id: string | null;
          recurrence_rule_id: string | null;
          visibility: 'private' | 'family';
          completed_at: string | null;
        }>;
      };

      task_assignments: {
        Row: {
          id: string;
          task_id: string;
          family_id: string;
          assigned_to_member_id: string;
          assigned_by_member_id: string | null;
          action: 'assigned' | 'took' | 'accepted' | 'declined' | 'unassigned' | 'reassigned';
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          assigned_to_member_id: string;
          assigned_by_member_id?: string | null;
          action: 'assigned' | 'took' | 'accepted' | 'declined' | 'unassigned' | 'reassigned';
        };
        Update: never; // append-only — see supabase/migrations, no UPDATE grant exists
      };

      reminders: {
        Row: {
          id: string;
          task_id: string;
          profile_id: string;
          remind_at: string;
          offset_minutes_before: number | null;
          delivered_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          profile_id: string;
          remind_at: string;
          offset_minutes_before?: number | null;
        };
        Update: Partial<{
          remind_at: string;
          offset_minutes_before: number | null;
          delivered_at: string | null;
        }>;
      };

      recurrence_rules: {
        Row: {
          id: string;
          frequency: 'daily' | 'weekly' | 'monthly';
          interval: number;
          by_weekday: number[] | null;
          until: string | null;
          timezone: string;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        // Not directly reachable via the Data API this phase — see
        // supabase/migrations/20260902120400_recurrence_rules.sql.
        Insert: never;
        Update: never;
      };

      events: {
        Row: {
          id: string;
          owner_profile_id: string;
          family_id: string | null;
          title: string;
          description: string | null;
          location: string | null;
          starts_at: string;
          ends_at: string;
          timezone: string;
          visibility: 'private' | 'family';
          recurrence_rule_id: string | null;
          created_at: string;
          updated_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          owner_profile_id: string;
          family_id?: string | null;
          title: string;
          description?: string | null;
          location?: string | null;
          starts_at: string;
          ends_at: string;
          timezone: string;
          visibility?: 'private' | 'family';
          recurrence_rule_id?: string | null;
          created_by: string;
        };
        Update: Partial<{
          title: string;
          description: string | null;
          location: string | null;
          starts_at: string;
          ends_at: string;
          timezone: string;
          visibility: 'private' | 'family';
          recurrence_rule_id: string | null;
        }>;
      };

      event_participants: {
        Row: {
          id: string;
          event_id: string;
          family_id: string;
          family_member_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          family_member_id: string;
        };
        Update: never;
      };

      responsibilities: {
        Row: {
          id: string;
          event_id: string;
          family_id: string;
          type: 'drop_off' | 'pick_up' | 'supervise' | 'custom';
          label: string | null;
          assignee_member_id: string | null;
          status: 'unassigned' | 'pending_acceptance' | 'accepted' | 'declined' | 'done';
          created_at: string;
          updated_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          type: 'drop_off' | 'pick_up' | 'supervise' | 'custom';
          label?: string | null;
          assignee_member_id?: string | null;
          status?: 'unassigned' | 'pending_acceptance' | 'accepted' | 'declined' | 'done';
          created_by: string;
        };
        Update: Partial<{
          type: 'drop_off' | 'pick_up' | 'supervise' | 'custom';
          label: string | null;
          assignee_member_id: string | null;
          status: 'unassigned' | 'pending_acceptance' | 'accepted' | 'declined' | 'done';
        }>;
      };

      notification_tokens: {
        Row: {
          id: string;
          profile_id: string;
          expo_push_token: string;
          device_platform: 'ios' | 'android';
          last_seen_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          expo_push_token: string;
          device_platform: 'ios' | 'android';
        };
        Update: Partial<{
          last_seen_at: string;
        }>;
      };
    };

    Views: {
      // Sanitized "Busy block" availability — see
      // supabase/migrations/20260902120800_sanitized_availability.sql and
      // docs/SECURITY_AND_PRIVACY.md. title/description/location are null
      // for private events (the sanitized case), populated for
      // visibility='family' ones.
      family_schedule: {
        Row: {
          id: string;
          family_id: string;
          owner_profile_id: string;
          starts_at: string;
          ends_at: string;
          visibility: 'private' | 'family';
          title: string | null;
          description: string | null;
          location: string | null;
        };
      };
      family_task_board: {
        Row: {
          id: string;
          family_id: string;
          owner_profile_id: string;
          date: string | null;
          start_time: string | null;
          duration_minutes: number | null;
          timezone: string | null;
          visibility: 'private' | 'family';
          assignment_status: 'unassigned' | 'pending_acceptance' | 'accepted' | 'declined';
          title: string | null;
          description: string | null;
          priority: 'normal' | 'important' | 'critical' | null;
          category_id: string | null;
          assignee_member_id: string | null;
        };
      };
    };

    Functions: {
      current_profile_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      is_family_member: {
        Args: { p_family_id: string; p_profile_id?: string };
        Returns: boolean;
      };
      is_family_owner: {
        Args: { p_family_id: string; p_profile_id?: string };
        Returns: boolean;
      };
      current_family_ids: {
        Args: Record<string, never>;
        Returns: string[];
      };
    };

    Enums: Record<string, never>;
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TableInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TableUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
export type ViewRow<T extends keyof Database['public']['Views']> =
  Database['public']['Views'][T]['Row'];
