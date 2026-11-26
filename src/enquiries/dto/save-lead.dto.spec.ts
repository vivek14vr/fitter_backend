import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SaveLeadDto } from './save-lead.dto.js';

describe('SaveLeadDto', () => {
  it('rejects a phone value that contains no digits', async () => {
    const dto = plainToInstance(SaveLeadDto, {
      source: 'one-to-one-booking-popup',
      completedStep: 1,
      name: 'Example Person',
      email: 'person@example.com',
      phone: '-------',
      countryCode: '+91',
      consent: true,
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('phone');
  });
});
