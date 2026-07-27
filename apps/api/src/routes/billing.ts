import { Router, Response } from 'express';
import { z } from 'zod';
import { billingService } from '../services/billing.service';
import { authenticateSession, requireRole, AuthenticatedRequest } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

export const billingRoutes = Router();

const checkoutSchema = z.object({
  planTier: z.enum(['pro', 'enterprise']),
  returnUrl: z.string().url().optional(),
});

const upgradeSchema = z.object({
  planTier: z.enum(['free', 'pro', 'enterprise']),
});

// Stripe Webhooks (Unauthenticated server-to-server callback)
billingRoutes.post('/webhook', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const event = req.body;
    if (event?.type === 'checkout.session.completed') {
      const session = event.data.object;
      const organizationId = session.metadata?.organizationId;
      const planTier = session.metadata?.planTier;

      if (organizationId && planTier) {
        await billingService.upgradePlanDirectly(
          organizationId,
          planTier,
          session.customer,
          session.subscription
        );
        logger.info(`[BillingWebhook] Upgraded org ${organizationId} to ${planTier}`);
      }
    }

    return res.json({ received: true });
  } catch (err: any) {
    logger.error('[BillingWebhook] Processing error:', { error: err.message });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Authenticated User Subscription Routes
billingRoutes.get('/subscription', authenticateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const details = await billingService.getUsage(req.organizationId!);
    return res.json(details);
  } catch (err: any) {
    logger.error('[BillingRoute] Get subscription error:', { error: err.message });
    return res.status(500).json({ error: 'Failed to retrieve subscription details' });
  }
});

billingRoutes.post('/checkout', authenticateSession, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = checkoutSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
    }

    const { planTier, returnUrl } = parseResult.data;
    const sessionUrl = await billingService.createCheckoutSession(req.organizationId!, planTier, returnUrl);

    return res.json(sessionUrl);
  } catch (err: any) {
    logger.error('[BillingRoute] Checkout creation error:', { error: err.message });
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

billingRoutes.post('/upgrade', authenticateSession, requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = upgradeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
    }

    const { planTier } = parseResult.data;
    const updatedSub = await billingService.upgradePlanDirectly(req.organizationId!, planTier);

    return res.json({
      message: `Successfully updated subscription to ${planTier.toUpperCase()}`,
      subscription: updatedSub,
    });
  } catch (err: any) {
    logger.error('[BillingRoute] Plan upgrade error:', { error: err.message });
    return res.status(500).json({ error: 'Failed to upgrade plan' });
  }
});
