import { useQueryClient } from "@tanstack/react-query";
import { 
  useListAttendance, 
  useCreateAttendance as useCreateAttendanceApi, 
  useUpdateAttendance as useUpdateAttendanceApi,
  useDeleteAttendance as useDeleteAttendanceApi,
  getListAttendanceQueryKey 
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export function useAttendance() {
  return useListAttendance();
}

export function useAttendanceMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey() });

  const create = useCreateAttendanceApi({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Attendance marked" }); },
      onError: () => toast({ title: "Error", description: "Failed to mark attendance.", variant: "destructive" })
    }
  });

  const update = useUpdateAttendanceApi({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Attendance updated" }); },
      onError: () => toast({ title: "Error", description: "Failed to update attendance.", variant: "destructive" })
    }
  });

  const remove = useDeleteAttendanceApi({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Attendance deleted" }); },
      onError: () => toast({ title: "Error", description: "Failed to delete attendance.", variant: "destructive" })
    }
  });

  return {
    markAttendance: create.mutateAsync, isMarking: create.isPending,
    updateAttendance: update.mutateAsync, isUpdating: update.isPending,
    deleteAttendance: remove.mutateAsync, isDeleting: remove.isPending,
  };
}
