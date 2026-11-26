import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { toPublicUser, type AuthenticatedRequest } from '../auth/auth.types.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { PlanInstance } from '../auth/schemas/plan-instance.schema.js';
import type { PlanInstanceDocument } from '../auth/schemas/plan-instance.schema.js';
import { PlanInstanceStatus } from '../auth/plan-instance-status.enum.js';
import { User } from '../auth/schemas/user.schema.js';
import type { UserDocument } from '../auth/schemas/user.schema.js';
import { UserRole } from '../auth/user-role.enum.js';
import { ReviewPlanInstanceDto } from './dto/review-plan-instance.dto.js';
import { parsePagination, paginationMeta } from '../common/pagination.js';
import { AuditLog } from '../auth/schemas/audit-log.schema.js';
import type { AuditLogDocument } from '../auth/schemas/audit-log.schema.js';
import { toPublicPlanInstance } from '../common/public-plan-instance.js';

function parseStatuses(status?: string) {
  if (!status?.trim()) {
    return undefined;
  }

  const statuses = status
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!statuses.length || statuses.some((value) => !Object.values(PlanInstanceStatus).includes(value as PlanInstanceStatus))) {
    throw new BadRequestException('Unsupported form instance status');
  }

  return statuses as PlanInstanceStatus[];
}

function normalizeSearch(value?: string) {
  const normalized = value?.trim();
  if (normalized && normalized.length > 100) {
    throw new BadRequestException('Search must be 100 characters or fewer');
  }
  return normalized;
}

function parseRecentLimit(value?: string) {
  if (!value?.trim()) {
    return 5;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new BadRequestException('Recent review limit must be an integer between 1 and 20');
  }
  return parsed;
}

@Controller('nutritionist')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Nutritionist, UserRole.Admin)
export class NutritionistController {
  private readonly logger = new Logger(NutritionistController.name);

