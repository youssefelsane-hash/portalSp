import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CreateRecurringTemplateDto } from './dto/create-recurring-template.dto';
import { UpdateRecurringTemplateDto } from './dto/update-recurring-template.dto';
import { toRecurringTemplateResponseDto } from './dto/recurring-template-response.dto';
import { RecurringOrdersService } from './recurring-orders.service';

// الجدولة المستقبلية/المتكررة (docs/08 §11) — العميل بيدير قوالبه الخاصة بس.
@Controller('me/recurring-orders')
@Roles(UserType.CUSTOMER)
export class RecurringOrdersController {
  constructor(private readonly recurringOrdersService: RecurringOrdersService) {}

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateRecurringTemplateDto) {
    return toRecurringTemplateResponseDto(await this.recurringOrdersService.create(user.sub, dto));
  }

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    const templates = await this.recurringOrdersService.listForCustomer(user.sub);
    return templates.map(toRecurringTemplateResponseDto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringTemplateDto,
  ) {
    return toRecurringTemplateResponseDto(await this.recurringOrdersService.update(user.sub, id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.recurringOrdersService.remove(user.sub, id);
    return null;
  }
}
