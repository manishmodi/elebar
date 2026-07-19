import { useQueryClient } from "@tanstack/react-query";
import { 
  useListRiders, 
  useCreateRider as useCreateRiderApi, 
  useUpdateRider as useUpdateRiderApi,
  useDeleteRider as useDeleteRiderApi,
  getListRidersQueryKey 
} from "@workspace/api-client-react";
import type { ErrorType } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

function extractErrorMessage(err: ErrorType<{ error?: string }>, fallback: string): string {
  const data = err.data as { error?: string } | null;
  return data?.error || fallback;
}

export function useRiders() {
  return useListRiders();
}

export function useRiderMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListRidersQueryKey() });

  const create = useCreateRiderApi({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Rider added", description: "Successfully added new rider profile." });
      },
      onError: () => toast({ title: "Error", description: "Failed to add rider.", variant: "destructive" })
    }
  });

  const update = useUpdateRiderApi({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Rider updated", description: "Successfully updated rider profile." });
      },
      onError: () => toast({ title: "Error", description: "Failed to update rider.", variant: "destructive" })
    }
  });

  const remove = useDeleteRiderApi({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Rider deleted", description: "Successfully removed rider." });
      },
      onError: (err) => toast({ title: "Error", description: extractErrorMessage(err, "Failed to delete rider."), variant: "destructive" })
    }
  });

  return {
    createRider: create.mutateAsync,
    isCreating: create.isPending,
    updateRider: update.mutateAsync,
    isUpdating: update.isPending,
    deleteRider: remove.mutateAsync,
    isDeleting: remove.isPending
  };
}
