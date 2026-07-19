import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getListVehiclesQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = `${import.meta.env.BASE_URL}api`;

export type ServiceStatus = "ok" | "due_soon" | "overdue" | "unknown";

export interface VehicleServiceStatus {
  id: number;
  vehicleNumber: string;
  plateNumber: string;
  status: string;
  lastServiceDate: string | null;
  lastServiceOdometer: number | null;
  currentOdometer: number | null;
  lastOdometerDate: string | null;
  kmSinceLast: number | null;
  kmUntilNext: number | null;
  serviceStatus: ServiceStatus;
  inServicingSince: string | null;
}

export interface ServiceHistoryRecord {
  id: number;
  vehicleId: number;
  vehiclePlate: string | null;
  vehicleNumber: string | null;
  serviceDate: string;
  odometerAtService: number;
  notes: string | null;
  cost: string | null;
  createdAt: string;
}

const SERVICING_STATUS_KEY = ["servicing-status"];
const SERVICING_HISTORY_KEY = ["servicing-history"];

export function useServicingStatus() {
  return useQuery<VehicleServiceStatus[]>({
    queryKey: SERVICING_STATUS_KEY,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/servicing/status`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch servicing status");
      return res.json();
    },
  });
}

export function useServiceHistory(vehicleId?: number) {
  return useQuery<ServiceHistoryRecord[]>({
    queryKey: [...SERVICING_HISTORY_KEY, vehicleId],
    queryFn: async () => {
      const url = vehicleId
        ? `${API_BASE}/servicing/history?vehicleId=${vehicleId}`
        : `${API_BASE}/servicing/history`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch service history");
      return res.json();
    },
  });
}

export function useServicingMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: SERVICING_STATUS_KEY });
    queryClient.invalidateQueries({ queryKey: SERVICING_HISTORY_KEY });
    queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
  };

  const logService = useMutation({
    mutationFn: async (data: {
      vehicleId: number;
      serviceDate: string;
      odometerAtService: number;
      notes?: string;
      cost?: string;
    }) => {
      const res = await fetch(`${API_BASE}/servicing/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to log service");
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Service logged successfully" });
    },
    onError: () => toast({ title: "Error logging service", variant: "destructive" }),
  });

  const sendForServicing = useMutation({
    mutationFn: async (vehicleId: number) => {
      const res = await fetch(`${API_BASE}/servicing/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ vehicleId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to send vehicle for servicing");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Vehicle sent for servicing" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const cancelServicing = useMutation({
    mutationFn: async (vehicleId: number) => {
      const res = await fetch(`${API_BASE}/servicing/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ vehicleId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to cancel servicing");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Servicing flag cleared" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteService = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API_BASE}/servicing/history/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete service record");
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Service record deleted" });
    },
    onError: () => toast({ title: "Error deleting record", variant: "destructive" }),
  });

  return {
    logService: logService.mutateAsync,
    isLogging: logService.isPending,
    deleteService: deleteService.mutateAsync,
    isDeleting: deleteService.isPending,
    sendForServicing: sendForServicing.mutateAsync,
    isSending: sendForServicing.isPending,
    cancelServicing: cancelServicing.mutateAsync,
    isCancelling: cancelServicing.isPending,
  };
}
