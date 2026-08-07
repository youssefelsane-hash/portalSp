import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { TechniciansService } from './technicians.service';
import { toTechnicianProfileResponseDto } from './dto/technician-profile-response.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Controller('technician')
@Roles(UserType.TECHNICIAN)
export class TechniciansController {
  constructor(private readonly techniciansService: TechniciansService) {}

  @Get('me')
  async getMe(@CurrentUser() user: JwtPayload) {
    return toTechnicianProfileResponseDto(await this.techniciansService.findByUserIdOrThrow(user.sub));
  }

  @Get('level')
  async getLevel(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    return { current_level: profile.currentLevel, quality_score: Number(profile.qualityScore) };
  }

  @Patch('availability')
  async updateAvailability(@CurrentUser() user: JwtPayload, @Body() dto: UpdateAvailabilityDto) {
    return toTechnicianProfileResponseDto(await this.techniciansService.updateAvailability(user.sub, dto));
  }

  @Post('location')
  @HttpCode(HttpStatus.OK)
  async updateLocation(@CurrentUser() user: JwtPayload, @Body() dto: UpdateLocationDto) {
    await this.techniciansService.updateLocation(user.sub, dto);
    return null;
  }
}
