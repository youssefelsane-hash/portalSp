import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CreateRatingDto } from './dto/create-rating.dto';
import { toRatingResponseDto } from './dto/rating-response.dto';
import { RatingsService } from './ratings.service';

@Controller('technician/orders')
@Roles(UserType.TECHNICIAN)
export class TechnicianRatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Post(':id/rate')
  async rate(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRatingDto) {
    return toRatingResponseDto(await this.ratingsService.rateAsTechnician(user.sub, id, dto));
  }
}
