import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/async-handler';
import { ok } from '../../utils/response';
import {
  assignStaffSchema,
  createCategorySchema,
  createEventSchema,
  eventCategoryParamsSchema,
  eventIdParamsSchema,
  eventStaffParamsSchema,
  updateCategorySchema,
  updateEventSchema,
} from './events.schemas';
import { eventsService } from './events.service';

export const eventsManagementRouter = Router();

eventsManagementRouter.use(authenticate);

eventsManagementRouter.get(
  '/',
  authorize('event.create'),
  asyncHandler(async (req, res) => {
    const events = await eventsService.list(req.user!);
    ok(res, events);
  }),
);

eventsManagementRouter.post(
  '/',
  authorize('event.create'),
  validate({ body: createEventSchema }),
  asyncHandler(async (req, res) => {
    const event = await eventsService.create(req.user!, req.body);
    ok(res, event, 'Event berhasil dibuat', 201);
  }),
);

eventsManagementRouter.get(
  '/:eventId/categories',
  authorize('ticket_category.manage'),
  validate({ params: eventIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { eventId } = req.params as { eventId: string };
    const categories = await eventsService.listCategories(req.user!, eventId);
    ok(res, categories);
  }),
);

eventsManagementRouter.post(
  '/:eventId/categories',
  authorize('ticket_category.manage'),
  validate({ params: eventIdParamsSchema, body: createCategorySchema }),
  asyncHandler(async (req, res) => {
    const { eventId } = req.params as { eventId: string };
    const category = await eventsService.createCategory(
      req.user!,
      eventId,
      req.body,
    );
    ok(res, category, 'Kategori tiket berhasil dibuat', 201);
  }),
);

eventsManagementRouter.patch(
  '/:eventId/categories/:categoryId',
  authorize('ticket_category.manage'),
  validate({ params: eventCategoryParamsSchema, body: updateCategorySchema }),
  asyncHandler(async (req, res) => {
    const { eventId, categoryId } = req.params as {
      eventId: string;
      categoryId: string;
    };
    const category = await eventsService.updateCategory(
      req.user!,
      eventId,
      categoryId,
      req.body,
    );
    ok(res, category, 'Kategori tiket berhasil diperbarui');
  }),
);

eventsManagementRouter.delete(
  '/:eventId/categories/:categoryId',
  authorize('ticket_category.manage'),
  validate({ params: eventCategoryParamsSchema }),
  asyncHandler(async (req, res) => {
    const { eventId, categoryId } = req.params as {
      eventId: string;
      categoryId: string;
    };
    await eventsService.deactivateCategory(req.user!, eventId, categoryId);
    ok(res, null, 'Kategori tiket dinonaktifkan');
  }),
);

eventsManagementRouter.post(
  '/:eventId/staff',
  authorize('event.update'),
  validate({ params: eventIdParamsSchema, body: assignStaffSchema }),
  asyncHandler(async (req, res) => {
    const { eventId } = req.params as { eventId: string };
    const assignment = await eventsService.assignGateOfficer(
      req.user!,
      eventId,
      req.body.userId,
    );
    ok(res, assignment, 'Gate officer berhasil ditugaskan', 201);
  }),
);

eventsManagementRouter.delete(
  '/:eventId/staff/:userId',
  authorize('event.update'),
  validate({ params: eventStaffParamsSchema }),
  asyncHandler(async (req, res) => {
    const { eventId, userId } = req.params as {
      eventId: string;
      userId: string;
    };
    await eventsService.unassignGateOfficer(req.user!, eventId, userId);
    ok(res, null, 'Penugasan gate officer dihapus');
  }),
);

eventsManagementRouter.get(
  '/:eventId',
  authorize('event.update'),
  validate({ params: eventIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { eventId } = req.params as { eventId: string };
    const event = await eventsService.get(req.user!, eventId);
    ok(res, event);
  }),
);

eventsManagementRouter.patch(
  '/:eventId',
  authorize('event.update'),
  validate({ params: eventIdParamsSchema, body: updateEventSchema }),
  asyncHandler(async (req, res) => {
    const { eventId } = req.params as { eventId: string };
    const event = await eventsService.update(req.user!, eventId, req.body);
    ok(res, event, 'Event berhasil diperbarui');
  }),
);

eventsManagementRouter.delete(
  '/:eventId',
  authorize('event.delete'),
  validate({ params: eventIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { eventId } = req.params as { eventId: string };
    await eventsService.remove(req.user!, eventId);
    ok(res, null, 'Event berhasil dihapus');
  }),
);
