import { Router } from "express";
import authRoutes from "./auth.route";
import usersRoutes from "./users.route";
import artistsRoutes from "./artists.route";
import songsRoutes from "./songs.route";
import eventsRoutes from "./events.route";
import ticketCategoriesRoutes from "./ticketCategories.route";
import ordersRoutes from "./orders.route";
import ticketsRoutes from "./tickets.route";
import paymentRoutes from "./payment.route";
import pointsRoutes from "./points.route";
import dashboardRoutes from "./dashboard.route";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/artists", artistsRoutes);
router.use("/songs", songsRoutes);
router.use("/events", eventsRoutes);
router.use("/ticket-categories", ticketCategoriesRoutes);
router.use("/orders", ordersRoutes);
router.use("/tickets", ticketsRoutes);
router.use("/payment", paymentRoutes);
router.use("/points", pointsRoutes);
router.use("/dashboard", dashboardRoutes);

export default router;
