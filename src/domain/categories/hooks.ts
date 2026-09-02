import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createCustomCategory, listCategories } from '@/lib/categories/categoryService';

export const categoryKeys = {
  all: ['categories'] as const,
};

export function useCategories() {
  return useQuery({ queryKey: categoryKeys.all, queryFn: listCategories });
}

export function useCreateCustomCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      familyId,
      name,
      colorToken,
    }: {
      familyId: string;
      name: string;
      colorToken: string;
    }) => createCustomCategory(familyId, name, colorToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: categoryKeys.all });
    },
  });
}
