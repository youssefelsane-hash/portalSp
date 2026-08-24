import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WarrantyClaim } from '../projects/entities/warranty-entities';

@Controller('admin/warranty-claims')
@Roles(UserType.ADMIN)
export class AdminWarrantyClaimsController {
  constructor(
    @InjectRepository(WarrantyClaim) private readonly claims: Repository<WarrantyClaim>,
  ) {}

  @Get()
  async list(@Query('status') status?: string) {
    const where = status && status !== 'all' ? { status } : {};
    return { items: await this.claims.find({ where, order: { createdAt: 'DESC' } }) };
  }
}
