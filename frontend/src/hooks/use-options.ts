import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Paginated, RiderListItem, Vehicle } from "@/lib/types";

export function useRiderOptions() {
  return useQuery({
    queryKey: ["options", "riders"],
    queryFn: () => api.get<Paginated<RiderListItem>>("/api/riders/", { page_size: 100 }),
    staleTime: 60_000,
  });
}

export function useVehicleOptions() {
  return useQuery({
    queryKey: ["options", "vehicles"],
    queryFn: () => api.get<Paginated<Vehicle>>("/api/vehicles/", { page_size: 100 }),
    staleTime: 60_000,
  });
}
