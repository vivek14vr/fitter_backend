import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { LeadProgressService } from './lead-progress.service.js';
import { RazorpayService } from './razorpay.service.js';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('webhooks')
export class PaymentWebhookController {
  constructor(
    private readonly leadProgressService: LeadProgressService,
    private readonly razorpayService: RazorpayService,
  ) {}

  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  async razorpay(
    @Req() request: RawBodyRequest,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
    @Headers('x-razorpay-event') eventType?: string,
  ) {
    if (!this.razorpayService.isWebhookConfigured()) {
      throw new ServiceUnavailableException('Payment webhook is not configured');
    }
    if (!request.rawBody?.length || !signature || !eventId || !eventType) {
      throw new BadRequestException('Webhook headers or body are missing');
    }
    if (!this.razorpayService.verifyWebhookSignature(request.rawBody, signature)) {
      throw new BadRequestException('Webhook signature is invalid');
    }

    return this.leadProgressService.processRazorpayWebhook(eventId, eventType, request.rawBody);
  }
}
