import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { GeoService } from './geo.service';
import { toAreaResponseDto, toCityResponseDto } from './dto/city-response.dto';

@Controller()
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  @Public()
  @Get('cities')
  async listCities() {
    const cities = await this.geoService.findActiveCities();
    return cities.map(toCityResponseDto);
  }

  @Public()
  @Get('cities/:cityId/areas')
  async listAreas(@Param('cityId', ParseUUIDPipe) cityId: string) {
    const areas = await this.geoService.findLaunchedAreas(cityId);
    return areas.map(toAreaResponseDto);
  }
}
