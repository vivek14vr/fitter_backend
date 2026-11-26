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

type RazorpayWebhookBody = {
  event?: unknown;
};

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
  ) {
    if (!this.razorpayService.isWebhookConfigured()) {
      throw new ServiceUnavailableException('Payment webhook is not configured');
    }
    if (!request.rawBody?.length || !signature || !eventId) {
      throw new BadRequestException('Webhook headers or body are missing');
    }
    if (!this.razorpayService.verifyWebhookSignature(request.rawBody, signature)) {
      throw new BadRequestException('Webhook signature is invalid');
    }

    let eventType: string | undefined;
    try {
      const body = JSON.parse(request.rawBody.toString('utf8')) as RazorpayWebhookBody;
      eventType = typeof body.event === 'string' ? body.event : undefined;
    } catch {
      throw new BadRequestException('Webhook body is not valid JSON');
    }
    if (!eventType) throw new BadRequestException('Webhook event type is missing');

    return this.leadProgressService.processRazorpayWebhook(eventId, eventType, request.rawBody);
  }
}
