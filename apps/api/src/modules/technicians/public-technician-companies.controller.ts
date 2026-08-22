import { Controller, Get, Inject } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { resolveAvatarUrl } from '../../common/storage/resolve-avatar-url';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { UserType } from '../auth/entities/user.entity';
import { toPublicCompanyResponseDto } from './dto/company-response.dto';
import { TechnicianCompaniesService } from './technician-companies.service';

// "اعتماد" (docs/06 §1.5) — العميل يتصفّح الشركات/الفرق النشطة عشان يحجز واحدة كاملة (بدل ما يسيب
// المطابقة التلقائية تختار)، عن طريق orders.requested_technician_company_id (0051). مقصور على
// الشركات النشطة بس، ومنفصل عن /admin/technician-companies (الإشراف، بيرجّع الكل نشطة أو لأ).
@Controller('technician-companies')
@Roles(UserType.CUSTOMER)
export class PublicTechnicianCompaniesController {
  constructor(
    private readonly companiesService: TechnicianCompaniesService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Get()
  async list() {
    const rows = await this.companiesService.listActiveForCustomers();
    return Promise.all(
      rows.map(async ({ company, branchCount, staffCount, ownerAvatarUrl, ownerAvatarStorageKey }) => {
        const avatarUrl = await resolveAvatarUrl(this.storage, ownerAvatarUrl, ownerAvatarStorageKey);
        return toPublicCompanyResponseDto(company, branchCount, staffCount, avatarUrl);
      }),
    );
  }
}