  constructor(
    @InjectModel(PlanInstance.name)
    private readonly planInstanceModel: Model<PlanInstanceDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  private async findRecentReviews(request: AuthenticatedRequest, limit: number) {
    const ownerFilter = request.user.role === UserRole.Nutritionist
      ? { nutritionistId: request.user.sub }
      : {};
    const instances = await this.planInstanceModel.find({
      ...ownerFilter,
      status: PlanInstanceStatus.Reviewed,
      reviewedAt: { $ne: null },
    })
      .select('templateId templateName userId userNameSnapshot userEmailSnapshot status reviewedAt')
      .sort({ reviewedAt: -1, _id: -1 })
      .limit(limit)
      .lean()
      .exec();

    const userIds = [...new Set(instances.map((instance) => instance.userId))];
    const users = userIds.length
      ? await this.userModel
        .find({ _id: { $in: userIds }, role: UserRole.User })
        .select('name email')
        .lean()
        .exec()
      : [];
    const userById = new Map(users.map((user) => [user._id.toString(), user]));

    return instances.map((instance) => {
      const user = userById.get(instance.userId);
      const snapshotAvailable = Boolean(instance.userNameSnapshot || instance.userEmailSnapshot);
      return {
        id: instance._id.toString(),
        plan: { id: instance.templateId, name: instance.templateName },
        user: user
          ? { id: instance.userId, name: user.name, email: user.email, archived: false }
          : snapshotAvailable
            ? {
              id: instance.userId,
              name: instance.userNameSnapshot ?? 'Archived user',
              email: instance.userEmailSnapshot ?? 'Email unavailable',
              archived: true,
            }
            : null,
        status: instance.status,
        reviewedAt: instance.reviewedAt,
      };
    });
  }

  @Get('overview')
  async getOverview(@Req() request: AuthenticatedRequest) {
    try {
      const ownerFilter = request.user.role === UserRole.Nutritionist
        ? { nutritionistId: request.user.sub }
        : {};
      const activeStatuses = [
        PlanInstanceStatus.Assigned,
        PlanInstanceStatus.InProgress,
        PlanInstanceStatus.Submitted,
        PlanInstanceStatus.UnderReview,
      ];
      const [peopleInCare, reviewsDue, plansActive] = await Promise.all([
        this.userModel.countDocuments({ ...ownerFilter, role: UserRole.User }).exec(),
        this.planInstanceModel.countDocuments({
          ...ownerFilter,
          status: { $in: [PlanInstanceStatus.Submitted, PlanInstanceStatus.UnderReview] },
        }).exec(),
        this.planInstanceModel.countDocuments({
          ...ownerFilter,
          status: { $in: activeStatuses },
        }).exec(),
      ]);

      this.logger.log(JSON.stringify({
        event: 'nutritionist.overview.accessed',
        nutritionistId: request.user.sub,
        peopleInCare,
        reviewsDue,
        plansActive,
      }));

      return {
        message: 'Nutritionist access verified',
        user: toPublicUser(request.user),
        metrics: { peopleInCare, reviewsDue, plansActive },
      };
    } catch (error) {
      this.logger.error(JSON.stringify({
        event: 'nutritionist.overview.failed',
        nutritionistId: request.user.sub,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Get('reviews/recent')
  async getRecentReviews(
    @Req() request: AuthenticatedRequest,
    @Query('limit') limitValue?: string,
  ) {
    try {
      const limit = parseRecentLimit(limitValue);
      const reviews = await this.findRecentReviews(request, limit);

      this.logger.log(JSON.stringify({
        event: 'nutritionist.reviews.recent_listed',
        nutritionistId: request.user.sub,
        resultCount: reviews.length,
        limit,
      }));

      return { reviews };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(JSON.stringify({
        event: 'nutritionist.reviews.recent_failed',
        nutritionistId: request.user.sub,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Get('people')
  async getPeople(
    @Req() request: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string,
  ) {
    try {
      const { page, limit, skip } = parsePagination(pageValue, limitValue);
      const normalizedSearch = normalizeSearch(search);
      const filter: Record<string, unknown> = {
        role: UserRole.User,
        ...(request.user.role === UserRole.Nutritionist ? { nutritionistId: request.user.sub } : {}),
      };
      if (normalizedSearch) {
        const escaped = normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
          { name: { $regex: escaped, $options: 'i' } },
          { email: { $regex: escaped, $options: 'i' } },
        ];
      }
      const [users, total] = await Promise.all([
        this.userModel.find(filter).select('name email createdAt').sort({ name: 1 }).skip(skip).limit(limit).lean().exec(),
        this.userModel.countDocuments(filter).exec(),
      ]);

      return {
        people: users.map((user) => ({
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          createdAt: user.createdAt,
        })),
        meta: paginationMeta(page, limit, total),
      };
    } catch (error) {
      this.logger.error(JSON.stringify({
        event: 'nutritionist.people.list_failed',
        nutritionistId: request.user.sub,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Get('programmes')
  async getProgrammes(@Req() request: AuthenticatedRequest) {
    try {
      const match: Record<string, unknown> = {
        status: { $in: [
          PlanInstanceStatus.Assigned,
          PlanInstanceStatus.InProgress,
          PlanInstanceStatus.Submitted,
          PlanInstanceStatus.UnderReview,
        ] },
      };
      if (request.user.role === UserRole.Nutritionist) {
        match.nutritionistId = request.user.sub;
      }
      const programmes = await this.planInstanceModel.aggregate<{
        _id: string;
        name: string;
        people: number;
        latestDueAt?: Date;
      }>([
        { $match: match },
        { $group: {
          _id: '$templateId',
          name: { $first: '$templateName' },
          userIds: { $addToSet: '$userId' },
          latestDueAt: { $max: '$dueAt' },
        } },
        { $project: { _id: 1, name: 1, people: { $size: '$userIds' }, latestDueAt: 1 } },
        { $sort: { name: 1 } },
      ]).exec();

      return {
        programmes: programmes.map((programme) => ({
          id: programme._id,
          name: programme.name,
          people: programme.people,
          latestDueAt: programme.latestDueAt ?? null,
        })),
      };
    } catch (error) {
      this.logger.error(JSON.stringify({
        event: 'nutritionist.programmes.list_failed',
        nutritionistId: request.user.sub,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Get('instances')
  async getInstances(
    @Req() request: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string,
  ) {
    try {
      const statuses = parseStatuses(status) ?? [PlanInstanceStatus.Submitted, PlanInstanceStatus.UnderReview];
      const { page, limit, skip } = parsePagination(pageValue, limitValue);

      const filter: Record<string, unknown> = {
        ...(request.user.role === UserRole.Nutritionist
          ? { nutritionistId: request.user.sub }
          : {}),
        status: { $in: statuses },
      };
      const sort: Record<string, 1 | -1> = statuses.length === 1 && statuses[0] === PlanInstanceStatus.Reviewed
        ? { reviewedAt: -1, assignedAt: -1 }
        : { dueAt: 1, assignedAt: -1 };
      const [instances, total] = await Promise.all([
        this.planInstanceModel.find(filter)
        .select('templateId userId nutritionistId userNameSnapshot userEmailSnapshot templateName planValidityDays formFillingDays planValidUntil status assignedAt dueAt nutritionistNotes reviewedAt createdAt updatedAt')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
        this.planInstanceModel.countDocuments(filter).exec(),
      ]);
      const userIds = [...new Set(instances.map((instance) => instance.userId))];
      const users = userIds.length
        ? await this.userModel.find({ _id: { $in: userIds }, role: UserRole.User }).select('name email').lean().exec()
        : [];
      const userById = new Map(users.map((user) => [user._id.toString(), user]));

      this.logger.log(JSON.stringify({
        event: 'nutritionist.plan_instances.listed',
        nutritionistId: request.user.sub,
        status: statuses.join(','),
        resultCount: instances.length,
      }));

      return {
        instances: instances.map((instance) => ({
          ...toPublicPlanInstance(instance as unknown as Parameters<typeof toPublicPlanInstance>[0]),
          user: userById.get(instance.userId)
            ? { id: instance.userId, name: userById.get(instance.userId)?.name, email: userById.get(instance.userId)?.email, archived: false }
            : instance.userNameSnapshot || instance.userEmailSnapshot
              ? {
                id: instance.userId,
                name: instance.userNameSnapshot ?? 'Archived user',
                email: instance.userEmailSnapshot ?? 'Email unavailable',
                archived: true,
              }
              : null,
        })),
        meta: paginationMeta(page, limit, total),
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(JSON.stringify({
        event: 'nutritionist.plan_instances.list_failed',
        nutritionistId: request.user.sub,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Get('instances/:instanceId')
  async getInstance(
    @Param('instanceId') instanceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      if (!Types.ObjectId.isValid(instanceId)) {
        throw new BadRequestException('Invalid form instance id');
      }

      const filter: Record<string, unknown> = {
        _id: instanceId,
        status: {
          $in: [PlanInstanceStatus.Submitted, PlanInstanceStatus.UnderReview, PlanInstanceStatus.Reviewed],
        },
        ...(request.user.role === UserRole.Nutritionist
          ? { nutritionistId: request.user.sub }
          : {}),
      };
      const instance = await this.planInstanceModel.findOne(filter).lean().exec();
      if (!instance) {
        throw new NotFoundException('Form instance not found');
      }
      const user = await this.userModel
        .findOne({ _id: instance.userId, role: UserRole.User })
        .select('name email')
        .lean()
        .exec();

      return {
        instance: {
          ...toPublicPlanInstance(instance as unknown as Parameters<typeof toPublicPlanInstance>[0]),
          user: user
            ? { id: user._id.toString(), name: user.name, email: user.email, archived: false }
            : instance.userNameSnapshot || instance.userEmailSnapshot
              ? {
                id: instance.userId,
                name: instance.userNameSnapshot ?? 'Archived user',
                email: instance.userEmailSnapshot ?? 'Email unavailable',
                archived: true,
              }
              : null,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(JSON.stringify({
        event: 'nutritionist.plan_instance.read_failed',
        nutritionistId: request.user.sub,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Patch('instances/:instanceId/review')
  async reviewInstance(
    @Param('instanceId') instanceId: string,
    @Body() reviewDto: ReviewPlanInstanceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      if (!Types.ObjectId.isValid(instanceId)) {
        throw new BadRequestException('Invalid form instance id');
      }
      if (
        reviewDto.status !== PlanInstanceStatus.UnderReview &&
        reviewDto.status !== PlanInstanceStatus.Reviewed
      ) {
        throw new BadRequestException('Nutritionists can move a form to review or reviewed');
      }

      const filter: Record<string, unknown> = {
        _id: instanceId,
        status: {
          $in: [PlanInstanceStatus.Submitted, PlanInstanceStatus.UnderReview, PlanInstanceStatus.Reviewed],
        },
        ...(request.user.role === UserRole.Nutritionist
          ? { nutritionistId: request.user.sub }
          : {}),
      };
      const update: Record<string, unknown> = {
        status: reviewDto.status,
        reviewedBy: request.user.sub,
        reviewedAt: reviewDto.status === PlanInstanceStatus.Reviewed ? new Date() : null,
      };
      if (reviewDto.notes !== undefined) {
        update.nutritionistNotes = reviewDto.notes.trim() || undefined;
      }

      const session = await this.connection.startSession();
      let instance: PlanInstanceDocument | null = null;
      try {
        await session.withTransaction(async () => {
          instance = await this.planInstanceModel
            .findOneAndUpdate(filter, { $set: update }, { new: true })
            .session(session)
            .exec();
          if (!instance) {
            throw new NotFoundException('Form instance not found');
          }

          await this.auditLogModel.create([{
            actorId: request.user.sub,
            actorRole: request.user.role,
            action: 'plan_instance.reviewed',
            targetType: 'plan_instance',
            targetId: instanceId,
            metadata: { status: reviewDto.status },
          }], { session });
        });
      } finally {
        await session.endSession();
      }
      if (!instance) {
        throw new NotFoundException('Form instance not found');
      }
      const reviewedInstance = instance as PlanInstanceDocument;

      this.logger.log(JSON.stringify({
        event: 'nutritionist.plan_instance.reviewed',
        nutritionistId: request.user.sub,
        instanceId,
        status: reviewDto.status,
      }));

      return { instance: toPublicPlanInstance(reviewedInstance.toObject() as unknown as Parameters<typeof toPublicPlanInstance>[0]) };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(JSON.stringify({
        event: 'nutritionist.plan_instance.review_failed',
        nutritionistId: request.user.sub,
        instanceId,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }
}
