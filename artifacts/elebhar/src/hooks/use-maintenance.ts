import { useQueryClient } from "@tanstack/react-query";
import { 
  useListMaintenance, 
  useCreateMaintenance as useCreateMaintenanceApi, 
  useUpdateMaintenance as useUpdateMaintenanceApi,
  useDeleteMaintenance as useDeleteMaintenanceApi,
  getListMaintenanceQueryKey 
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export function useMaintenance() {
  return useListMaintenance();
}

export function useMaintenanceMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListMaintenanceQueryKey() });

  const create = useCreateMaintenanceApi({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Record added" }); },
      onError: () => toast({ title: "Error", variant: "destructive" })
    }
  });

  const update = useUpdateMaintenanceApi({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Record updated" }); },
      onError: () => toast({ title: "Error", variant: "destructive" })
    }
  });

  const remove = useDeleteMaintenanceApi({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Record deleted" }); },
      onError: () => toast({ title: "Error", variant: "destructive" })
    }
  });

  return {
    createRecord: create.mutateAsync, isCreating: create.isPending,
    updateRecord: update.mutateAsync, isUpdating: update.isPending,
    deleteRecord: remove.mutateAsync, isDeleting: remove.isPending
  };
}
