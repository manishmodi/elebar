import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql, count, sum } from "drizzle-orm";
import { db, vehiclesTable, ridersTable, dailyLogsTable, attendanceTable, maintenanceTable } from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  GetRiderDashboardParams,
  GetRiderDashboardResponse,
  GetVehicleDashboardParams,
  GetVehicleDashboardResponse,
} from "@workspace/api-zod";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/dashboard/summary", requirePermission("dashboard", "canView"), async (_req, res): Promise<void> => {
  const allVehicles = await db.select().from(vehiclesTable);
  const totalVehicles = allVehicles.length;
  const activeVehicles = allVehicles.filter(v => v.status === "active").length;
  const inactiveVehicles = allVehicles.filter(v => v.status === "inactive").length;
  const maintenanceVehicles = allVehicles.filter(v => v.status === "maintenance").length;

  const allRiders = await db.select().from(ridersTable);
  const totalRiders = allRiders.length;
  const activeRiders = allRiders.filter(r => r.status === "active").length;

  const today = new Date().toISOString().split("T")[0];
  const todayLogs = await db.select().from(dailyLogsTable).where(eq(dailyLogsTable.englishDate, today));
  const totalRidesToday = todayLogs.reduce((acc, l) => acc + (l.ridesCompleted || 0), 0);
  const totalIncomeToday = todayLogs.reduce((acc, l) => acc + parseFloat(l.totalIncome || "0"), 0);

  const currentMonth = today.substring(0, 7);
  const allLogs = await db.select().from(dailyLogsTable);
  const monthLogs = allLogs.filter(l => l.englishDate.startsWith(currentMonth));
  const totalIncomeThisMonth = monthLogs.reduce((acc, l) => acc + parseFloat(l.totalIncome || "0"), 0);

  const avgRidesPerRider = activeRiders > 0 ? (totalRidesToday / activeRiders).toFixed(1) : "0";
  const avgIncomePerVehicle = activeVehicles > 0 ? (totalIncomeThisMonth / activeVehicles).toFixed(2) : "0";

  const result = GetDashboardSummaryResponse.parse({
    totalVehicles,
    activeVehicles,
    inactiveVehicles,
    maintenanceVehicles,
    totalRiders,
    activeRiders,
    totalRidesToday,
    totalIncomeToday: totalIncomeToday.toFixed(2),
    totalIncomeThisMonth: totalIncomeThisMonth.toFixed(2),
    avgRidesPerRider,
    avgIncomePerVehicle,
  });

  res.json(result);
});

router.get("/dashboard/rider/:riderId", requirePermission("dashboard", "canView"), async (req, res): Promise<void> => {
  const params = GetRiderDashboardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [rider] = await db.select().from(ridersTable).where(eq(ridersTable.id, params.data.riderId));
  if (!rider) {
    res.status(404).json({ error: "Rider not found" });
    return;
  }

  const logs = await db.select().from(dailyLogsTable).where(eq(dailyLogsTable.riderId, params.data.riderId));
  const totalRidesCompleted = logs.reduce((acc, l) => acc + (l.ridesCompleted || 0), 0);
  const totalEarnings = logs.reduce((acc, l) => acc + parseFloat(l.totalIncome || "0"), 0);
  const avgAcceptanceRate = logs.length > 0
    ? (logs.reduce((acc, l) => acc + parseFloat(l.acceptanceRate || "0"), 0) / logs.length).toFixed(1)
    : "0";
  const avgRidesPerDay = logs.length > 0 ? (totalRidesCompleted / logs.length).toFixed(1) : "0";

  const attendanceRecords = await db.select().from(attendanceTable).where(eq(attendanceTable.riderId, params.data.riderId));
  const attendanceSummary = {
    present: attendanceRecords.filter(a => a.type === "present").length,
    absent: attendanceRecords.filter(a => a.type === "absent").length,
    leave: attendanceRecords.filter(a => a.type === "leave").length,
    halfDay: attendanceRecords.filter(a => a.type === "half_day").length,
  };

  const result = GetRiderDashboardResponse.parse({
    riderId: rider.id,
    riderName: rider.fullName,
    totalRidesCompleted,
    avgAcceptanceRate,
    avgRidesPerDay,
    totalEarnings: totalEarnings.toFixed(2),
    attendanceSummary,
  });

  res.json(result);
});

router.get("/dashboard/vehicle/:vehicleId", requirePermission("dashboard", "canView"), async (req, res): Promise<void> => {
  const params = GetVehicleDashboardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, params.data.vehicleId));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const logs = await db.select().from(dailyLogsTable).where(eq(dailyLogsTable.vehicleId, params.data.vehicleId));
  const totalEarnings = logs.reduce((acc, l) => acc + parseFloat(l.totalIncome || "0"), 0);
  const totalDistance = logs.reduce((acc, l) => acc + parseFloat(l.totalRideDistanceKm || "0"), 0);
  const totalRides = logs.reduce((acc, l) => acc + (l.ridesCompleted || 0), 0);

  const maintenanceRecords = await db.select().from(maintenanceTable).where(eq(maintenanceTable.vehicleId, params.data.vehicleId));
  const maintenanceCost = maintenanceRecords.reduce((acc, m) => acc + parseFloat(m.cost || "0"), 0);

  const result = GetVehicleDashboardResponse.parse({
    vehicleId: vehicle.id,
    vehiclePlate: vehicle.plateNumber,
    totalEarnings: totalEarnings.toFixed(2),
    totalDistance: totalDistance.toFixed(1),
    maintenanceCost: maintenanceCost.toFixed(2),
    totalRides,
  });

  res.json(result);
});

