import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AssistantMatchingService } from './assistant-matching.service';
import { toAssistantOfferResponseDto } from './dto/assistant-offer-response.dto';

// مطابقة المساعد التلقائية (ADR-0007) — نفس نمط technician-orders.controller.ts (matching)
// بالحرف، بس لفرص "شريحة مساعد" بدل "طلب كامل".
@Controller('technician/assistant-offers')
@Roles(UserType.TECHNICIAN)
export class AssistantOffersController {
  constructor(private readonly assistantMatchingService: AssistantMatchingService) {}

  @Get('available')
  async listAvailable(@CurrentUser() user: JwtPayload) {
    const rows = await this.assistantMatchingService.listAvailableForTechnician(user.sub);
    return rows.map(toAssistantOfferResponseDto);
  }

  @Post(':id/accept')
  async accept(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.assistantMatchingService.accept(user.sub, id);
    return null;
  }

  @Post(':id/reject')
  async reject(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.assistantMatchingService.reject(user.sub, id);
    return null;
  }
}
