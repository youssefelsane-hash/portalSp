import { Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import { toFavoriteTechnicianResponseDto } from './dto/favorite-technician-response.dto';
import { FavoritesService } from './favorites.service';

// المفضّلة (Favorites) — docs/10 بند 36. العميل بس، مفيش استخدام تاني حاليًا.
@Controller('me/favorites/technicians')
@Roles(UserType.CUSTOMER)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    const favorites = await this.favoritesService.listFavorites(user.sub);
    return favorites.map(toFavoriteTechnicianResponseDto);
  }

  @Get(':technicianId/status')
  async status(@CurrentUser() user: JwtPayload, @Param('technicianId', ParseUUIDPipe) technicianId: string) {
    return { is_favorited: await this.favoritesService.isFavorited(user.sub, technicianId) };
  }

  // مفيش 204 عمدًا — كل endpoint تاني في المشروع بيرجّع body دايمًا (envelope {success,data,...})،
  // وFlutter's apiRequest بيعمل jsonDecode بلا شرط على الـbody فهيفشل على body فاضي. رجوع
  // {is_favorited} بعد كل فعل كمان بيوفّر تأكيد فوري للواجهة بدل تخمين النتيجة.
  @Post(':technicianId')
  async add(@CurrentUser() user: JwtPayload, @Param('technicianId', ParseUUIDPipe) technicianId: string) {
    await this.favoritesService.addFavorite(user.sub, technicianId);
    return { is_favorited: true };
  }

  @Delete(':technicianId')
  async remove(@CurrentUser() user: JwtPayload, @Param('technicianId', ParseUUIDPipe) technicianId: string) {
    await this.favoritesService.removeFavorite(user.sub, technicianId);
    return { is_favorited: false };
  }
}
