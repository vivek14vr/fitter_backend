import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { SaveLeadDto } from './dto/save-lead.dto.js';
import { VerifyRazorpayPaymentDto } from './dto/verify-razorpay-payment.dto.js';
import {
  ensureLeadIsComplete,
  resolveLeadRegion,
  validateLeadStep,
} from './lead-validation.js';
import { RazorpayService } from './razorpay.service.js';
import {
  HealthGoalEnquiry,
  type HealthGoalEnquiryDocument,
} from './schemas/health-goal-enquiry.schema.js';
import {
  Lead,
  type LeadDocument,
  type LeadFollowUpStatus,
  type LeadPaymentStatus,
} from './schemas/lead.schema.js';
import {
  PaymentWebhookEvent,
  type PaymentWebhookEventDocument,
} from './schemas/payment-webhook-event.schema.js';

const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,160}$/;

type PaymentWebhookPayload = {
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; status?: string } };
    order?: { entity?: { id?: string; status?: string } };
  };
};

type PaymentResult = {
  leadId: string;
  consultationId: string;
  region: 'india' | 'worldwide';
  paymentRequired: boolean;
  paymentConfigured: boolean;
  paymentStatus: LeadPaymentStatus;
  bookingLink?: string;
};

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === 'object' && error !== null
    && 'code' in error && (error as { code?: unknown }).code === 11000;
}

function normalizeLeadFields(dto: SaveLeadDto) {
  return {
    ...(dto.concerns ? { concerns: [...new Set(dto.concerns)] } : {}),
    ...(dto.goal !== undefined ? { goal: dto.goal.trim() } : {}),
    ...(dto.timeline !== undefined ? { timeline: dto.timeline.trim() } : {}),
    ...(dto.country !== undefined ? { country: dto.country.trim() } : {}),
    ...(dto.region !== undefined ? { region: dto.region } : {}),
    ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
    ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() } : {}),
    ...(dto.phone !== undefined ? { phone: dto.phone.trim() } : {}),
    ...(dto.consent !== undefined
      ? { consent: dto.consent, consentedAt: new Date() }
      : {}),
  };
}

function assertOpaqueToken(value: string | undefined, label: string) {
  if (!value || !OPAQUE_TOKEN_PATTERN.test(value)) {
    throw new BadRequestException(`${label} is invalid`);
  }
  return value;
}

function constantTimeHashEquals(storedHash: string, token: string) {
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashValue(token), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function getPrivacyVersion() {
  return process.env.PRIVACY_POLICY_VERSION?.trim() || '2026-11-26';
}

function getPaymentAmountInPaise() {
  const amountInr = Number(process.env.INDIA_CONSULTATION_AMOUNT_INR ?? 1500);
  if (!Number.isFinite(amountInr) || amountInr <= 0 || amountInr > 100_000) {
    throw new ServiceUnavailableException('India consultation amount is not configured correctly');
  }
  return Math.round(amountInr * 100);
}

function getBookingLink(region: 'india' | 'worldwide') {
  const configured = region === 'india'
    ? process.env.CALENDLY_LINK_INDIA?.trim()
      || process.env.CALENDLY_LINK_WORLDWIDE?.trim()
      || process.env.BOOKING_LINK_INDIA?.trim()
      || process.env.BOOKING_LINK_WORLDWIDE?.trim()
    : process.env.CALENDLY_LINK_WORLDWIDE?.trim() || process.env.BOOKING_LINK_WORLDWIDE?.trim();

  if (!configured) return undefined;

  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== 'https:') throw new Error('Booking link must use HTTPS');
    return parsed.toString();
  } catch {
    throw new ServiceUnavailableException('Scheduling link is not configured correctly');
  }
}

function asPaymentStatus(value: LeadPaymentStatus | undefined, region: 'india' | 'worldwide') {
  return value ?? (region === 'india' ? 'pending' : 'not_required');
}

