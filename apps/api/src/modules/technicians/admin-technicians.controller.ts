import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdminTechniciansService } from './admin-technicians.service';
import { toAdminTechnicianDetailResponseDto, toAdminTechnicianResponseDto } from './dto/admin-technician-response.dto';
import { ChangeTechnicianLevelDto } from './dto/change-technician-level.dto';
import { ListTechniciansQueryDto } from './dto/list-technicians-query.dto';
import { RejectTechnicianDto } from './dto/reject-technician.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { toTechnicianDocumentResponseDto } from './dto/technician-document-response.dto';

@Controller('admin/technicians')
@Roles(UserType.ADMIN)
export class AdminTechniciansController {
  constructor(private readonly adminTechniciansService: AdminTechniciansService) {}

  @Get()
  async list(@Query() query: ListTechniciansQueryDto) {
    const { items, meta } = await this.adminTechniciansService.list(query);
    return { items: items.map(({ profile, user }) => toAdminTechnicianResponseDto(profile, user)), meta };
  }

  @Get(':id')
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    const { profile, user, documents } = await this.adminTechniciansService.getDetail(id);
    return toAdminTechnicianDetailResponseDto(profile, user, documents);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async approve(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    const { profile, user } = await this.adminTechniciansService.approve(admin.sub, id, audit);
    return toAdminTechnicianResponseDto(profile, user);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async reject(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTechnicianDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const { profile, user } = await this.adminTechniciansService.reject(admin.sub, id, dto.reason, audit);
    return toAdminTechnicianResponseDto(profile, user);
  }

  @Patch(':id/level')
  @RequirePermission('technicians.approve')
  async changeLevel(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeTechnicianLevelDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const { profile, user } = await this.adminTechniciansService.changeLevel(admin.sub, id, dto, audit);
    return toAdminTechnicianResponseDto(profile, user);
  }

  @Post(':id/documents/:documentId/review')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.review_documents')
  async reviewDocument(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: ReviewDocumentDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const document = await this.adminTechniciansService.reviewDocument(admin.sub, id, documentId, dto, audit);
    return toTechnicianDocumentResponseDto(document);
  }
}
