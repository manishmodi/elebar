import { useQueryClient } from "@tanstack/react-query";
import { 
  useListDailyLogs, 
  useCreateDailyLog as useCreateDailyLogApi, 
  useUpdateDailyLog as useUpdateDailyLogApi,
  useDeleteDailyLog as useDeleteDailyLogApi,
  getListDailyLogsQueryKey 
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export function useDailyLogs() {
  return useListDailyLogs();
}

async function extractErrorMessage(err: unknown, fallback: string): Promise<string> {
  try {
    if (err && typeof err === "object" && "response" in err) {
      const resp = (err as { response: Response }).response;
      if (resp?.json) {
        const body = await resp.json();
        if (body?.error) return body.error;
      }
    }
    if (err instanceof Error) return err.message;
  } catch {
    // ignore parse errors
  }
  return fallback;
}

export function useDailyLogMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListDailyLogsQueryKey() });

  const create = useCreateDailyLogApi({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Log saved", description: "Daily log created successfully." }); },
      onError: async (err) => {
        const msg = await extractErrorMessage(err, "Failed to create log.");
        toast({ title: "Cannot create log", description: msg, variant: "destructive" });
      }
    }
  });

  const update = useUpdateDailyLogApi({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Log updated", description: "Daily log updated successfully." }); },
      onError: () => toast({ title: "Error", description: "Failed to update log.", variant: "destructive" })
    }
  });

  const remove = useDeleteDailyLogApi({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Log deleted", description: "Daily log removed." }); },
      onError: () => toast({ title: "Error", description: "Failed to delete log.", variant: "destructive" })
    }
  });

  return {
    createLog: create.mutateAsync, isCreating: create.isPending,
    updateLog: update.mutateAsync, isUpdating: update.isPending,
    deleteLog: remove.mutateAsync, isDeleting: remove.isPending
  };
}
