import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Query,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { toPublicUser, type AuthenticatedRequest } from '../auth/auth.types.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { WorkspaceAccessGuard } from '../auth/guards/workspace-access.guard.js';
import { PlanInstance } from '../auth/schemas/plan-instance.schema.js';
import type { PlanInstanceDocument } from '../auth/schemas/plan-instance.schema.js';
import { PlanQuestionType } from '../auth/plan-question-type.enum.js';
import { PlanInstanceStatus } from '../auth/plan-instance-status.enum.js';
import { UserRole } from '../auth/user-role.enum.js';
import { UpdatePlanInstanceDto } from './dto/update-plan-instance.dto.js';
import { parsePagination, paginationMeta } from '../common/pagination.js';
import { toPublicPlanInstance } from '../common/public-plan-instance.js';

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dateKeysBetween(start: string, end: string) {
  const keys: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);

  while (cursor <= last) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isBlank(value: unknown) {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

function validateAnswer(question: {
  type: PlanQuestionType;
  options?: string[];
  repeatPerDay?: number;
}, value: unknown, occurrence: number) {
  if (occurrence >= (question.repeatPerDay ?? 1)) {
    throw new BadRequestException('This question does not allow that many daily entries');
  }
  if (isBlank(value)) {
    throw new BadRequestException(`Answer required for "${question.type}" question`);
  }

  switch (question.type) {
    case PlanQuestionType.Text:
      if (typeof value !== 'string') throw new BadRequestException('Text answers must be strings');
      if (value.length > 5000) throw new BadRequestException('Text answers must be 5000 characters or fewer');
      return;
    case PlanQuestionType.Number:
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new BadRequestException('Number answers must be finite numbers');
      }
      return;
    case PlanQuestionType.Scale:
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10) {
        throw new BadRequestException('Scale answers must be whole numbers from 1 to 10');
      }
      return;
    case PlanQuestionType.Options:
      if (typeof value !== 'string' || !question.options?.includes(value)) {
        throw new BadRequestException('Choose one of the available options');
      }
      return;
    case PlanQuestionType.YesNo:
      if (value !== 'yes' && value !== 'no') {
        throw new BadRequestException('Yes / No answers must be yes or no');
      }
      return;
    case PlanQuestionType.Date:
      if (typeof value !== 'string' || !isDateKey(value)) {
        throw new BadRequestException('Date answers must use YYYY-MM-DD');
      }
      return;
    default:
      throw new BadRequestException('Unsupported form question type');
  }
}

