import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { TechniciansService } from './technicians.service';
import { toTechnicianProfileResponseDto } from './dto/technician-profile-response.dto';

@Controller('technician')
@Roles(UserType.TECHNICIAN)
export class TechniciansController {
  constructor(private readonly techniciansService: TechniciansService) {}

  @Get('me')
  async getMe(@CurrentUser() user: JwtPayload) {
    return toTechnicianProfileResponseDto(await this.techniciansService.findByUserId(user.sub));
  }

  @Get('level')
  async getLevel(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserId(user.sub);
    return { current_level: profile.currentLevel, quality_score: Number(profile.qualityScore) };
  }
}
