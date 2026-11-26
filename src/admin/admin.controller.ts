import {
  BadRequestException,
  Controller,
  ConflictException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Body,
  Query,
  Req,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { toPublicUser, type AuthenticatedRequest } from '../auth/auth.types.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Plan } from '../auth/schemas/plan.schema.js';
import type { PlanDocument } from '../auth/schemas/plan.schema.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { CreatePlanDto } from './dto/create-plan.dto.js';
import type { CreatePlanQuestionDto } from './dto/create-plan.dto.js';
import { AppendPlanQuestionsDto } from './dto/append-plan-questions.dto.js';
import { AssignNutritionistDto } from './dto/assign-nutritionist.dto.js';
import { AssignPlanDto } from './dto/assign-plan.dto.js';
import { UpdatePlanInstanceDto } from './dto/update-plan-instance.dto.js';
import { UpdateUserAccessDto } from './dto/update-user-access.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { User } from '../auth/schemas/user.schema.js';
import type { UserDocument } from '../auth/schemas/user.schema.js';
import { UserRole } from '../auth/user-role.enum.js';
import { PlanInstance } from '../auth/schemas/plan-instance.schema.js';
import type { PlanInstanceDocument } from '../auth/schemas/plan-instance.schema.js';
import { PlanInstanceStatus } from '../auth/plan-instance-status.enum.js';
import { AuditLog } from '../auth/schemas/audit-log.schema.js';
import type { AuditLogDocument } from '../auth/schemas/audit-log.schema.js';
import { parsePagination, paginationMeta } from '../common/pagination.js';
import { toPublicPlanInstance } from '../common/public-plan-instance.js';

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSearch(value?: string) {
  const normalized = value?.trim();
  if (normalized && normalized.length > 100) {
    throw new BadRequestException('Search must be 100 characters or fewer');
  }
  return normalized;
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 11000;
}

function normalizePlanQuestion(question: CreatePlanQuestionDto) {
  const label = question.label.trim();
  const options = question.options
    ?.map((option) => option.trim())
    .filter(Boolean);
  const uniqueOptions = options ? [...new Set(options)] : undefined;

  if (!label) {
    throw new BadRequestException('Every form question needs a label');
  }

  if (question.type === 'options' && (!uniqueOptions || uniqueOptions.length < 2)) {
    throw new BadRequestException('Multiple-choice questions need at least two options');
  }

  return {
    id: randomUUID(),
    label,
    type: question.type,
    required: question.required,
    repeatPerDay: question.repeatPerDay,
    helpText: question.helpText?.trim() || undefined,
    unit: question.unit?.trim() || undefined,
    options: uniqueOptions?.length ? uniqueOptions : undefined,
  };
}

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Plan.name)
    private readonly planModel: Model<PlanDocument>,
    @InjectModel(PlanInstance.name)
    private readonly planInstanceModel: Model<PlanInstanceDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  private async recordAudit(
    session: ClientSession | null,
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.auditLogModel.create([{
      actorId,
      actorRole: UserRole.Admin,
      action,
      targetType,
      targetId,
      metadata,
    }], session ? { session } : undefined);
  }

  @Get('overview')
  async getOverview(@Req() request: AuthenticatedRequest) {
    try {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const [activeProgrammes, pendingReviews, thisMonth] = await Promise.all([
        this.planModel.countDocuments({ active: true }).exec(),
        this.planInstanceModel.countDocuments({
          status: { $in: [PlanInstanceStatus.Submitted, PlanInstanceStatus.UnderReview] },
        }).exec(),
        this.planInstanceModel.countDocuments({ assignedAt: { $gte: monthStart } }).exec(),
      ]);

      this.logger.log(JSON.stringify({
        event: 'admin.overview.accessed',
        userId: request.user.sub,
        role: request.user.role,
        activeProgrammes,
        pendingReviews,
        thisMonth,
      }));

      return {
        message: 'Admin access verified',
        user: toPublicUser(request.user),
        metrics: { activeProgrammes, pendingReviews, thisMonth },
      };
    } catch (error) {
      this.logger.error(JSON.stringify({
        event: 'admin.overview.failed',
        userId: request.user.sub,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Get('users')
  async getUsers(
    @Query('role') role?: string,
    @Query('search') search?: string,
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string,
  ) {
    try {
      const normalizedRole = role?.trim().toLowerCase();
      const validRoles = Object.values(UserRole) as string[];

      if (!normalizedRole || !validRoles.includes(normalizedRole)) {
        this.logger.warn(JSON.stringify({
          event: 'admin.users.query_rejected',
          reason: normalizedRole ? 'unsupported_role_filter' : 'missing_role_filter',
        }));
        throw new BadRequestException('A valid user role filter is required');
      }

      const roleFilter = normalizedRole as UserRole;
      const { page, limit, skip } = parsePagination(pageValue, limitValue);
      const normalizedSearch = normalizeSearch(search);
      const querySearch = normalizedSearch ? escapeRegex(normalizedSearch) : undefined;
      const filter = querySearch
        ? {
            role: roleFilter,
            $or: [
              { name: { $regex: querySearch, $options: 'i' } },
              { email: { $regex: querySearch, $options: 'i' } },
            ],
          }
        : { role: roleFilter };

      const [users, total] = await Promise.all([
        this.userModel.find(filter)
        .select('name email role nutritionistId planId dashboardUnlocked createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
        this.userModel.countDocuments(filter).exec(),
      ]);

      const nutritionistIds = users
        .map((user) => user.nutritionistId)
        .filter((id): id is string => {
          if (!id) {
            return false;
          }

          return Types.ObjectId.isValid(id);
        });
      const [nutritionists, planInstances] = await Promise.all([
        roleFilter === UserRole.User && nutritionistIds.length > 0
          ? this.userModel
              .find({ _id: { $in: nutritionistIds }, role: UserRole.Nutritionist })
              .select('name email')
              .lean()
              .exec()
          : [],
        roleFilter === UserRole.User && users.length > 0
          ? this.planInstanceModel
              .find({
                userId: { $in: users.map((user) => user._id.toString()) },
                status: { $in: [
                  PlanInstanceStatus.Assigned,
                  PlanInstanceStatus.InProgress,
                  PlanInstanceStatus.Submitted,
                  PlanInstanceStatus.UnderReview,
                  PlanInstanceStatus.Reviewed,
                ] },
              })
              .select('userId templateId templateName planValidityDays formFillingDays assignedAt')
              .sort({ assignedAt: -1 })
              .lean()
              .exec()
          : [],
      ]);

      const nutritionistById = new Map(
        nutritionists.map((nutritionist) => [nutritionist._id.toString(), {
          id: nutritionist._id.toString(),
          name: nutritionist.name,
          email: nutritionist.email,
        }]),
      );
      const planByUserId = new Map<string, (typeof planInstances)[number]>();
      for (const instance of planInstances) {
        if (!planByUserId.has(instance.userId)) {
          planByUserId.set(instance.userId, instance);
        }
      }

      this.logger.log(JSON.stringify({
        event: 'admin.users.listed',
        roleFilter,
        search: normalizedSearch ? '[provided]' : undefined,
        resultCount: users.length,
      }));

      return {
        users: users.map((user) => ({
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          dashboardUnlocked: user.dashboardUnlocked !== false,
          nutritionist: user.nutritionistId
            ? nutritionistById.get(user.nutritionistId) ?? null
            : null,
          plan: planByUserId.has(user._id.toString())
            ? {
                id: planByUserId.get(user._id.toString())?.templateId,
                name: planByUserId.get(user._id.toString())?.templateName,
                description: '',
                validityDays: planByUserId.get(user._id.toString())?.planValidityDays,
                formFillingDays: planByUserId.get(user._id.toString())?.formFillingDays,
                instanceId: planByUserId.get(user._id.toString())?._id.toString(),
              }
            : null,
          createdAt: user.createdAt,
        })),
        meta: paginationMeta(page, limit, total),
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(JSON.stringify({
        event: 'admin.users.list_failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Patch('users/:userId/access')
  async updateUserAccess(
    @Param('userId') userId: string,
    @Body() updateUserAccessDto: UpdateUserAccessDto,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new BadRequestException('Invalid user id');
      }

      const user = await this.userModel
        .findOneAndUpdate(
          { _id: userId, role: UserRole.User },
          {
            $set: { dashboardUnlocked: updateUserAccessDto.dashboardUnlocked },
            $inc: { authVersion: 1 },
          },
          { new: true },
        )
        .select('name email role dashboardUnlocked authVersion')
        .exec();

      if (!user) {
        throw new NotFoundException('Normal user account not found');
      }

      await this.recordAudit(
        null,
        request.user.sub,
        updateUserAccessDto.dashboardUnlocked
          ? 'user.dashboard_unlocked'
          : 'user.dashboard_locked',
        'user',
        userId,
      );

      this.logger.log(JSON.stringify({
        event: updateUserAccessDto.dashboardUnlocked
          ? 'admin.user_dashboard.unlocked'
          : 'admin.user_dashboard.locked',
        userId,
        actorId: request.user.sub,
        authVersion: user.authVersion ?? 0,
      }));

      return {
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          dashboardUnlocked: user.dashboardUnlocked !== false,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(JSON.stringify({
        event: 'admin.user_dashboard.access_update_failed',
        userId,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Get('plans')
  async getPlans(
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string,
  ) {
    try {
      if (includeInactive !== undefined && !['true', 'false'].includes(includeInactive)) {
        throw new BadRequestException('includeInactive must be true or false');
      }

      const normalizedSearch = normalizeSearch(search);
      const querySearch = normalizedSearch ? escapeRegex(normalizedSearch) : undefined;
      const shouldIncludeInactive = includeInactive === 'true';
      const { page, limit, skip } = parsePagination(pageValue, limitValue);
      const filter = querySearch
        ? {
            ...(shouldIncludeInactive ? {} : { active: true }),
            $or: [
              { name: { $regex: querySearch, $options: 'i' } },
              { description: { $regex: querySearch, $options: 'i' } },
            ],
          }
        : shouldIncludeInactive ? {} : { active: true };

      const [plans, total] = await Promise.all([
        this.planModel.find(filter)
        .select('name description durationDays validityDays formFillingDays questions active')
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
        this.planModel.countDocuments(filter).exec(),
      ]);

      this.logger.log(JSON.stringify({
        event: 'admin.plans.listed',
        search: normalizedSearch ? '[provided]' : undefined,
        includeInactive: shouldIncludeInactive,
        resultCount: plans.length,
      }));

      return {
        plans: plans.map((plan) => ({
          id: plan._id.toString(),
          name: plan.name,
          description: plan.description,
          durationDays: plan.durationDays,
          validityDays: plan.validityDays ?? plan.durationDays,
          formFillingDays: plan.formFillingDays ?? plan.durationDays,
          questionCount: plan.questions?.length ?? 0,
          active: plan.active,
        })),
        meta: paginationMeta(page, limit, total),
      };
    } catch (error) {
      this.logger.error(JSON.stringify({
        event: 'admin.plans.list_failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Post('plans')
  async createPlan(@Body() createPlanDto: CreatePlanDto) {
    try {
      const name = createPlanDto.name.trim();
      const description = createPlanDto.description.trim();

      if (!name || !description) {
        throw new BadRequestException('Plan name and description are required');
      }

      const existingPlan = await this.planModel.exists({ name });

      if (existingPlan) {
        this.logger.warn(JSON.stringify({
          event: 'admin.plan_creation.denied',
          reason: 'duplicate_name',
        }));
        throw new ConflictException('A plan with this name already exists');
      }

      const validityDays = createPlanDto.validityDays ?? createPlanDto.durationDays;
      const formFillingDays = createPlanDto.formFillingDays ?? validityDays;
      if (formFillingDays > validityDays) {
        throw new BadRequestException('Form filling duration cannot exceed plan validity');
      }

      const plan = await this.planModel.create({
        name,
        description,
        durationDays: validityDays,
        validityDays,
        formFillingDays,
        questions: createPlanDto.questions.map(normalizePlanQuestion),
        active: true,
      });

      this.logger.log(JSON.stringify({
        event: 'admin.plan_created',
        planId: plan._id.toString(),
      }));

      return {
        plan: {
          id: plan._id.toString(),
          name: plan.name,
          description: plan.description,
          durationDays: plan.durationDays,
          validityDays: plan.validityDays,
          formFillingDays: plan.formFillingDays,
          questions: plan.questions,
          active: plan.active,
        },
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('A plan with this name already exists');
      }

      this.logger.error(JSON.stringify({
        event: 'admin.plan_creation.failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Post('plans/:planId/questions')
  async appendPlanQuestions(
    @Param('planId') planId: string,
    @Body() appendPlanQuestionsDto: AppendPlanQuestionsDto,
  ) {
    try {
      if (!Types.ObjectId.isValid(planId)) {
        throw new BadRequestException('Invalid plan id');
      }

      const questions = appendPlanQuestionsDto.questions.map(normalizePlanQuestion);
      const plan = await this.planModel
        .findOneAndUpdate(
          { _id: planId },
          { $push: { questions: { $each: questions } } },
          { new: true },
        )
        .select('name description durationDays validityDays formFillingDays questions active')
        .lean()
        .exec();

      if (!plan) {
        throw new NotFoundException('Plan not found');
      }

      this.logger.log(JSON.stringify({
        event: 'admin.plan_questions.appended',
        planId,
        questionCount: questions.length,
      }));

      return {
        plan: {
          id: plan._id.toString(),
          name: plan.name,
          description: plan.description,
          durationDays: plan.durationDays,
          validityDays: plan.validityDays ?? plan.durationDays,
          formFillingDays: plan.formFillingDays ?? plan.durationDays,
          questions: plan.questions,
          active: plan.active,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(JSON.stringify({
        event: 'admin.plan_questions.append_failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Get('instances')
  async getPlanInstances(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string,
  ) {
    try {
      const normalizedStatus = status?.trim();
      if (
        normalizedStatus &&
        !Object.values(PlanInstanceStatus).includes(normalizedStatus as PlanInstanceStatus)
      ) {
        throw new BadRequestException('Unsupported form instance status');
      }

      const normalizedSearch = normalizeSearch(search);
      const { page, limit, skip } = parsePagination(pageValue, limitValue);
      const filter: Record<string, unknown> = normalizedStatus
        ? { status: normalizedStatus }
        : {};

      if (normalizedSearch) {
        const querySearch = escapeRegex(normalizedSearch);
        const matchingUsers = await this.userModel
          .find({
            role: UserRole.User,
            $or: [
              { name: { $regex: querySearch, $options: 'i' } },
              { email: { $regex: querySearch, $options: 'i' } },
            ],
          })
          .select('_id')
          .lean()
          .exec();
        const userIds = matchingUsers.map((user) => user._id.toString());
        filter.$or = [
          { templateName: { $regex: querySearch, $options: 'i' } },
          ...(userIds.length ? [{ userId: { $in: userIds } }] : []),
        ];
      }

      const [instances, total] = await Promise.all([
        this.planInstanceModel.find(filter)
        .select('templateId userId nutritionistId templateName planValidityDays formFillingDays planValidUntil questions.id status assignedAt dueAt adminNotes nutritionistNotes reviewedBy reviewedAt createdAt updatedAt')
        .sort({ assignedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
        this.planInstanceModel.countDocuments(filter).exec(),
      ]);
      const userIds = [...new Set(instances.map((instance) => instance.userId))];
      const nutritionistIds = [...new Set(
        instances
          .map((instance) => instance.nutritionistId)
          .filter((id): id is string => Boolean(id)),
      )];
      const [users, nutritionists] = await Promise.all([
        userIds.length
          ? this.userModel.find({ _id: { $in: userIds }, role: UserRole.User }).select('name email').lean().exec()
          : [],
        nutritionistIds.length
          ? this.userModel.find({ _id: { $in: nutritionistIds }, role: UserRole.Nutritionist }).select('name email').lean().exec()
          : [],
      ]);
      const userById = new Map(users.map((user) => [user._id.toString(), user]));
      const nutritionistById = new Map(
        nutritionists.map((nutritionist) => [nutritionist._id.toString(), nutritionist]),
      );

      this.logger.log(JSON.stringify({
        event: 'admin.plan_instances.listed',
        search: normalizedSearch ? '[provided]' : undefined,
        status: normalizedStatus,
        resultCount: instances.length,
      }));

      return {
        instances: instances.map((instance) => ({
          id: instance._id.toString(),
          templateId: instance.templateId,
          templateName: instance.templateName,
          questionCount: instance.questions.length,
          status: instance.status,
          assignedAt: instance.assignedAt,
          dueAt: instance.dueAt,
          planValidityDays: instance.planValidityDays,
          formFillingDays: instance.formFillingDays,
          planValidUntil: instance.planValidUntil,
          adminNotes: instance.adminNotes ?? null,
          nutritionistNotes: instance.nutritionistNotes ?? null,
          reviewedAt: instance.reviewedAt,
          user: userById.get(instance.userId)
            ? {
                id: instance.userId,
                name: userById.get(instance.userId)?.name,
                email: userById.get(instance.userId)?.email,
              }
            : null,
          nutritionist: instance.nutritionistId && nutritionistById.get(instance.nutritionistId)
            ? {
                id: instance.nutritionistId,
                name: nutritionistById.get(instance.nutritionistId)?.name,
                email: nutritionistById.get(instance.nutritionistId)?.email,
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
        event: 'admin.plan_instances.list_failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Get('instances/:instanceId')
  async getPlanInstance(@Param('instanceId') instanceId: string) {
    try {
      if (!Types.ObjectId.isValid(instanceId)) {
        throw new BadRequestException('Invalid form instance id');
      }

      const instance = await this.planInstanceModel.findById(instanceId).lean().exec();
      if (!instance) {
        throw new NotFoundException('Form instance not found');
      }

      const [user, nutritionist] = await Promise.all([
        this.userModel.findOne({ _id: instance.userId, role: UserRole.User }).select('name email').lean().exec(),
        instance.nutritionistId
          ? this.userModel.findOne({ _id: instance.nutritionistId, role: UserRole.Nutritionist }).select('name email').lean().exec()
          : null,
      ]);

      return {
        instance: {
          ...toPublicPlanInstance(instance as unknown as Parameters<typeof toPublicPlanInstance>[0]),
          user: user ? { id: user._id.toString(), name: user.name, email: user.email } : null,
          nutritionist: nutritionist
            ? { id: nutritionist._id.toString(), name: nutritionist.name, email: nutritionist.email }
            : null,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(JSON.stringify({
        event: 'admin.plan_instance.read_failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Post('instances/:instanceId/questions')
  async appendInstanceQuestions(
    @Param('instanceId') instanceId: string,
    @Body() appendPlanQuestionsDto: AppendPlanQuestionsDto,
  ) {
    try {
      if (!Types.ObjectId.isValid(instanceId)) {
        throw new BadRequestException('Invalid form instance id');
      }

      const questions = appendPlanQuestionsDto.questions.map(normalizePlanQuestion);
      const currentInstance = await this.planInstanceModel.findById(instanceId).select('status').lean().exec();
      if (!currentInstance) {
        throw new NotFoundException('Form instance not found');
      }
      const lockedStatuses = [
        PlanInstanceStatus.Submitted,
        PlanInstanceStatus.UnderReview,
        PlanInstanceStatus.Reviewed,
      ];
      if (lockedStatuses.includes(currentInstance.status) && questions.some((question) => question.required)) {
        throw new BadRequestException('Locked form instances can only receive optional questions');
      }
      const instance = await this.planInstanceModel
        .findOneAndUpdate(
          { _id: instanceId },
          { $push: { questions: { $each: questions } } },
          { new: true },
        )
        .lean()
        .exec();

      if (!instance) {
        throw new NotFoundException('Form instance not found');
      }

      this.logger.log(JSON.stringify({
        event: 'admin.plan_instance_questions.appended',
        instanceId,
        questionCount: questions.length,
      }));

      return { instance: toPublicPlanInstance(instance as unknown as Parameters<typeof toPublicPlanInstance>[0]) };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(JSON.stringify({
        event: 'admin.plan_instance_questions.append_failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Patch('instances/:instanceId')
  async updatePlanInstance(
    @Param('instanceId') instanceId: string,
    @Body() updatePlanInstanceDto: UpdatePlanInstanceDto,
  ) {
    try {
      if (!Types.ObjectId.isValid(instanceId)) {
        throw new BadRequestException('Invalid form instance id');
      }

      const currentInstance = await this.planInstanceModel.findById(instanceId).exec();
      if (!currentInstance) {
        throw new NotFoundException('Form instance not found');
      }

      if (updatePlanInstanceDto.nutritionistId) {
        const nutritionist = await this.userModel
          .findOne({ _id: updatePlanInstanceDto.nutritionistId, role: UserRole.Nutritionist })
          .select('_id')
          .lean()
          .exec();
        if (!nutritionist) {
          throw new NotFoundException('Nutritionist account not found');
        }
      }

      const update: Record<string, unknown> = {};
      const planValidityDays = updatePlanInstanceDto.planValidityDays ?? currentInstance.planValidityDays ?? 30;
      const formFillingDays = updatePlanInstanceDto.formFillingDays ?? currentInstance.formFillingDays ?? 30;
      if (formFillingDays > planValidityDays) {
        throw new BadRequestException('Form filling duration cannot exceed plan validity');
      }
      if (updatePlanInstanceDto.planValidityDays !== undefined) {
        update.planValidityDays = planValidityDays;
        update.planValidUntil = new Date(
          currentInstance.assignedAt.getTime() + planValidityDays * 24 * 60 * 60 * 1000,
        );
      }
      if (updatePlanInstanceDto.formFillingDays !== undefined) {
        update.formFillingDays = formFillingDays;
        update.dueAt = new Date(
          currentInstance.assignedAt.getTime() + formFillingDays * 24 * 60 * 60 * 1000,
        );
      }
      if (updatePlanInstanceDto.dueAt) {
        update.dueAt = new Date(updatePlanInstanceDto.dueAt);
      }
      const nextPlanValidUntil = updatePlanInstanceDto.planValidityDays !== undefined
        ? new Date(currentInstance.assignedAt.getTime() + planValidityDays * 24 * 60 * 60 * 1000)
        : currentInstance.planValidUntil;
      const nextDueAt = update.dueAt instanceof Date ? update.dueAt : currentInstance.dueAt;
      if (nextDueAt < currentInstance.assignedAt || nextDueAt > nextPlanValidUntil) {
        throw new BadRequestException('Form filling due date must stay within the plan validity window');
      }
      if (updatePlanInstanceDto.nutritionistId) {
        update.nutritionistId = updatePlanInstanceDto.nutritionistId;
      }
      if (updatePlanInstanceDto.adminNotes !== undefined) {
        update.adminNotes = updatePlanInstanceDto.adminNotes.trim() || undefined;
      }

      const instance = await this.planInstanceModel
        .findOneAndUpdate({ _id: instanceId }, { $set: update }, { new: true })
        .lean()
        .exec();
      if (!instance) {
        throw new NotFoundException('Form instance not found');
      }

      this.logger.log(JSON.stringify({
        event: 'admin.plan_instance.updated',
        instanceId,
        fields: Object.keys(update),
      }));

      return { instance: toPublicPlanInstance(instance as unknown as Parameters<typeof toPublicPlanInstance>[0]) };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(JSON.stringify({
        event: 'admin.plan_instance.update_failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Patch('users/:userId/nutritionist')
  async assignNutritionist(
    @Param('userId') userId: string,
    @Body() assignNutritionistDto: AssignNutritionistDto,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new BadRequestException('Invalid user id');
      }

      const [user, nutritionist] = await Promise.all([
        this.userModel.findOne({ _id: userId, role: UserRole.User }).exec(),
        this.userModel
          .findOne({
            _id: assignNutritionistDto.nutritionistId,
            role: UserRole.Nutritionist,
          })
          .select('name email')
          .lean()
          .exec(),
      ]);

      if (!user) {
        throw new NotFoundException('Normal user account not found');
      }

      if (!nutritionist) {
        throw new NotFoundException('Nutritionist account not found');
      }

      const session = await this.connection.startSession();
      try {
        await session.withTransaction(async () => {
          await this.userModel
            .updateOne(
              { _id: userId, role: UserRole.User },
              { $set: { nutritionistId: assignNutritionistDto.nutritionistId } },
            )
            .session(session)
            .exec();
          await this.planInstanceModel
            .updateMany(
              {
                userId,
                status: {
                  $in: [
                    PlanInstanceStatus.Assigned,
                    PlanInstanceStatus.InProgress,
                    PlanInstanceStatus.Submitted,
                    PlanInstanceStatus.UnderReview,
                  ],
                },
              },
              { $set: { nutritionistId: assignNutritionistDto.nutritionistId } },
            )
            .session(session)
            .exec();
          await this.recordAudit(
            session,
            request.user.sub,
            'user_nutritionist.assigned',
            'user',
            userId,
            { nutritionistId: assignNutritionistDto.nutritionistId },
          );
        });
      } finally {
        await session.endSession();
      }

      this.logger.log(JSON.stringify({
        event: 'admin.user_nutritionist.assigned',
        userId,
        nutritionistId: assignNutritionistDto.nutritionistId,
      }));

      return {
        nutritionist: {
          id: nutritionist._id.toString(),
          name: nutritionist.name,
          email: nutritionist.email,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(JSON.stringify({
        event: 'admin.user_nutritionist.assignment_failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Patch('users/:userId/plan')
  async assignPlan(
    @Param('userId') userId: string,
    @Body() assignPlanDto: AssignPlanDto,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new BadRequestException('Invalid user id');
      }

      const [user, plan] = await Promise.all([
        this.userModel.findOne({ _id: userId, role: UserRole.User }).exec(),
        this.planModel
          .findOne({ _id: assignPlanDto.planId, active: true })
          .select('name description durationDays validityDays formFillingDays questions active')
          .lean()
          .exec(),
      ]);

      if (!user) {
        throw new NotFoundException('Normal user account not found');
      }

      if (!plan) {
        throw new NotFoundException('Active plan not found');
      }

      const planValidityDays = assignPlanDto.planValidityDays ?? plan.validityDays ?? plan.durationDays;
      const formFillingDays = assignPlanDto.formFillingDays ?? plan.formFillingDays ?? plan.durationDays;
      if (formFillingDays > planValidityDays) {
        throw new BadRequestException('Form filling duration cannot exceed plan validity');
      }

      const now = new Date();
      const session = await this.connection.startSession();
      let instance: PlanInstanceDocument | undefined;
      try {
        await session.withTransaction(async () => {
          const createdInstances = await this.planInstanceModel.create([{
            templateId: plan._id.toString(),
            userId: user._id.toString(),
            nutritionistId: user.nutritionistId ?? null,
            userNameSnapshot: user.name,
            userEmailSnapshot: user.email,
            templateName: plan.name,
            planValidityDays,
            formFillingDays,
            questions: plan.questions,
            answers: [],
            status: PlanInstanceStatus.Assigned,
            assignedAt: now,
            dueAt: new Date(now.getTime() + formFillingDays * 24 * 60 * 60 * 1000),
            planValidUntil: new Date(now.getTime() + planValidityDays * 24 * 60 * 60 * 1000),
          }], { session });
          instance = createdInstances[0];

          await this.userModel
            .updateOne(
              { _id: userId, role: UserRole.User },
              { $set: { planId: assignPlanDto.planId } },
            )
            .session(session)
            .exec();
          await this.recordAudit(
            session,
            request.user.sub,
            'user_plan.assigned',
            'user',
            userId,
            { planId: assignPlanDto.planId, instanceId: instance._id.toString() },
          );
        });
      } finally {
        await session.endSession();
      }
      if (!instance) {
        throw new Error('Plan instance transaction completed without creating an instance');
      }

      this.logger.log(JSON.stringify({
        event: 'admin.user_plan.assigned',
        userId,
        planId: assignPlanDto.planId,
        instanceId: instance._id.toString(),
      }));

      return {
        plan: {
          id: plan._id.toString(),
          name: plan.name,
          description: plan.description,
          durationDays: plan.durationDays,
          validityDays: plan.validityDays ?? plan.durationDays,
          formFillingDays: plan.formFillingDays ?? plan.durationDays,
        },
        instance: {
          id: instance._id.toString(),
          templateId: instance.templateId,
          templateName: instance.templateName,
          status: instance.status,
          assignedAt: instance.assignedAt,
          dueAt: instance.dueAt,
          planValidityDays: instance.planValidityDays,
          formFillingDays: instance.formFillingDays,
          planValidUntil: instance.planValidUntil,
          questionCount: instance.questions.length,
        },
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      this.logger.error(JSON.stringify({
        event: 'admin.user_plan.assignment_failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Post('users')
  async createUser(
    @Body() createUserDto: CreateUserDto,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const email = createUserDto.email.trim().toLowerCase();
      const existingUser = await this.userModel.exists({ email });

      if (existingUser) {
        this.logger.warn(JSON.stringify({
          event: 'admin.user_creation.denied',
          reason: 'duplicate_email',
          role: createUserDto.role ?? UserRole.User,
        }));
        throw new ConflictException('A user with this email already exists');
      }

      const passwordHash = await bcrypt.hash(createUserDto.password, 12);
      const name = email
        .split('@')[0]
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
      const user = await this.userModel.create({
        name,
        email,
        passwordHash,
        role: createUserDto.role ?? UserRole.User,
        dashboardUnlocked: true,
      });
      await this.recordAudit(
        null,
        request.user.sub,
        'user.created',
        'user',
        user._id.toString(),
        { role: user.role },
      );

      this.logger.log(JSON.stringify({
        event: 'admin.user_created',
        userId: user._id.toString(),
        role: user.role,
      }));

      return {
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          dashboardUnlocked: user.dashboardUnlocked !== false,
          nutritionist: null,
          plan: null,
          createdAt: user.createdAt,
        },
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('A user with this email already exists');
      }

      this.logger.error(JSON.stringify({
        event: 'admin.user_creation.failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }
}
