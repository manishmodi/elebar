import { useState } from "react";
import { useAssignments, useAssignmentMutations } from "@/hooks/use-assignments";
import { useRiders } from "@/hooks/use-riders";
import { useVehicles } from "@/hooks/use-vehicles";
import { PageHeader, Card, StatusBadge, Button, EmptyState, Dialog, DropdownMenu, ConfirmDialog } from "@/components/ui-components";
import { CalendarDays, Plus, MoreVertical, Pencil, XCircle, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { adToBSString } from "@/lib/nepali-date";

interface AssignmentRecord {
  id: number;
  riderId: number;
  vehicleId: number;
  riderName?: string | null;
  vehiclePlate?: string | null;
  startDate: string;
  endDate?: string | null;
  shiftType: string;
  status: string;
}

interface AssignmentFormData {
  riderId: string;
  vehicleId: string;
  startDate: string;
  shiftType: string;
}

interface AssignmentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, string | number>) => Promise<void>;
  isPending: boolean;
  title?: string;
  defaultValues?: Partial<AssignmentFormData>;
}

export default function Assignments() {
  const { data: assignments, isLoading } = useAssignments();
  const { createAssignment, updateAssignment, deleteAssignment, isCreating, isUpdating, isDeleting } = useAssignmentMutations();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<AssignmentRecord | null>(null);
  const [deletingAssignment, setDeletingAssignment] = useState<AssignmentRecord | null>(null);

  const handleEndAssignment = async (assignment: AssignmentRecord) => {
    await updateAssignment({
      id: assignment.id,
      data: {
        riderId: assignment.riderId,
        vehicleId: assignment.vehicleId,
        startDate: assignment.startDate.split('T')[0],
        shiftType: assignment.shiftType,
        status: 'ended',
        endDate: new Date().toISOString().split('T')[0],
      }
    });
  };

  return (
    <div>
      <PageHeader 
        title="Vehicle Assignments" 
        description="Assign riders to vehicles and track shift histories."
        actions={
          <Button onClick={() => setIsAddOpen(true)}>
            <Plus className="w-4 h-4" /> New Assignment
          </Button>
        }
      />

      <Card className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
            <tr>
              <th className="px-6 py-4 font-medium">Rider Name</th>
              <th className="px-6 py-4 font-medium">Vehicle Plate</th>
              <th className="px-6 py-4 font-medium">Start Date</th>
              <th className="px-6 py-4 font-medium">Shift</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Loading assignments...</td></tr>
            ) : assignments?.length === 0 ? (
              <tr><td colSpan={6}><EmptyState title="No assignments" description="Create an assignment to link riders and vehicles." icon={CalendarDays} /></td></tr>
            ) : (
              assignments?.map(a => (
                <tr key={a.id} className="border-b last:border-0 table-row-hover">
                  <td className="px-6 py-4 font-medium text-foreground">{a.riderName || `Rider #${a.riderId}`}</td>
                  <td className="px-6 py-4 font-mono">{a.vehiclePlate || `Vehicle #${a.vehicleId}`}</td>
                  <td className="px-6 py-4">
                    <div>{a.startDate.split('T')[0]}</div>
                    <div className="text-xs text-muted-foreground">{adToBSString(a.startDate) || ''}</div>
                  </td>
                  <td className="px-6 py-4 capitalize">{a.shiftType}</td>
                  <td className="px-6 py-4"><StatusBadge status={a.status} /></td>
                  <td className="px-6 py-4 text-right">
                    <DropdownMenu
                      trigger={<button className="p-2 hover:bg-muted rounded-md text-muted-foreground transition-colors"><MoreVertical className="w-4 h-4" /></button>}
                      items={[
                        { label: "Edit", icon: <Pencil className="w-4 h-4" />, onClick: () => setEditingAssignment(a as AssignmentRecord) },
                        ...(a.status === 'active' ? [{ label: "End Assignment", icon: <XCircle className="w-4 h-4" />, onClick: () => handleEndAssignment(a as AssignmentRecord) }] : []),
                        { label: "Delete", icon: <Trash2 className="w-4 h-4" />, onClick: () => setDeletingAssignment(a as AssignmentRecord), variant: "destructive" as const },
                      ]}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <AssignmentFormModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} onSubmit={async (data) => {
        await createAssignment({ data });
        setIsAddOpen(false);
      }} isPending={isCreating} />

      {editingAssignment && (
        <AssignmentFormModal
          isOpen={true}
          title="Edit Assignment"
          onClose={() => setEditingAssignment(null)}
          defaultValues={{
            riderId: editingAssignment.riderId?.toString() || "",
            vehicleId: editingAssignment.vehicleId?.toString() || "",
            startDate: editingAssignment.startDate?.split('T')[0] || "",
            shiftType: editingAssignment.shiftType || "day",
          }}
          onSubmit={async (data) => {
            await updateAssignment({ id: editingAssignment.id, data: { ...data, status: editingAssignment.status } });
            setEditingAssignment(null);
          }}
          isPending={isUpdating}
        />
      )}

      <ConfirmDialog
        isOpen={!!deletingAssignment}
        onClose={() => setDeletingAssignment(null)}
        title="Delete Assignment"
        description={`Are you sure you want to delete the assignment for ${deletingAssignment?.riderName || 'this rider'}? This action cannot be undone.`}
        onConfirm={async () => {
          if (deletingAssignment) {
            await deleteAssignment({ id: deletingAssignment.id });
            setDeletingAssignment(null);
          }
        }}
        isPending={isDeleting}
      />
    </div>
  );
}

function AssignmentFormModal({ isOpen, onClose, onSubmit, isPending, title = "New Assignment", defaultValues }: AssignmentFormModalProps) {
  const { register, handleSubmit, reset } = useForm<AssignmentFormData>({ defaultValues });
  const { data: riders } = useRiders();
  const { data: vehicles } = useVehicles();
  const isEdit = !!defaultValues;
  const currentRiderId = defaultValues?.riderId;
  const currentVehicleId = defaultValues?.vehicleId;
  
  const submit = (data: AssignmentFormData) => {
    onSubmit({ 
      riderId: parseInt(data.riderId),
      vehicleId: parseInt(data.vehicleId),
      startDate: data.startDate,
      shiftType: data.shiftType,
      status: 'active'
    });
    reset();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit(submit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Rider *</label>
            <select {...register("riderId", {required:true})} className="premium-input bg-white">
              <option value="">Select Rider</option>
              {riders?.filter(r => r.status === 'active' || (isEdit && String(r.id) === currentRiderId)).map(r => (
                <option key={r.id} value={r.id}>{r.fullName}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Vehicle *</label>
            <select {...register("vehicleId", {required:true})} className="premium-input bg-white">
              <option value="">Select Vehicle</option>
              {vehicles?.filter(v => v.status === 'active' || (isEdit && String(v.id) === currentVehicleId)).map(v => (
                <option key={v.id} value={v.id}>{v.plateNumber} ({v.vehicleNumber})</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Start Date *</label>
            <input type="date" {...register("startDate", {required:true})} className="premium-input" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Shift Type *</label>
            <select {...register("shiftType", {required:true})} className="premium-input bg-white">
              <option value="day">Day</option>
              <option value="night">Night</option>
              <option value="morning">Morning</option>
              <option value="evening">Evening</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isPending}>{isPending ? "Saving..." : defaultValues ? "Update Assignment" : "Create Assignment"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
