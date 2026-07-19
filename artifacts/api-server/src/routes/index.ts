import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import fleetRouter from "./fleet";
import vehiclesRouter from "./vehicles";
import ridersRouter from "./riders";
import assignmentsRouter from "./assignments";
import dailyLogsRouter from "./daily-logs";
import attendanceRouter from "./attendance";
import maintenanceRouter from "./maintenance";
import servicingRouter from "./servicing";
import dashboardRouter from "./dashboard";
import usersRouter from "./users";
import activityLogsRouter from "./activity-logs";
import salaryRouter from "./salary";
import expensesRouter from "./expenses";
import cashCollectionRouter from "./cash-collection";
import yangoRouter from "./yango";
import performanceRouter from "./performance";
import adminSyncRouter from "./admin-sync"; // TEMP MIGRATION — remove after cutover
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);

router.use(storageRouter);
// Service-token auth (Riders Club backend) — must be mounted BEFORE requireAuth,
// which would otherwise 401 every session-less service call.
router.use(fleetRouter);
router.use(requireAuth);
router.use(vehiclesRouter);
router.use(ridersRouter);
router.use(assignmentsRouter);
router.use(dailyLogsRouter);
router.use(attendanceRouter);
router.use(maintenanceRouter);
router.use(servicingRouter);
router.use(dashboardRouter);
router.use(usersRouter);
router.use(activityLogsRouter);
router.use(salaryRouter);
router.use(expensesRouter);
router.use(cashCollectionRouter);
router.use(yangoRouter);
router.use(performanceRouter);
router.use(adminSyncRouter); // TEMP MIGRATION — remove after cutover

export default router;
