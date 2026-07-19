import { useQueryClient } from "@tanstack/react-query";
import { 
  useListVehicles, 
  useCreateVehicle as useCreateVehicleApi, 
  useUpdateVehicle as useUpdateVehicleApi,
  useDeleteVehicle as useDeleteVehicleApi,
  getListVehiclesQueryKey 
} from "@workspace/api-client-react";
import type { ErrorType } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

function extractErrorMessage(err: ErrorType<{ error?: string }>, fallback: string): string {
  const data = err.data as { error?: string } | null;
  return data?.error || fallback;
}

export function useVehicles() {
  return useListVehicles();
}

export function useVehicleMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });

  const create = useCreateVehicleApi({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Vehicle added", description: "Successfully added new vehicle." });
      },
      onError: (err) => toast({ title: "Error", description: "Failed to add vehicle.", variant: "destructive" })
    }
  });

  const update = useUpdateVehicleApi({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Vehicle updated", description: "Successfully updated vehicle details." });
      },
      onError: () => toast({ title: "Error", description: "Failed to update vehicle.", variant: "destructive" })
    }
  });

  const remove = useDeleteVehicleApi({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Vehicle deleted", description: "Successfully removed vehicle." });
      },
      onError: (err) => toast({ title: "Error", description: extractErrorMessage(err, "Failed to delete vehicle."), variant: "destructive" })
    }
  });

  return {
    createVehicle: create.mutateAsync,
    isCreating: create.isPending,
    updateVehicle: update.mutateAsync,
    isUpdating: update.isPending,
    deleteVehicle: remove.mutateAsync,
    isDeleting: remove.isPending
  };
}
