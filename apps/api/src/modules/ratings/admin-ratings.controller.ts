import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { toRatingResponseDto } from './dto/rating-response.dto';
import { RatingsService } from './ratings.service';

@Controller('admin/orders')
@Roles(UserType.ADMIN)
export class AdminRatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Get(':id/ratings')
  @RequirePermission('orders.view')
  async list(@Param('id', ParseUUIDPipe) id: string) {
    return Promise.all(
      (await this.ratingsService.listForOrder(id)).map(async (rating) =>
        toRatingResponseDto(rating, await this.ratingsService.getAfterPhotosForRating(rating.id)),
      ),
    );
  }
}
