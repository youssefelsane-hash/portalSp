import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { toOrderResponseDto } from '../orders/dto/order-response.dto';
import { MatchingService } from './matching.service';
import { RejectAssignmentDto } from './dto/reject-assignment.dto';

@Controller('technician/orders')
@Roles(UserType.TECHNICIAN)
export class TechnicianOrdersController {
  constructor(private readonly matchingService: MatchingService) {}

  @Get('available')
  listAvailable(@CurrentUser() user: JwtPayload) {
    return this.matchingService.listAvailableForTechnician(user.sub);
  }

  @Post(':id/accept')
  async accept(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toOrderResponseDto(await this.matchingService.accept(user.sub, id));
  }

  @Post(':id/reject')
  async reject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectAssignmentDto,
  ) {
    await this.matchingService.reject(user.sub, id, dto.reason_code);
    return null;
  }
}
