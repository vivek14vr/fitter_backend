import type { Model } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { NutritionistController } from './nutritionist.controller.js';
import { PlanInstanceStatus } from '../auth/plan-instance-status.enum.js';
import { UserRole } from '../auth/user-role.enum.js';
import type { PlanInstanceDocument } from '../auth/schemas/plan-instance.schema.js';
import type { UserDocument } from '../auth/schemas/user.schema.js';
import type { AuditLogDocument } from '../auth/schemas/audit-log.schema.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';

function resolvedQuery<T>(value: T) {
  return {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(value),
  };
}

function countQuery(value: number) {
  return { exec: vi.fn().mockResolvedValue(value) };
}

function nutritionistRequest(): AuthenticatedRequest {
  return {
    user: {
      sub: 'nutritionist-1',
      jti: 'jti-1',
      email: 'nutritionist@example.com',
      name: 'Test Nutritionist',
      role: UserRole.Nutritionist,
      dashboardUnlocked: true,
    },
  } as AuthenticatedRequest;
}

describe('NutritionistController', () => {
  it('lists recent reviews from the backend with nutritionist scope and deterministic ordering', async () => {
    const reviewedAt = new Date('2026-10-22T08:00:00.000Z');
    const instanceQuery = resolvedQuery([{
      _id: { toString: () => 'instance-1' },
      templateId: 'plan-1',
      templateName: 'Daily food log',
      userId: 'user-1',
      userNameSnapshot: 'Archived User',
      userEmailSnapshot: 'archived@example.com',
      status: PlanInstanceStatus.Reviewed,
      reviewedAt,
    }]);
    const userQuery = resolvedQuery([]);
    const findRecent = vi.fn().mockReturnValue(instanceQuery);
    const findUsers = vi.fn().mockReturnValue(userQuery);
    const planInstanceModel = {
      find: findRecent,
    } as unknown as Model<PlanInstanceDocument>;
    const userModel = {
      find: findUsers,
    } as unknown as Model<UserDocument>;
    const controller = new NutritionistController(
      planInstanceModel,
      userModel,
      {} as Model<AuditLogDocument>,
      {} as never,
    );

    const result = await controller.getRecentReviews(nutritionistRequest(), '7');

    expect(findRecent).toHaveBeenCalledWith({
      nutritionistId: 'nutritionist-1',
      status: PlanInstanceStatus.Reviewed,
      reviewedAt: { $ne: null },
    });
    expect(instanceQuery.sort).toHaveBeenCalledWith({ reviewedAt: -1, _id: -1 });
    expect(instanceQuery.limit).toHaveBeenCalledWith(7);
    expect(result.reviews).toEqual([{
      id: 'instance-1',
      plan: { id: 'plan-1', name: 'Daily food log' },
      user: {
        id: 'user-1',
        name: 'Archived User',
        email: 'archived@example.com',
        archived: true,
      },
      status: PlanInstanceStatus.Reviewed,
      reviewedAt,
    }]);
  });

  it('keeps overview metrics independent from recent-review joins', async () => {
    const findUsers = vi.fn();
    const findPlanInstances = vi.fn();
    const userModel = {
      countDocuments: vi.fn().mockReturnValue(countQuery(18)),
      find: findUsers,
    } as unknown as Model<UserDocument>;
    const planInstanceModel = {
      countDocuments: vi.fn().mockReturnValueOnce(countQuery(5)).mockReturnValueOnce(countQuery(12)),
      find: findPlanInstances,
    } as unknown as Model<PlanInstanceDocument>;
    const controller = new NutritionistController(
      planInstanceModel,
      userModel,
      {} as Model<AuditLogDocument>,
      {} as never,
    );

    const result = await controller.getOverview(nutritionistRequest());

    expect(result.metrics).toEqual({ peopleInCare: 18, reviewsDue: 5, plansActive: 12 });
    expect(findPlanInstances).not.toHaveBeenCalled();
    expect(findUsers).not.toHaveBeenCalled();
  });

  it('rejects an invalid recent-review limit before querying', async () => {
    const findPlanInstances = vi.fn();
    const planInstanceModel = { find: findPlanInstances } as unknown as Model<PlanInstanceDocument>;
    const controller = new NutritionistController(
      planInstanceModel,
      {} as Model<UserDocument>,
      {} as Model<AuditLogDocument>,
      {} as never,
    );

    await expect(controller.getRecentReviews(nutritionistRequest(), '21')).rejects.toBeInstanceOf(BadRequestException);
    expect(findPlanInstances).not.toHaveBeenCalled();
  });
});
