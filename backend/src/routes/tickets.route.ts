import { Router } from "express";
import {
  getAll,
  getById,
  create,
  update,
  remove,
  verify,
} from "../controllers/tickets.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";

const router = Router();

router.use(authMiddleware, roleMiddleware(["staff"]));

router.post("/verify", verify);
router.get("/", getAll);
router.get("/:id", getById);
router.post("/", create);
router.put("/:id", update);
router.delete("/:id", remove);

export default router;