@Injectable()
export class LeadProgressService {
  private readonly logger = new Logger(LeadProgressService.name);

  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(HealthGoalEnquiry.name)
    private readonly enquiryModel: Model<HealthGoalEnquiryDocument>,
    @InjectModel(PaymentWebhookEvent.name)
    private readonly webhookEventModel: Model<PaymentWebhookEventDocument>,
    private readonly razorpayService: RazorpayService,
  ) {}

  async create(dto: SaveLeadDto, continuationTokenHeader?: string, idempotencyKeyHeader?: string) {
    validateLeadStep(dto, true);
    const continuationToken = assertOpaqueToken(continuationTokenHeader, 'Lead continuation token');
    const idempotencyKey = assertOpaqueToken(idempotencyKeyHeader, 'Idempotency key');
    const continuationTokenHash = hashValue(continuationToken);
    const idempotencyKeyHash = hashValue(idempotencyKey);

    const existing = await this.leadModel
      .findOne({ idempotencyKeyHash })
      .select('+continuationTokenHash')
      .exec();
    if (existing) {
      this.assertContinuationToken(existing, continuationToken);
      return this.presentProgress(existing);
    }

    try {
      const lead = await this.leadModel.create({
        source: dto.source,
        leadType: dto.source === 'one-to-one-booking-popup' ? 'consultation_booking' : 'health_checkin',
        ...normalizeLeadFields(dto),
        continuationTokenHash,
        idempotencyKeyHash,
        privacyVersion: getPrivacyVersion(),
        completedStep: dto.completedStep,
        status: 'in_progress',
        followUpStatus: 'new',
      });
      this.log('lead.created', lead);
      return this.presentProgress(lead);
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const retriedLead = await this.leadModel
        .findOne({ idempotencyKeyHash })
        .select('+continuationTokenHash')
        .exec();
      if (!retriedLead) throw error;
      this.assertContinuationToken(retriedLead, continuationToken);
      return this.presentProgress(retriedLead);
    }
  }

  async update(leadId: string, dto: SaveLeadDto, continuationTokenHeader?: string) {
    const continuationToken = assertOpaqueToken(continuationTokenHeader, 'Lead continuation token');
    const lead = await this.findAuthorisedLead(leadId, continuationToken);
    if (dto.source !== lead.source) {
      throw new BadRequestException('Lead source cannot be changed');
    }
    const previousStep = lead.completedStep ?? 0;
    if (lead.source === 'one-to-one-booking-popup' && dto.completedStep !== 1) {
      throw new BadRequestException('A direct consultation booking has one contact step');
    }
    if (dto.completedStep > previousStep + 1) {
      throw new BadRequestException('Complete the previous step before continuing');
    }
    validateLeadStep(dto);

    Object.assign(lead, normalizeLeadFields(dto), {
      completedStep: Math.max(previousStep, dto.completedStep),
    });
    await lead.save();
    this.log('lead.updated', lead);
    return this.presentProgress(lead);
  }

  async finalize(leadId: string, continuationTokenHeader?: string): Promise<PaymentResult> {
    const continuationToken = assertOpaqueToken(continuationTokenHeader, 'Lead continuation token');
    const lead = await this.findAuthorisedLead(leadId, continuationToken);
    const requiredStep = lead.source === 'one-to-one-booking-popup' ? 1 : 4;
    if ((lead.completedStep ?? 0) < requiredStep) {
      throw new BadRequestException(`Complete all ${requiredStep} required step${requiredStep === 1 ? '' : 's'} before submitting`);
    }
    ensureLeadIsComplete(lead);

    const region = resolveLeadRegion(lead);
    const isDirectBooking = lead.source === 'one-to-one-booking-popup';
    const paymentStatus = isDirectBooking
      ? asPaymentStatus(lead.paymentStatus, region)
      : 'not_required';
    const bookingLink = isDirectBooking && (region === 'worldwide' || paymentStatus === 'paid')
      ? getBookingLink(region)
      : undefined;
    const enquiry = await this.getOrCreateConsultation(lead, region, paymentStatus, bookingLink);

    lead.region = region;
    lead.consultationId = enquiry._id.toString();
    lead.submittedAt ??= new Date();
    if (isDirectBooking && region === 'india') {
      lead.paymentStatus = paymentStatus === 'paid' ? 'paid' : 'pending';
      lead.paymentAmountInr = getPaymentAmountInPaise() / 100;
      lead.paymentCurrency = 'INR';
      lead.status = paymentStatus === 'paid' ? 'paid' : 'payment_pending';
    } else {
      lead.paymentStatus = 'not_required';
      lead.status = 'submitted';
      if (bookingLink) {
        lead.bookingLink = bookingLink;
        lead.bookingLinkReleasedAt ??= new Date();
      }
    }
    await lead.save();
    this.log('lead.finalized', lead);

    return this.presentFinalization(lead, enquiry._id.toString());
  }

  async createPaymentOrder(leadId: string, continuationTokenHeader?: string) {
    const continuationToken = assertOpaqueToken(continuationTokenHeader, 'Lead continuation token');
    const lead = await this.findAuthorisedLead(leadId, continuationToken);
    if (lead.source !== 'one-to-one-booking-popup' || lead.region !== 'india' || !lead.consultationId) {
      throw new BadRequestException('This lead is not ready for an India payment');
    }
    if (lead.paymentStatus === 'paid') {
      return {
        paid: true,
        bookingLink: lead.bookingLink ?? getBookingLink('india'),
      };
    }

    const amount = getPaymentAmountInPaise();
    let orderId = lead.razorpayOrderId;
    if (!orderId) {
      const order = await this.razorpayService.createOrder({
        amount,
        receipt: `lead_${lead._id.toString().slice(-16)}`,
        notes: {
          leadId: lead._id.toString(),
          consultationId: lead.consultationId,
          purpose: 'one_to_one_health_assessment',
        },
      });
      orderId = order.id;
      lead.razorpayOrderId = order.id;
      lead.paymentStatus = 'order_created';
      lead.status = 'payment_pending';
      await lead.save();
      this.log('lead.payment_order_created', lead);
    }

    return {
      paid: false,
      keyId: this.razorpayService.getCheckoutKeyId(),
      orderId,
      amount,
      currency: 'INR' as const,
      name: 'Deepti Sherawat',
      description: '1:1 Health Assessment',
      prefill: {
        name: lead.name,
        email: lead.email,
        contact: lead.phone,
      },
    };
  }

  async verifyPayment(
    leadId: string,
    dto: VerifyRazorpayPaymentDto,
    continuationTokenHeader?: string,
  ): Promise<PaymentResult> {
    const continuationToken = assertOpaqueToken(continuationTokenHeader, 'Lead continuation token');
    const lead = await this.findAuthorisedLead(leadId, continuationToken);
    if (lead.source !== 'one-to-one-booking-popup' || lead.region !== 'india' || !lead.consultationId || !lead.razorpayOrderId) {
      throw new BadRequestException('This lead does not have an India payment order');
    }
    if (lead.razorpayOrderId !== dto.razorpayOrderId) {
      throw new BadRequestException('Payment order does not match this lead');
    }
    if (!this.razorpayService.verifyCheckoutSignature(
      dto.razorpayOrderId,
      dto.razorpayPaymentId,
      dto.razorpaySignature,
    )) {
      throw new BadRequestException('Payment verification failed');
    }

    return this.markPaymentPaid(lead, dto.razorpayPaymentId);
  }

  async getPaymentStatus(leadId: string, continuationTokenHeader?: string) {
    const continuationToken = assertOpaqueToken(continuationTokenHeader, 'Lead continuation token');
    const lead = await this.findAuthorisedLead(leadId, continuationToken);
    if (lead.source !== 'one-to-one-booking-popup' || !lead.consultationId || !lead.region) {
      throw new BadRequestException('This lead has not been submitted yet');
    }
    return this.presentFinalization(lead, lead.consultationId);
  }

  async processRazorpayWebhook(eventId: string, eventType: string, rawBody: Buffer) {
    const payloadHash = hashValue(rawBody.toString('base64'));
    let payload: PaymentWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as PaymentWebhookPayload;
    } catch {
      throw new BadRequestException('Webhook body is not valid JSON');
    }

    const payment = payload.payload?.payment?.entity;
    const order = payload.payload?.order?.entity;
    const orderId = payment?.order_id ?? order?.id;
    const paymentId = payment?.id;

    try {
      await this.webhookEventModel.create({
        providerEventId: eventId,
        eventType,
        payloadHash,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) return { duplicate: true };
      throw error;
    }

    if (!orderId) return { processed: true };
    const lead = await this.leadModel.findOne({ razorpayOrderId: orderId }).exec();
    if (!lead) {
      this.logger.warn(JSON.stringify({ event: 'razorpay.webhook.lead_not_found', eventType, orderId }));
      return { processed: true };
    }

    if ((eventType === 'payment.captured' || eventType === 'order.paid') && paymentId) {
      await this.markPaymentPaid(lead, paymentId);
    } else if (eventType === 'payment.failed') {
      lead.paymentStatus = 'failed';
      lead.status = 'payment_failed';
      await lead.save();
      await this.enquiryModel.updateOne(
        { leadId: lead._id.toString() },
        { $set: { paymentStatus: 'failed' } },
      ).exec();
      this.log('lead.payment_failed', lead);
    }

    return { processed: true };
  }

  async updateFollowUp(leadId: string, followUpStatus: LeadFollowUpStatus) {
    if (!Types.ObjectId.isValid(leadId)) throw new BadRequestException('Invalid lead id');
    const lead = await this.leadModel.findByIdAndUpdate(
      leadId,
      { $set: { followUpStatus } },
      { new: true },
    ).exec();
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  private async getOrCreateConsultation(
    lead: LeadDocument,
    region: 'india' | 'worldwide',
    paymentStatus: LeadPaymentStatus,
    bookingLink?: string,
  ) {
    const leadId = lead._id.toString();
    try {
      return await this.enquiryModel.findOneAndUpdate(
        { leadId },
        {
          $setOnInsert: {
            leadId,
            concerns: lead.concerns,
            goal: lead.goal,
            timeline: lead.timeline,
            country: lead.country ?? (region === 'india' ? 'India' : 'International'),
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            consent: true,
            consentedAt: lead.consentedAt ?? new Date(),
            source: lead.source,
            leadType: lead.leadType,
            privacyVersion: lead.privacyVersion,
            status: 'new',
            region,
            paymentStatus,
            paymentAmountInr: lead.source === 'one-to-one-booking-popup' && region === 'india'
              ? getPaymentAmountInPaise() / 100
              : undefined,
            paymentCurrency: lead.source === 'one-to-one-booking-popup' && region === 'india' ? 'INR' : undefined,
            bookingLinkReleasedAt: bookingLink ? new Date() : undefined,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).exec();
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existing = await this.enquiryModel.findOne({ leadId }).exec();
      if (!existing) throw error;
      return existing;
    }
  }

  private async markPaymentPaid(lead: LeadDocument, paymentId: string): Promise<PaymentResult> {
    if (lead.source !== 'one-to-one-booking-popup' || !lead.consultationId || lead.region !== 'india') {
      throw new BadRequestException('Payment does not belong to a submitted India lead');
    }
    if (lead.paymentStatus === 'paid') {
      if (lead.razorpayPaymentId && lead.razorpayPaymentId !== paymentId) {
        throw new ConflictException('This consultation already has a different payment');
      }
      return this.presentFinalization(lead, lead.consultationId);
    }

    const bookingLink = getBookingLink('india');
    lead.razorpayPaymentId = paymentId;
    lead.paymentStatus = 'paid';
    lead.status = 'paid';
    lead.paymentPaidAt = new Date();
    lead.bookingLink = bookingLink;
    lead.bookingLinkReleasedAt = new Date();
    try {
      await lead.save();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('This payment has already been recorded');
      }
      throw error;
    }
    await this.enquiryModel.updateOne(
      { leadId: lead._id.toString() },
      {
        $set: {
          paymentStatus: 'paid',
          razorpayOrderId: lead.razorpayOrderId,
          razorpayPaymentId: paymentId,
          paymentPaidAt: lead.paymentPaidAt,
          bookingLinkReleasedAt: lead.bookingLinkReleasedAt,
        },
      },
    ).exec();
    this.log('lead.payment_paid', lead);
    return this.presentFinalization(lead, lead.consultationId);
  }

  private async findAuthorisedLead(leadId: string, continuationToken: string) {
    if (!Types.ObjectId.isValid(leadId)) throw new BadRequestException('Invalid lead id');
    const lead = await this.leadModel.findById(leadId).select('+continuationTokenHash').exec();
    if (!lead) throw new NotFoundException('Lead not found');
    this.assertContinuationToken(lead, continuationToken);
    return lead;
  }

  private assertContinuationToken(lead: LeadDocument, continuationToken: string) {
    if (!lead.continuationTokenHash || !constantTimeHashEquals(lead.continuationTokenHash, continuationToken)) {
      throw new NotFoundException('Lead not found');
    }
  }

  private presentProgress(lead: LeadDocument) {
    return {
      leadId: lead._id.toString(),
      completedStep: lead.completedStep,
      status: lead.status,
    };
  }

  private presentFinalization(lead: LeadDocument, consultationId: string): PaymentResult {
    const region = lead.region ?? resolveLeadRegion(lead);
    const paymentStatus = asPaymentStatus(lead.paymentStatus, region);
    return {
      leadId: lead._id.toString(),
      consultationId,
      region,
      paymentRequired: lead.source === 'one-to-one-booking-popup' && region === 'india' && paymentStatus !== 'paid',
      paymentConfigured: lead.source !== 'one-to-one-booking-popup' || region !== 'india' || this.razorpayService.isCheckoutConfigured(),
      paymentStatus,
      bookingLink: lead.bookingLink,
    };
  }

  private log(event: string, lead: LeadDocument) {
    this.logger.log(JSON.stringify({
      event,
      leadId: lead._id.toString(),
      completedStep: lead.completedStep,
      status: lead.status,
      paymentStatus: lead.paymentStatus,
      source: lead.source,
    }));
  }
}
