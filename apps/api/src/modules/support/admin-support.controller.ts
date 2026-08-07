import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { RejectComplaintDto, ResolveComplaintDto } from './dto/file-complaint.dto';
import { toComplaintResponseDto } from './dto/complaint-response.dto';
import { SupportService } from './support.service';

@Controller('admin/complaints')
@Roles(UserType.ADMIN)
export class AdminSupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get()
  async listAll() {
    const complaints = await this.supportService.listAllForAdmin();
    return complaints.map(toComplaintResponseDto);
  }

  @Post(':id/resolve')
  @RequirePermission('complaints.resolve')
  async resolve(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveComplaintDto,
  ) {
    return toComplaintResponseDto(await this.supportService.resolve(user.sub, id, dto));
  }

  @Post(':id/reject')
  @RequirePermission('complaints.resolve')
  async reject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectComplaintDto,
  ) {
    return toComplaintResponseDto(await this.supportService.reject(user.sub, id, dto));
  }

  @Post(':id/close')
  @RequirePermission('complaints.resolve')
  async close(@Param('id', ParseUUIDPipe) id: string) {
    return toComplaintResponseDto(await this.supportService.close(id));
  }
}
