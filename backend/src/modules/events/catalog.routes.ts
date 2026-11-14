import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/async-handler';
import { ok } from '../../utils/response';
import {
  publicEventParamsSchema,
  publicEventsQuerySchema,
} from './catalog.schemas';
import { catalogService } from './catalog.service';

export const publicEventsRouter = Router();

publicEventsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = publicEventsQuerySchema.parse(req.query);
    const result = await catalogService.list(query);
    ok(res, result);
  }),
);

publicEventsRouter.get(
  '/:slug',
  validate({ params: publicEventParamsSchema }),
  asyncHandler(async (req, res) => {
    const { slug } = req.params as { slug: string };
    const event = await catalogService.getBySlug(slug);
    ok(res, event);
  }),
);
