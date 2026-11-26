import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { RateLimit } from '../common/rate-limit.decorator.js';
import { RateLimitGuard } from '../common/rate-limit.guard.js';
import { CreateHealthGoalEnquiryDto } from './dto/create-health-goal-enquiry.dto.js';
import {
  HealthGoalEnquiry,
  type HealthGoalEnquiryDocument,
} from './schemas/health-goal-enquiry.schema.js';

type ConsultationRegion = 'india' | 'worldwide';

function isIndia(country: string, phone: string): boolean {
  const countryValue = country.trim().toLowerCase();
  if (countryValue === 'india' || countryValue === 'in') return true;

  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('91') && digits.length >= 12;
}

@Controller('consultations')
export class ConsultationsController {
  private readonly logger = new Logger(ConsultationsController.name);

  constructor(
    @InjectModel(HealthGoalEnquiry.name)
    private readonly enquiryModel: Model<HealthGoalEnquiryDocument>,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RateLimitGuard)
  @RateLimit(5, 60_000)
  async create(@Body() dto: CreateHealthGoalEnquiryDto) {
    const region: ConsultationRegion = dto.region === 'india' || isIndia(dto.country, dto.phone)
      ? 'india'
      : 'worldwide';
    const bookingLink = region === 'worldwide'
      ? process.env.BOOKING_LINK_WORLDWIDE?.trim()
      : undefined;
    const paymentStatus = region === 'india' ? 'pending' : 'not_required';
    const paymentAmountInr = region === 'india'
      ? Number(process.env.INDIA_CONSULTATION_AMOUNT_INR ?? 1500)
      : undefined;

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
      privacyVersion: '2026-11-26',
      status: 'new',
      region,
      paymentStatus,
      paymentAmountInr,
      paymentCurrency: region === 'india' ? 'INR' : undefined,
      bookingLinkReleasedAt: bookingLink ? new Date() : undefined,
    });

    this.logger.log(JSON.stringify({
      event: 'consultation_lead.created',
      enquiryId: enquiry._id.toString(),
      region,
      paymentStatus,
      source: enquiry.source,
    }));

    return {
      consultationId: enquiry._id.toString(),
      region,
      paymentRequired: region === 'india',
      paymentStatus,
      bookingLink,
      message: region === 'india'
        ? 'Your details are saved. Payment will be required before the India scheduling link is released.'
        : 'Your details are saved. You can choose a time with Deepti now.',
    };
  }
}
