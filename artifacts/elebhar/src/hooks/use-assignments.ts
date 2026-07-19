import { useQueryClient } from "@tanstack/react-query";
import { 
  useListAssignments, 
  useCreateAssignment as useCreateAssignmentApi, 
  useUpdateAssignment as useUpdateAssignmentApi,
  useDeleteAssignment as useDeleteAssignmentApi,
  getListAssignmentsQueryKey 
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export function useAssignments() {
  return useListAssignments();
}

export function useAssignmentMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAssignmentsQueryKey() });

  const create = useCreateAssignmentApi({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Assigned", description: "Vehicle assigned successfully." }); },
      onError: () => toast({ title: "Error", description: "Failed to assign vehicle.", variant: "destructive" })
    }
  });

  const update = useUpdateAssignmentApi({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Updated", description: "Assignment updated." }); },
      onError: () => toast({ title: "Error", description: "Failed to update assignment.", variant: "destructive" })
    }
  });

  const remove = useDeleteAssignmentApi({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Deleted", description: "Assignment removed." }); },
      onError: () => toast({ title: "Error", description: "Failed to delete assignment.", variant: "destructive" })
    }
  });

  return {
    createAssignment: create.mutateAsync, isCreating: create.isPending,
    updateAssignment: update.mutateAsync, isUpdating: update.isPending,
    deleteAssignment: remove.mutateAsync, isDeleting: remove.isPending
  };
}