router.get("/dashboard/fleet-stats", requirePermission("dashboard", "canView"), async (req, res): Promise<void> => {
  const { dateFrom, dateTo } = req.query;
  if (!dateFrom || !dateTo || typeof dateFrom !== "string" || typeof dateTo !== "string") {
    res.status(400).json({ error: "dateFrom and dateTo query params required (YYYY-MM-DD)" });
    return;
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
    res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
    return;
  }
  if (dateFrom > dateTo) {
    res.status(400).json({ error: "dateFrom must not be after dateTo." });
    return;
  }

  const logs = await db.select().from(dailyLogsTable).where(
    and(
      gte(dailyLogsTable.englishDate, dateFrom),
      lte(dailyLogsTable.englishDate, dateTo)
    )
  );

  const totalRides = logs.reduce((acc, l) => acc + (l.ridesCompleted || 0), 0);
  const totalIncome = logs.reduce((acc, l) => acc + parseFloat(l.totalIncome || "0"), 0);
  const totalDistance = logs.reduce((acc, l) => acc + parseFloat(l.totalRideDistanceKm || "0"), 0);

  const fromDate = new Date(dateFrom + "T00:00:00");
  const toDate = new Date(dateTo + "T00:00:00");
  const numberOfDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);

  // Working days = calendar days excluding Saturdays (weekly off)
  const countWorkingDays = (from: Date, to: Date): number => {
    let count = 0;
    const d = new Date(from);
    while (d <= to) {
      if (d.getDay() !== 6) count++;
      d.setDate(d.getDate() + 1);
    }
    return Math.max(1, count);
  };
  const workingDays = countWorkingDays(fromDate, toDate);

  const allVehicles = await db.select().from(vehiclesTable);
  const activeVehicles = allVehicles.filter(v => v.status === "active").length;

  const hasLogs = logs.length > 0;
  // Use distinct vehicles that actually appear in logs for this period as the denominator
  const distinctVehiclesInLogs = new Set(logs.map(l => l.vehicleId)).size;
  const divisor = Math.max(1, distinctVehiclesInLogs) * workingDays;
  const fleetAvgDailyRides = hasLogs ? (totalRides / divisor).toFixed(2) : null;
  const fleetAvgDailyIncome = hasLogs ? (totalIncome / divisor).toFixed(2) : null;
  const fleetAvgDailyDistance = hasLogs ? (totalDistance / divisor).toFixed(1) : null;

  // Previous period: same calendar length, ending the day before current start
  const prevToDate = new Date(fromDate);
  prevToDate.setDate(prevToDate.getDate() - 1);
  const prevFromDate = new Date(prevToDate);
  prevFromDate.setDate(prevFromDate.getDate() - (numberOfDays - 1));
  const prevDateFrom = prevFromDate.toISOString().split("T")[0];
  const prevDateTo = prevToDate.toISOString().split("T")[0];
  const prevWorkingDays = countWorkingDays(prevFromDate, prevToDate);

  const prevLogs = await db.select().from(dailyLogsTable).where(
    and(
      gte(dailyLogsTable.englishDate, prevDateFrom),
      lte(dailyLogsTable.englishDate, prevDateTo)
    )
  );

  // Use distinct vehicles from previous period logs for consistent comparison
  const prevDistinctVehiclesInLogs = new Set(prevLogs.map(l => l.vehicleId)).size;
  const prevDivisor = Math.max(1, prevDistinctVehiclesInLogs) * prevWorkingDays;

  const prevTotalRides = prevLogs.reduce((acc, l) => acc + (l.ridesCompleted || 0), 0);
  const prevTotalIncome = prevLogs.reduce((acc, l) => acc + parseFloat(l.totalIncome || "0"), 0);
  const prevTotalDistance = prevLogs.reduce((acc, l) => acc + parseFloat(l.totalRideDistanceKm || "0"), 0);
  const prevHasLogs = prevLogs.length > 0;

  const pctChange = (current: number, previous: number): number | null => {
    if (!prevHasLogs || previous === 0) return null;
    return parseFloat((((current - previous) / previous) * 100).toFixed(1));
  };

  res.json({
    totalRides,
    totalIncome: totalIncome.toFixed(2),
    numberOfDays,
    workingDays,
    activeVehicles,
    hasLogs,
    fleetAvgDailyRides,
    fleetAvgDailyIncome,
    fleetAvgDailyDistance,
    prev: {
      totalRides: prevTotalRides,
      totalIncome: prevTotalIncome.toFixed(2),
      dateFrom: prevDateFrom,
      dateTo: prevDateTo,
    },
    growth: {
      totalRides: pctChange(totalRides, prevTotalRides),
      totalIncome: pctChange(totalIncome, prevTotalIncome),
      avgDailyRides: pctChange(totalRides / divisor, prevTotalRides / prevDivisor),
      avgDailyIncome: pctChange(totalIncome / divisor, prevTotalIncome / prevDivisor),
      avgDailyDistance: pctChange(totalDistance / divisor, prevTotalDistance / prevDivisor),
    },
  });
});

export default router;