@Controller('user')
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceAccessGuard)
@Roles(UserRole.User, UserRole.Admin)
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    @InjectModel(PlanInstance.name)
    private readonly planInstanceModel: Model<PlanInstanceDocument>,
  ) {}

  @Get('overview')
  async getOverview(@Req() request: AuthenticatedRequest) {
    try {
      const instances = await this.planInstanceModel
        .find({ userId: request.user.sub })
        .select('templateName status assignedAt dueAt nutritionistNotes answers.entryDate')
        .sort({ assignedAt: -1 })
        .lean()
        .exec();
      const activeStatuses = new Set([
        PlanInstanceStatus.Assigned,
        PlanInstanceStatus.InProgress,
        PlanInstanceStatus.Submitted,
        PlanInstanceStatus.UnderReview,
      ]);
      const activeInstance = instances.find((instance) => activeStatuses.has(instance.status));
      const reviewInstance = instances.find((instance) => (
        instance.status === PlanInstanceStatus.Submitted ||
        instance.status === PlanInstanceStatus.UnderReview
      ));
      const tendedDates = new Set(
        instances.flatMap((instance) => (instance.answers ?? []).map((answer) => answer.entryDate)),
      );

      this.logger.log(JSON.stringify({
        event: 'user.overview.accessed',
        userId: request.user.sub,
        instanceCount: instances.length,
      }));

      return {
        message: 'User access verified',
        user: toPublicUser(request.user),
        metrics: {
          currentProgramme: activeInstance?.templateName ?? 'No active programme',
          nextReviewAt: reviewInstance?.dueAt ?? null,
          daysTended: tendedDates.size,
          activeForms: instances.filter((instance) => activeStatuses.has(instance.status)).length,
          submittedForms: instances.filter((instance) => (
            instance.status === PlanInstanceStatus.Submitted ||
            instance.status === PlanInstanceStatus.UnderReview ||
            instance.status === PlanInstanceStatus.Reviewed
          )).length,
          latestNote: instances.find((instance) => instance.nutritionistNotes)?.nutritionistNotes ?? null,
        },
      };
    } catch (error) {
      this.logger.error(JSON.stringify({
        event: 'user.overview.failed',
        userId: request.user.sub,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Get('instances')
  async getInstances(
    @Req() request: AuthenticatedRequest,
    @Query('view') view?: string,
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string,
  ) {
    try {
      const normalizedView = view?.trim().toLowerCase();
      if (normalizedView && normalizedView !== 'active' && normalizedView !== 'submitted') {
        throw new BadRequestException('View must be active or submitted');
      }

      const statusFilter = normalizedView === 'active'
        ? { $in: [PlanInstanceStatus.Assigned, PlanInstanceStatus.InProgress] }
        : normalizedView === 'submitted'
          ? { $in: [PlanInstanceStatus.Submitted, PlanInstanceStatus.UnderReview, PlanInstanceStatus.Reviewed] }
          : undefined;
      const filter = statusFilter
        ? { userId: request.user.sub, status: statusFilter }
        : { userId: request.user.sub };
      const { page, limit, skip } = parsePagination(pageValue, limitValue);

      const [instances, total] = await Promise.all([
        this.planInstanceModel.find(filter)
        .select('templateId templateName status assignedAt dueAt planValidityDays formFillingDays planValidUntil nutritionistNotes reviewedAt createdAt updatedAt')
        .sort({ assignedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
        this.planInstanceModel.countDocuments(filter).exec(),
      ]);

      this.logger.log(JSON.stringify({
        event: 'user.plan_instances.listed',
        userId: request.user.sub,
        view: normalizedView ?? 'all',
        resultCount: instances.length,
      }));

      return {
        instances: instances.map((instance) => toPublicPlanInstance(instance as unknown as Parameters<typeof toPublicPlanInstance>[0])),
        meta: paginationMeta(page, limit, total),
      };
    } catch (error) {
      this.logger.error(JSON.stringify({
        event: 'user.plan_instances.list_failed',
        userId: request.user.sub,
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

      const instance = await this.planInstanceModel
        .findOne({ _id: instanceId, userId: request.user.sub })
        .lean()
        .exec();
      if (!instance) {
        throw new NotFoundException('Form instance not found');
      }

      return { instance: toPublicPlanInstance(instance as unknown as Parameters<typeof toPublicPlanInstance>[0]) };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(JSON.stringify({
        event: 'user.plan_instance.read_failed',
        userId: request.user.sub,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }

  @Patch('instances/:instanceId/responses')
  async updateInstanceResponses(
    @Param('instanceId') instanceId: string,
    @Body() updateDto: UpdatePlanInstanceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      if (!Types.ObjectId.isValid(instanceId)) {
        throw new BadRequestException('Invalid form instance id');
      }

      if (
        updateDto.status !== PlanInstanceStatus.InProgress &&
        updateDto.status !== PlanInstanceStatus.Submitted
      ) {
        throw new BadRequestException('Users can only save or submit a form');
      }

      const instance = await this.planInstanceModel
        .findOne({ _id: instanceId, userId: request.user.sub })
        .exec();
      if (!instance) {
        throw new NotFoundException('Form instance not found');
      }
      if (
        instance.status !== PlanInstanceStatus.Assigned &&
        instance.status !== PlanInstanceStatus.InProgress
      ) {
        throw new BadRequestException('Submitted forms can no longer be edited');
      }

      if (!instance.planValidityDays) instance.planValidityDays = 30;
      if (!instance.formFillingDays) instance.formFillingDays = 30;
      if (!instance.planValidUntil) {
        instance.planValidUntil = new Date(
          instance.assignedAt.getTime() + instance.planValidityDays * 24 * 60 * 60 * 1000,
        );
      }

      const now = new Date();
      if (now > instance.planValidUntil) {
        throw new BadRequestException('This plan is no longer valid');
      }

      const firstEntryDate = dateKey(instance.assignedAt);
      const lastEntryDate = dateKey(instance.dueAt);

      const questionById = new Map(instance.questions.map((question) => [question.id, question]));
      for (const answer of instance.answers) {
        if (!answer.entryDate) {
          answer.entryDate = instance.assignedAt.toISOString().slice(0, 10);
        }
        if (answer.occurrence === undefined || answer.occurrence === null) {
          answer.occurrence = 0;
        }
      }

      const answersByQuestionId = new Map(
        instance.answers.map((answer) => [
          `${answer.questionId}:${answer.entryDate}:${answer.occurrence}`,
          answer,
        ]),
      );

      for (const answer of updateDto.answers) {
        const question = questionById.get(answer.questionId);
        if (!question) {
          throw new BadRequestException('An answer references an unknown question');
        }
        const entryDate = answer.entryDate ?? new Date().toISOString().slice(0, 10);
        if (!isDateKey(entryDate)) {
          throw new BadRequestException('Answer entry date must use YYYY-MM-DD');
        }
        const occurrence = answer.occurrence ?? 0;
        if (entryDate < firstEntryDate || entryDate > lastEntryDate) {
          throw new BadRequestException(`Answers must be recorded between ${firstEntryDate} and ${lastEntryDate}`);
        }
        const answerKey = `${answer.questionId}:${entryDate}:${occurrence}`;
        if (isBlank(answer.value)) {
          answersByQuestionId.delete(answerKey);
          continue;
        }
        validateAnswer(question, answer.value, occurrence);
        answersByQuestionId.set(answerKey, {
          questionId: answer.questionId,
          entryDate,
          occurrence,
          value: answer.value,
          answeredAt: new Date(),
        });
      }

      const answers = [...answersByQuestionId.values()];
      if (updateDto.status === PlanInstanceStatus.Submitted) {
        const requiredUntil = dateKey(now < instance.dueAt ? now : instance.dueAt);
        const answerKeys = new Set(
          answers
            .filter((answer) => !isBlank(answer.value))
            .map((answer) => `${answer.questionId}:${answer.entryDate}:${answer.occurrence}`),
        );
        const missingRequired = dateKeysBetween(firstEntryDate, requiredUntil).some((entryDate) =>
          instance.questions.some((question) => question.required && Array.from(
            { length: question.repeatPerDay ?? 1 },
            (_, occurrence) => !answerKeys.has(`${question.id}:${entryDate}:${occurrence}`),
          ).some(Boolean)),
        );
        if (missingRequired) {
          throw new BadRequestException('Complete every required question for each recorded day before submitting');
        }
      }

      instance.answers = answers;
      instance.status = updateDto.status;
      await instance.save();

      this.logger.log(JSON.stringify({
        event: 'user.plan_instance.responses_updated',
        userId: request.user.sub,
        instanceId,
        status: updateDto.status,
        answerCount: answers.length,
      }));

      return { instance: toPublicPlanInstance(instance.toObject() as unknown as Parameters<typeof toPublicPlanInstance>[0]) };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(JSON.stringify({
        event: 'user.plan_instance.responses_update_failed',
        userId: request.user.sub,
        instanceId,
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw error;
    }
  }
}
