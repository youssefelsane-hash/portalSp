import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { TechniciansService } from '../technicians/technicians.service';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { CreateRatingDto } from './dto/create-rating.dto';
import { Rating, RatingType } from './entities/rating.entity';

@Injectable()
export class RatingsService {
  constructor(
    @InjectRepository(Rating) private readonly ratings: Repository<Rating>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
  ) {}

  /**
   * ملاحظة على تصميم القاموس: `ratings.order_id` UNIQUE — يعني تقييم واحد بس لكل طلب،
   * مش تقييمين (واحد من كل طرف). أول طرف يقيّم ياخد السلوت. ده قرار من docs/02-data-dictionary.md
   * §8.1 الأصلي، مش تبسيط مني — لو غلط لازم يتصحح بتحديث موثّق للقاموس، مش هنا بصمت.
   */
  async rateAsCustomer(userId: string, orderId: string, dto: CreateRatingDto): Promise<Rating> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, customerId: customerProfile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    if (!order.technicianId) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مالوش فني اتعيّن عليه', HttpStatus.BAD_REQUEST);
    }
    this.assertRatable(order);

    const technicianUserId = await this.technicianUserId(order.technicianId);
    return this.createRating(order.id, userId, technicianUserId, RatingType.CUSTOMER_TO_TECHNICIAN, dto);
  }

  async rateAsTechnician(userId: string, orderId: string, dto: CreateRatingDto): Promise<Rating> {
    const technicianProfile = await this.techniciansService.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, technicianId: technicianProfile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }
    this.assertRatable(order);

    const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(order.customerId);
    return this.createRating(order.id, userId, customerProfile.userId, RatingType.TECHNICIAN_TO_CUSTOMER, dto);
  }

  private assertRatable(order: Order): void {
    if (order.orderStatus !== OrderStatus.COMPLETED) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        'مينفعش تقيّم طلب لسه مخلصش (لازم يكون completed)',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async technicianUserId(technicianProfileId: string): Promise<string> {
    const profile = await this.techniciansService.findByProfileIdOrThrow(technicianProfileId);
    return profile.userId;
  }

  private async createRating(
    orderId: string,
    ratedByUserId: string,
    ratedUserId: string,
    ratingType: RatingType,
    dto: CreateRatingDto,
  ): Promise<Rating> {
    const existing = await this.ratings.findOne({ where: { orderId } });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب ده اتقيّم قبل كده', HttpStatus.CONFLICT);
    }

    const rating = this.ratings.create({
      orderId,
      ratedByUserId,
      ratedUserId,
      ratingType,
      overallRating: dto.overall_rating,
      punctualityRating: dto.punctuality_rating ?? null,
      qualityRating: dto.quality_rating ?? null,
      professionalismRating: dto.professionalism_rating ?? null,
      priceFairnessRating: dto.price_fairness_rating ?? null,
      comment: dto.comment ?? null,
      tags: dto.tags ?? null,
      isPublished: true,
    });

    try {
      await this.ratings.save(rating);
    } catch (err) {
      // سباق نادر: طلبين اتبعتوا بالتوازي بالظبط على نفس الطلب — الـ UNIQUE constraint في الداتابيز
      // هو خط الدفاع الأخير (الفحص فوق مش ذرّي)، فبنحوّل خطأ الداتابيز الخام لرسالة واضحة.
      if (this.isUniqueViolation(err)) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب ده اتقيّم قبل كده', HttpStatus.CONFLICT);
      }
      throw err;
    }

    return rating;
  }

  private isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
  }

  async listForOrder(orderId: string): Promise<Rating[]> {
    return this.ratings.find({ where: { orderId } });
  }
}
