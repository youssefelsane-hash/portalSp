import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CreateRatingDto } from './dto/create-rating.dto';
import { toRatingResponseDto } from './dto/rating-response.dto';
import { RatingsService } from './ratings.service';

@Controller('orders')
@Roles(UserType.CUSTOMER)
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Post(':id/rate')
  async rate(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRatingDto) {
    return toRatingResponseDto(await this.ratingsService.rateAsCustomer(user.sub, id, dto));
  }
}
