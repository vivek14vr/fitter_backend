import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateHealthGoalEnquiryDto } from './create-health-goal-enquiry.dto.js';

const validPayload = {
  concerns: ['gut', 'thyroid'],
  goal: 'Improve digestion and daily comfort',
  timeline: 'Within the next month',
  country: 'India',
  name: 'Example Person',
  email: 'person@example.com',
  phone: '+91 98765 43210',
  consent: true,
  source: 'homepage-health-goal-popup',
};

describe('CreateHealthGoalEnquiryDto', () => {
  it('accepts a valid health-goal enquiry', async () => {
    const dto = plainToInstance(CreateHealthGoalEnquiryDto, validPayload);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects unsupported concerns and missing consent', async () => {
    const dto = plainToInstance(CreateHealthGoalEnquiryDto, {
      ...validPayload,
      concerns: ['unsupported-condition'],
      consent: false,
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['concerns', 'consent']));
  });
});
