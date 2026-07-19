import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Paginated } from "@/lib/types";

/**
 * Generic helper around a DRF-style paginated resource, e.g. /api/riders/.
 * Keeps query-key invalidation consistent across pages.
 */
export function createCrudHooks<TItem, TCreate = Partial<TItem>, TUpdate = Partial<TItem>>(
  resourceKey: string,
  basePath: string,
) {
  function useList(
    params?: Record<string, string | number | boolean | undefined | null>,
    options?: Partial<UseQueryOptions<Paginated<TItem>>>,
  ) {
    return useQuery({
      queryKey: [resourceKey, "list", params],
      queryFn: () => api.get<Paginated<TItem>>(basePath, { page_size: 100, ...params }),
      ...options,
    });
  }

  function useDetail(id: string | undefined) {
    return useQuery({
      queryKey: [resourceKey, "detail", id],
      queryFn: () => api.get<TItem>(`${basePath}${id}/`),
      enabled: Boolean(id),
    });
  }

  function useCreate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (body: TCreate) => api.post<TItem>(basePath, body),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: [resourceKey] });
      },
    });
  }

  function useUpdate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: ({ id, body }: { id: string; body: TUpdate }) =>
        api.patch<TItem>(`${basePath}${id}/`, body),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: [resourceKey] });
      },
    });
  }

  function useDelete() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => api.delete<void>(`${basePath}${id}/`),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: [resourceKey] });
      },
    });
  }

  return { useList, useDetail, useCreate, useUpdate, useDelete };
}
