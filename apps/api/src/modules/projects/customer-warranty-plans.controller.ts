import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';

@Controller('services/:serviceId/warranty-plans')
@Roles(UserType.CUSTOMER)
export class CustomerWarrantyPlansController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  async list(@Param('serviceId', ParseUUIDPipe) serviceId: string) {
    return this.dataSource.query(
      `SELECT wp.id, wp.name_ar, wp.warranty_type, wp.pricing_model,
              wp.price_value::float AS price_value, wp.coverage_months,
              wp.max_coverage_cents, wp.max_claims, wp.terms_ar, wp.exclusions_ar
       FROM warranty_plans wp
       JOIN services s ON s.id = $1
       WHERE wp.is_active = true
         AND wp.slug <> 'system-service-workmanship'
         AND (wp.target_service_id = s.id OR wp.target_category_id = s.category_id)
       ORDER BY wp.coverage_months ASC, wp.price_value ASC`,
      [serviceId],
    );
  }
}
