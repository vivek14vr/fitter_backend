import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { UserRole } from '../auth/user-role.enum.js';
import { parsePagination, paginationMeta } from '../common/pagination.js';
import { RateLimit } from '../common/rate-limit.decorator.js';
import { RateLimitGuard } from '../common/rate-limit.guard.js';
import { CreateHealthGoalEnquiryDto } from './dto/create-health-goal-enquiry.dto.js';
import {
  HealthGoalEnquiry,
  type HealthGoalEnquiryDocument,
} from './schemas/health-goal-enquiry.schema.js';

@Controller('enquiries')
export class HealthGoalEnquiriesController {
  private readonly logger = new Logger(HealthGoalEnquiriesController.name);

  constructor(
    @InjectModel(HealthGoalEnquiry.name)
    private readonly enquiryModel: Model<HealthGoalEnquiryDocument>,
  ) {}

  @Post('health-goals')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RateLimitGuard)
  @RateLimit(5, 60_000)
  async create(@Body() dto: CreateHealthGoalEnquiryDto) {
    const enquiry = await this.enquiryModel.create({
      concerns: [...new Set(dto.concerns)],
      goal: dto.goal.trim(),
      timeline: dto.timeline.trim(),
      country: dto.country.trim(),
      name: dto.name.trim(),
      email: dto.email.trim().toLowerCase(),
      phone: dto.phone.trim(),
      consent: true,
      consentedAt: new Date(),
      source: dto.source,
      privacyVersion: '2026-11-20',
      status: 'new',
    });

    this.logger.log(JSON.stringify({
      event: 'health_goal_enquiry.created',
      enquiryId: enquiry._id.toString(),
      concernCount: enquiry.concerns?.length ?? 0,
      source: enquiry.source,
    }));

    return {
      id: enquiry._id.toString(),
      message: 'Your health goals have been shared with Deepti’s practice.',
    };
  }
}

@Controller('admin/enquiries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminHealthGoalEnquiriesController {
  constructor(
    @InjectModel(HealthGoalEnquiry.name)
    private readonly enquiryModel: Model<HealthGoalEnquiryDocument>,
  ) {}

  @Get()
  async list(
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string,
  ) {
    const { page, limit, skip } = parsePagination(pageValue, limitValue);
    const [enquiries, total] = await Promise.all([
      this.enquiryModel.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.enquiryModel.countDocuments().exec(),
    ]);

    return {
      enquiries: enquiries.map((enquiry) => ({
        id: enquiry._id.toString(),
        concerns: enquiry.concerns ?? [],
        goal: enquiry.goal,
        timeline: enquiry.timeline,
        country: enquiry.country,
        name: enquiry.name,
        email: enquiry.email,
        phone: enquiry.phone,
        status: enquiry.status,
        consentedAt: enquiry.consentedAt,
        createdAt: enquiry.createdAt,
      })),
      pagination: paginationMeta(page, limit, total),
    };
  }
}
