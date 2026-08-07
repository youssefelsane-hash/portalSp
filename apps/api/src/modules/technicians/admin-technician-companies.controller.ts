import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import {
  toBranchResponseDto,
  toCompanyResponseDto,
  toStaffMemberResponseDto,
} from './dto/company-response.dto';
import { TechnicianCompaniesService } from './technician-companies.service';

// إشراف الأدمن على شركات/فرق الفنيين — read-only بالكامل عمداً، الإدارة نفسها ذاتية
// (owner/manager بتاعت كل شركة) زي أي أدمن يشوف كل حاجة (RolesGuard كفاية، مفيش @RequirePermission).
@Controller('admin/technician-companies')
@Roles(UserType.ADMIN)
export class AdminTechnicianCompaniesController {
  constructor(private readonly companiesService: TechnicianCompaniesService) {}

  @Get()
  async list() {
    const rows = await this.companiesService.listForAdmin();
    return rows.map(({ company, branchCount, staffCount }) => ({
      ...toCompanyResponseDto(company),
      branch_count: branchCount,
      staff_count: staffCount,
    }));
  }

  @Get(':id')
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    const detail = await this.companiesService.getDetail(id);
    return {
      company: toCompanyResponseDto(detail.company),
      branches: detail.branches.map(toBranchResponseDto),
      staff: detail.staff.map(({ profile, user }) => toStaffMemberResponseDto(profile, user.fullName)),
    };
  }
}
