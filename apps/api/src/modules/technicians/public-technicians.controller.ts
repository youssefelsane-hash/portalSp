import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { toPublicTechnicianProfileResponseDto } from './dto/public-technician-profile-response.dto';
import { TechniciansService } from './technicians.service';

// بروفايل الفني العام — العميل يشوفه قبل الحجز (تصفّح) أو بعده (إعادة حجز/مراجعة). منفصل عن
// GET /technician/me (خاص بالفني نفسه) وعن /admin/technicians/:id (إدارة). راجع technicians/README.md.
@Controller('technicians')
@Roles(UserType.CUSTOMER)
export class PublicTechniciansController {
  constructor(private readonly techniciansService: TechniciansService) {}

  @Get(':id/profile')
  async getPublicProfile(@Param('id', ParseUUIDPipe) id: string) {
    return toPublicTechnicianProfileResponseDto(await this.techniciansService.getPublicProfile(id));
  }
}
