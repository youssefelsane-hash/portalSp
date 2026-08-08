import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { RateSupportTicketDto } from './dto/rate-support-ticket.dto';
import { toSupportTicketResponseDto } from './dto/support-ticket-response.dto';
import { SupportTicketsService } from './support-tickets.service';

// تذاكر الدعم العامة — مش مرتبطة بشكوى أو طلب بالضرورة (مثلاً: سؤال عن الفاتورة، مشكلة في التطبيق).
@Controller('support-tickets')
@Roles(UserType.CUSTOMER, UserType.TECHNICIAN)
export class SupportTicketsController {
  constructor(private readonly supportTicketsService: SupportTicketsService) {}

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSupportTicketDto) {
    return toSupportTicketResponseDto(await this.supportTicketsService.create(user, dto));
  }

  @Get()
  async listMine(@CurrentUser() user: JwtPayload) {
    const tickets = await this.supportTicketsService.listMine(user.sub);
    return tickets.map(toSupportTicketResponseDto);
  }

  @Get(':id')
  @Roles(UserType.CUSTOMER, UserType.TECHNICIAN, UserType.ADMIN)
  async getOne(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toSupportTicketResponseDto(await this.supportTicketsService.getForUser(user, id));
  }

  @Post(':id/satisfaction')
  async rate(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateSupportTicketDto,
  ) {
    return toSupportTicketResponseDto(await this.supportTicketsService.rate(user, id, dto));
  }
}
