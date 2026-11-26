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
import { CreateContactEnquiryDto } from './dto/create-contact-enquiry.dto.js';
import {
  ContactEnquiry,
  type ContactEnquiryDocument,
} from './schemas/contact-enquiry.schema.js';

@Controller('enquiries')
export class ContactEnquiriesController {
  private readonly logger = new Logger(ContactEnquiriesController.name);

  constructor(
    @InjectModel(ContactEnquiry.name)
    private readonly enquiryModel: Model<ContactEnquiryDocument>,
  ) {}

  @Post('contact')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RateLimitGuard)
  @RateLimit(5, 60_000)
  async create(@Body() dto: CreateContactEnquiryDto) {
    const enquiry = await this.enquiryModel.create({
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      email: dto.email.trim().toLowerCase(),
      city: dto.city?.trim() || undefined,
      whatsapp: dto.whatsapp?.trim() || undefined,
      message: dto.message.trim(),
      consent: true,
      consentedAt: new Date(),
      source: 'contact-page',
      status: 'new',
    });

    this.logger.log(JSON.stringify({
      event: 'contact_enquiry.created',
      enquiryId: enquiry._id.toString(),
      source: enquiry.source,
    }));

    return {
      id: enquiry._id.toString(),
      message: 'Your enquiry has been received by Deepti’s practice.',
    };
  }
}
