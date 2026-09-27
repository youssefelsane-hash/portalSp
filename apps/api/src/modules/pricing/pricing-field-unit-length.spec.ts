import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreatePricingFieldDto } from './dto/create-pricing-field.dto';
import { UpdatePricingFieldDto } from './dto/update-pricing-field.dto';
import { PricingFieldType } from './entities/service-pricing-field.entity';

describe('pricing field customer explanation in unit_ar', () => {
  const base = {
    field_key: 'room_count',
    label_ar: 'عدد الغرف',
    field_type: PricingFieldType.NUMBER,
  };

  it('accepts 200 characters on create and update', () => {
    const unit_ar = 'ش'.repeat(200);
    expect(validateSync(plainToInstance(CreatePricingFieldDto, { ...base, unit_ar }))).toEqual([]);
    expect(validateSync(plainToInstance(UpdatePricingFieldDto, { unit_ar }))).toEqual([]);
  });

  it('rejects explanations over 200 characters', () => {
    const unit_ar = 'ش'.repeat(201);
    expect(validateSync(plainToInstance(CreatePricingFieldDto, { ...base, unit_ar }))).not.toEqual([]);
    expect(validateSync(plainToInstance(UpdatePricingFieldDto, { unit_ar }))).not.toEqual([]);
  });
});
