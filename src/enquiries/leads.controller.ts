import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { AuditLog, type AuditLogDocument } from '../auth/schemas/audit-log.schema.js';
import { UserRole } from '../auth/user-role.enum.js';
import { RateLimit } from '../common/rate-limit.decorator.js';
import { RateLimitGuard } from '../common/rate-limit.guard.js';
import { parsePagination, paginationMeta } from '../common/pagination.js';
import { SaveLeadDto } from './dto/save-lead.dto.js';
import { UpdateLeadFollowUpDto } from './dto/update-lead-follow-up.dto.js';
import { VerifyRazorpayPaymentDto } from './dto/verify-razorpay-payment.dto.js';
import { LeadProgressService } from './lead-progress.service.js';
import {
  Lead,
  type LeadDocument,
  type LeadFollowUpStatus,
  type LeadStatus,
} from './schemas/lead.schema.js';

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadProgressService: LeadProgressService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60_000)
  create(
    @Body() dto: SaveLeadDto,
    @Headers('x-lead-continuation-token') continuationToken?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.leadProgressService.create(dto, continuationToken, idempotencyKey);
  }

  @Patch(':leadId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60_000)
  update(
    @Param('leadId') leadId: string,
    @Body() dto: SaveLeadDto,
    @Headers('x-lead-continuation-token') continuationToken?: string,
  ) {
    return this.leadProgressService.update(leadId, dto, continuationToken);
  }

  @Post(':leadId/finalize')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60_000)
  finalize(
    @Param('leadId') leadId: string,
    @Headers('x-lead-continuation-token') continuationToken?: string,
  ) {
    return this.leadProgressService.finalize(leadId, continuationToken);
  }

  @Post(':leadId/payment-order')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit(5, 60_000)
  createPaymentOrder(
    @Param('leadId') leadId: string,
    @Headers('x-lead-continuation-token') continuationToken?: string,
  ) {
    return this.leadProgressService.createPaymentOrder(leadId, continuationToken);
  }

  @Post(':leadId/payment/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60_000)
  verifyPayment(
    @Param('leadId') leadId: string,
    @Body() dto: VerifyRazorpayPaymentDto,
    @Headers('x-lead-continuation-token') continuationToken?: string,
  ) {
    return this.leadProgressService.verifyPayment(leadId, dto, continuationToken);
  }

  @Get(':leadId/payment-status')
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60_000)
  paymentStatus(
    @Param('leadId') leadId: string,
    @Headers('x-lead-continuation-token') continuationToken?: string,
  ) {
    return this.leadProgressService.getPaymentStatus(leadId, continuationToken);
  }
}

@Controller('admin/leads')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminLeadsController {
  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    private readonly leadProgressService: LeadProgressService,
  ) {}

  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
    @Query('search') searchValue?: string,
    @Query('status') statusValue?: string,
    @Query('followUpStatus') followUpStatusValue?: string,
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string,
  ) {
    const { page, limit, skip } = parsePagination(pageValue, limitValue);
    const search = searchValue?.trim();
    if (search && search.length > 100) {
      throw new BadRequestException('Search must be 100 characters or fewer');
    }

    const status = statusValue?.trim().toLowerCase();
    const validStatuses: LeadStatus[] = [
      'in_progress',
      'submitted',
      'payment_pending',
      'payment_failed',
      'paid',
      'contacted',
      'closed',
    ];
    if (status && !validStatuses.includes(status as LeadStatus)) {
      throw new BadRequestException('Unsupported lead status');
    }

    const followUpStatus = followUpStatusValue?.trim().toLowerCase();
    const validFollowUpStatuses: LeadFollowUpStatus[] = ['new', 'contacted', 'closed'];
    if (followUpStatus && !validFollowUpStatuses.includes(followUpStatus as LeadFollowUpStatus)) {
      throw new BadRequestException('Unsupported follow-up status');
    }

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (followUpStatus) filter.followUpStatus = followUpStatus;
    if (search) {
      const querySearch = escapeRegex(search);
      filter.$or = [
        { name: { $regex: querySearch, $options: 'i' } },
        { email: { $regex: querySearch, $options: 'i' } },
        { phone: { $regex: querySearch, $options: 'i' } },
        { country: { $regex: querySearch, $options: 'i' } },
      ];
    }

    const [leads, total] = await Promise.all([
      this.leadModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.leadModel.countDocuments(filter).exec(),
    ]);

    await this.auditLogModel.create({
      actorId: request.user.sub,
      actorRole: request.user.role,
      action: 'lead.listed',
      targetType: 'lead',
      targetId: 'collection',
      metadata: { page, limit, status: status ?? null, followUpStatus: followUpStatus ?? null, hasSearch: Boolean(search) },
    });

    return {
      leads: leads.map((lead) => ({
        id: lead._id.toString(),
        source: lead.source,
        name: lead.name ?? null,
        email: lead.email ?? null,
        phone: lead.phone ?? null,
        concerns: lead.concerns ?? [],
        goal: lead.goal ?? null,
        timeline: lead.timeline ?? null,
        country: lead.country ?? null,
        region: lead.region ?? null,
        consent: lead.consent ?? false,
        consentedAt: lead.consentedAt ?? null,
        privacyVersion: lead.privacyVersion ?? null,
        completedStep: lead.completedStep,
        status: lead.status,
        followUpStatus: lead.followUpStatus ?? 'new',
        paymentStatus: lead.paymentStatus ?? null,
        paymentAmountInr: lead.paymentAmountInr ?? null,
        paymentPaidAt: lead.paymentPaidAt ?? null,
        bookingLinkReleasedAt: lead.bookingLinkReleasedAt ?? null,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
      })),
      meta: paginationMeta(page, limit, total),
    };
  }

  @Patch(':leadId/follow-up')
  async updateFollowUp(
    @Param('leadId') leadId: string,
    @Body() dto: UpdateLeadFollowUpDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const lead = await this.leadProgressService.updateFollowUp(leadId, dto.followUpStatus);
    await this.auditLogModel.create({
      actorId: request.user.sub,
      actorRole: request.user.role,
      action: 'lead.follow_up_updated',
      targetType: 'lead',
      targetId: leadId,
      metadata: { followUpStatus: dto.followUpStatus },
    });
    return {
      id: lead._id.toString(),
      followUpStatus: lead.followUpStatus,
    };
  }
}
