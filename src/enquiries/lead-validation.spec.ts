import { BadRequestException } from '@nestjs/common';
import {
  ensureLeadIsComplete,
  phoneLooksIndian,
  resolveLeadRegion,
  validateLeadStep,
} from './lead-validation.js';
import type { Lead } from './schemas/lead.schema.js';

const contact = {
  name: 'Example Person',
  email: 'person@example.com',
  phone: '+91 98765 43210',
  consent: true,
};

describe('lead validation', () => {
  it('allows a direct 1:1 booking to save its single contact step', () => {
    expect(() => validateLeadStep({
      source: 'one-to-one-booking-popup',
      completedStep: 1,
      country: 'India',
      region: 'india',
      ...contact,
    }, true)).not.toThrow();
  });

  it('does not allow a direct booking to masquerade as a four-step quiz', () => {
    expect(() => validateLeadStep({
      source: 'one-to-one-booking-popup',
      completedStep: 4,
      country: 'India',
      region: 'india',
      ...contact,
    })).toThrow(BadRequestException);
  });

  it('requires every health-check-in answer before a finalization', () => {
    expect(() => ensureLeadIsComplete({
      source: 'homepage-health-goal-popup',
      region: 'india',
      country: 'India',
      ...contact,
      concerns: ['gut'],
      goal: 'Improve digestion',
    } as Lead)).toThrow(BadRequestException);
  });

  it('uses an explicit region rather than matching country substrings', () => {
    expect(phoneLooksIndian('+44 20 1234 5678')).toBe(false);
    expect(resolveLeadRegion({
      source: 'one-to-one-booking-popup',
      region: 'worldwide',
      country: 'Not India',
      ...contact,
      phone: '+44 20 1234 5678',
    } as Lead)).toBe('worldwide');
  });

  it('uses an Indian phone country code as a pricing cross-check', () => {
    expect(resolveLeadRegion({
      source: 'one-to-one-booking-popup',
      region: 'worldwide',
      country: 'United Kingdom',
      ...contact,
    } as Lead)).toBe('india');
  });
});
