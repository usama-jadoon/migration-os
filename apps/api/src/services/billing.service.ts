import { prisma } from '../utils/db';
import { logger } from '../utils/logger';

export interface PlanLimits {
  plan: 'free' | 'pro' | 'enterprise';
  maxMailboxes: number; // -1 for unlimited
  maxDataBytes: bigint; // -1 for unlimited
  maxConcurrentJobs: number;
}

export const PLAN_TIERS: Record<string, PlanLimits> = {
  free: {
    plan: 'free',
    maxMailboxes: 5,
    maxDataBytes: BigInt(10737418240), // 10 GB
    maxConcurrentJobs: 1,
  },
  pro: {
    plan: 'pro',
    maxMailboxes: 100,
    maxDataBytes: BigInt(1099511627776), // 1 TB
    maxConcurrentJobs: 5,
  },
  enterprise: {
    plan: 'enterprise',
    maxMailboxes: -1, // Unlimited
    maxDataBytes: BigInt(-1), // Unlimited
    maxConcurrentJobs: 20,
  },
};

function sanitizeSubscription(sub: any) {
  if (!sub) return null;
  return {
    ...sub,
    maxDataBytes: sub.maxDataBytes !== undefined && sub.maxDataBytes !== null ? sub.maxDataBytes.toString() : '0',
  };
}

export class BillingService {
  async getOrCreateSubscription(organizationId: string) {
    let sub = await prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!sub) {
      const freeTier = PLAN_TIERS.free;
      sub = await prisma.subscription.create({
        data: {
          organizationId,
          plan: freeTier.plan,
          status: 'active',
          maxMailboxes: freeTier.maxMailboxes,
          maxDataBytes: freeTier.maxDataBytes,
          maxConcurrentJobs: freeTier.maxConcurrentJobs,
        },
      });
    }

    return sub;
  }

  async getUsage(organizationId: string) {
    const sub = await this.getOrCreateSubscription(organizationId);

    const mailboxCount = await prisma.migration.count({
      where: { organizationId },
    });

    const dataAggregate = await prisma.migration.aggregate({
      where: { organizationId },
      _sum: {
        migratedSizeBytes: true,
      },
    });

    const usedDataBytes = dataAggregate._sum.migratedSizeBytes || BigInt(0);

    const activeJobs = await prisma.migration.count({
      where: { organizationId, status: 'running' },
    });

    return {
      subscription: sanitizeSubscription(sub),
      usage: {
        usedMailboxes: mailboxCount,
        usedDataBytes: usedDataBytes.toString(),
        activeJobs,
      },
      limits: {
        maxMailboxes: sub.maxMailboxes,
        maxDataBytes: sub.maxDataBytes.toString(),
        maxConcurrentJobs: sub.maxConcurrentJobs,
      },
    };
  }

  async checkMigrationLimit(organizationId: string, additionalBytes: bigint = BigInt(0)): Promise<{ allowed: boolean; reason?: string }> {
    const { subscription, usage } = await this.getUsage(organizationId);
    if (!subscription) return { allowed: false, reason: 'Subscription not found' };

    if (subscription.status !== 'active' && subscription.status !== 'trialing') {
      return { allowed: false, reason: `Subscription status is '${subscription.status}'. Please update billing.` };
    }

    if (subscription.maxMailboxes !== -1 && usage.usedMailboxes >= subscription.maxMailboxes) {
      return {
        allowed: false,
        reason: `Mailbox quota reached (${usage.usedMailboxes}/${subscription.maxMailboxes}). Upgrade plan for higher limits.`,
      };
    }

    if (subscription.maxConcurrentJobs !== -1 && usage.activeJobs >= subscription.maxConcurrentJobs) {
      return {
        allowed: false,
        reason: `Concurrent migration job limit reached (${usage.activeJobs}/${subscription.maxConcurrentJobs}). Wait for existing migrations to finish or upgrade plan.`,
      };
    }

    if (BigInt(subscription.maxDataBytes) !== BigInt(-1)) {
      const currentBytes = BigInt(usage.usedDataBytes);
      if (currentBytes + additionalBytes > BigInt(subscription.maxDataBytes)) {
        return {
          allowed: false,
          reason: `Data transfer limit exceeded. Upgrade to Pro or Enterprise for additional capacity.`,
        };
      }
    }

    return { allowed: true };
  }

  async createCheckoutSession(organizationId: string, planTier: 'pro' | 'enterprise', returnUrl?: string) {
    const targetTier = PLAN_TIERS[planTier];
    if (!targetTier) {
      throw new Error(`Invalid plan tier '${planTier}'`);
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (stripeSecretKey) {
      try {
        const Stripe = require('stripe');
        const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `MigrationOS ${planTier.toUpperCase()} Plan`,
                  description: `Up to ${targetTier.maxMailboxes} mailboxes & ${targetTier.maxConcurrentJobs} concurrent migration workers`,
                },
                unit_amount: planTier === 'pro' ? 9900 : 49900,
                recurring: { interval: 'month' },
              },
              quantity: 1,
            },
          ],
          mode: 'subscription',
          success_url: `${returnUrl || 'http://localhost:3000/dashboard'}?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: returnUrl || 'http://localhost:3000/dashboard',
          metadata: { organizationId, planTier },
        });

        return { url: session.url };
      } catch (err: any) {
        logger.error('[BillingService] Stripe Checkout creation error:', { error: err.message });
      }
    }

    // Safe fallback URL if Stripe secret key is not provided in environment
    const mockUrl = `${returnUrl || 'http://localhost:3000/dashboard'}?billing_simulated=true&plan=${planTier}`;
    return { url: mockUrl };
  }

  async upgradePlanDirectly(organizationId: string, planTier: 'free' | 'pro' | 'enterprise', stripeCustomerId?: string, stripeSubscriptionId?: string) {
    const targetTier = PLAN_TIERS[planTier];
    if (!targetTier) {
      throw new Error(`Invalid plan tier '${planTier}'`);
    }

    const sub = await prisma.subscription.upsert({
      where: { organizationId },
      update: {
        plan: targetTier.plan,
        status: 'active',
        maxMailboxes: targetTier.maxMailboxes,
        maxDataBytes: targetTier.maxDataBytes,
        maxConcurrentJobs: targetTier.maxConcurrentJobs,
        stripeCustomerId: stripeCustomerId || undefined,
        stripeSubscriptionId: stripeSubscriptionId || undefined,
        updatedAt: new Date(),
      },
      create: {
        organizationId,
        plan: targetTier.plan,
        status: 'active',
        maxMailboxes: targetTier.maxMailboxes,
        maxDataBytes: targetTier.maxDataBytes,
        maxConcurrentJobs: targetTier.maxConcurrentJobs,
        stripeCustomerId,
        stripeSubscriptionId,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId,
        action: 'upgrade_subscription',
        details: JSON.stringify({ plan: planTier, maxMailboxes: targetTier.maxMailboxes }),
      },
    });

    return sanitizeSubscription(sub);
  }
}

export const billingService = new BillingService();
