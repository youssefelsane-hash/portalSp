import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Body, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
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

  @Patch(':id/review')
  async review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { status: string; resolution_notes?: string; rejection_reason?: string },
  ) {
    const claim = await this.claims.findOne({ where: { id } });
    if (!claim) throw new Error('المطالبة غير موجودة');
    claim.status = dto.status as never;
    if (dto.resolution_notes) claim.resolutionNotes = dto.resolution_notes;
    if (dto.rejection_reason) claim.rejectionReason = dto.rejection_reason;
    if (dto.status === 'resolved') claim.resolvedAt = new Date();
    if (dto.status === 'closed') claim.closedAt = new Date();
    await this.claims.save(claim);
    return claim;
  }
}
