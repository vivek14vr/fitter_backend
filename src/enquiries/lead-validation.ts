import { BadRequestException } from '@nestjs/common';
import type { SaveLeadDto } from './dto/save-lead.dto.js';
import type { Lead } from './schemas/lead.schema.js';

type LeadAnswerState = Pick<
  Lead,
  'source' | 'name' | 'email' | 'phone' | 'consent' | 'concerns' | 'goal' | 'timeline' | 'country' | 'region'
>;

function hasText(value: string | undefined, minimumLength: number) {
  return Boolean(value?.trim() && value.trim().length >= minimumLength);
}

/**
 * Public DTO decorators validate individual values. This enforces the
 * relationship between a claimed completed step and the data it represents.
 */
export function validateLeadStep(dto: SaveLeadDto, isCreate = false) {
  if (isCreate && dto.completedStep !== 1) {
    throw new BadRequestException('A new lead must begin at step 1');
  }

  const missing: string[] = [];
  if (dto.completedStep >= 1) {
    if (!hasText(dto.name, 2)) missing.push('name');
    if (!dto.email?.trim()) missing.push('email');
    if (!hasText(dto.phone, 7)) missing.push('phone');
    if (dto.consent !== true) missing.push('consent');
  }
  if (dto.source === 'one-to-one-booking-popup') {
    if (dto.completedStep !== 1) {
      throw new BadRequestException('A direct consultation booking has one contact step');
    }
    if (missing.length) {
      throw new BadRequestException(`Complete the required fields for this step: ${missing.join(', ')}`);
    }
    return;
  }
  if (dto.completedStep >= 2 && !dto.concerns?.length) missing.push('concerns');
  if (dto.completedStep >= 3 && !hasText(dto.goal, 3)) missing.push('goal');
  if (dto.completedStep >= 4) {
    if (!hasText(dto.timeline, 3)) missing.push('timeline');
    if (!hasText(dto.country, 2)) missing.push('country');
    if (!dto.region) missing.push('region');
  }

  if (missing.length) {
    throw new BadRequestException(`Complete the required fields for this step: ${missing.join(', ')}`);
  }
}

export function ensureLeadIsComplete(lead: LeadAnswerState) {
  const missing: string[] = [];
  if (!hasText(lead.name, 2)) missing.push('name');
  if (!lead.email?.trim()) missing.push('email');
  if (!hasText(lead.phone, 7)) missing.push('phone');
  if (lead.consent !== true) missing.push('consent');
  if (lead.source === 'one-to-one-booking-popup') {
    if (missing.length) {
      throw new BadRequestException(`Lead is incomplete: ${missing.join(', ')}`);
    }
    return;
  }
  if (!lead.concerns?.length) missing.push('concerns');
  if (!hasText(lead.goal, 3)) missing.push('goal');
  if (!hasText(lead.timeline, 3)) missing.push('timeline');
  if (!hasText(lead.country, 2)) missing.push('country');
  if (!lead.region) missing.push('region');

  if (missing.length) {
    throw new BadRequestException(`Lead is incomplete: ${missing.join(', ')}`);
  }
}

/** Phone country code is a cross-check, not a sole pricing decision. */
export function phoneLooksIndian(phone: string | undefined) {
  const digits = phone?.replace(/\D/g, '') ?? '';
  return digits.startsWith('91') && digits.length >= 12;
}

export function resolveLeadRegion(lead: LeadAnswerState): 'india' | 'worldwide' {
  if (lead.region === 'india' || phoneLooksIndian(lead.phone)) {
    return 'india';
  }
  return 'worldwide';
}
