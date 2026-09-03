import { supabase } from '@/lib/supabase/client';
import { createLogger } from '@/lib/logger/logger';
import { mapCategoryRow } from '@/domain/categories/mappers';
import type { Category } from '@/domain/categories/types';

const logger = createLogger('category-service');

/**
 * Transport layer for categories — mirrors src/lib/tasks/taskService.ts.
 * System categories plus the caller's family categories are readable
 * directly (RLS-scoped SELECT); creating a custom category is RPC-only
 * (categories never had a working direct-INSERT path — see
 * docs/DECISIONS.md, "Phase 4").
 */

export type CategoryErrorCode = 'forbidden' | 'invalid_input' | 'unknown';

const CODE_BY_SQLSTATE: Record<string, CategoryErrorCode> = {
  '42501': 'forbidden',
  '23514': 'invalid_input',
  '23505': 'invalid_input',
};

export class CategoryServiceError extends Error {
  readonly code: CategoryErrorCode;

  constructor(code: CategoryErrorCode, message: string) {
    super(message);
    this.name = 'CategoryServiceError';
    this.code = code;
  }
}

function toCategoryServiceError(error: unknown): CategoryServiceError {
  const sqlState = (error as { code?: string } | null | undefined)?.code;
  const message = error instanceof Error ? error.message : 'Unknown category error';
  logger.warn('category request failed', { sqlState, message });
  const normalized = (sqlState && CODE_BY_SQLSTATE[sqlState]) || 'unknown';
  return new CategoryServiceError(normalized, message);
}

/** System categories plus the categories of every family the caller belongs to. */
export async function listCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('is_system', { ascending: false });
  if (error) throw toCategoryServiceError(error);
  return data.map(mapCategoryRow);
}

export async function createCustomCategory(
  familyId: string,
  name: string,
  colorToken: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_custom_category', {
    p_family_id: familyId,
    p_name: name,
    p_color_token: colorToken,
  });
  if (error) throw toCategoryServiceError(error);
  return data;
}
