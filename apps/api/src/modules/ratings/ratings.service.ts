import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { LOW_RATING_SUBMITTED_EVENT, LowRatingSubmittedEvent } from '../../common/events/low-rating-submitted.event';
import { RATING_SUBMITTED_EVENT, RatingSubmittedEvent } from '../../common/events/rating-submitted.event';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CustomerStatsService } from '../customers/customer-stats.service';
import { SettingsService } from '../settings/settings.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianStatsService } from '../technicians/technician-stats.service';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { OrderMedia, OrderMediaType } from '../orders/entities/order-media.entity';
import { CreateRatingDto } from './dto/create-rating.dto';
import { Rating, RatingType } from './entities/rating.entity';

@Injectable()
export class RatingsService {
  constructor(
    @InjectRepository(Rating) private readonly ratings: Repository<Rating>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderMedia) private readonly orderMedia: Repository<OrderMedia>,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly technicianStatsService: TechnicianStatsService,
    private readonly customerStatsService: CustomerStatsService,
    private readonly settingsService: SettingsService,
    private readonly events: EventEmitter2,
  ) {}

  // عتبة "تقييم منخفض" — قرار تشغيلي معقول (1-2 من 5 = سلبي، مش قيمة من القاموس نفسه لأنه
  // مالوش رقم محدد لده) — مختلف عن سعر صرف نقاط الولاء اللي فعلاً قرار مالي محتاج اعتماد رسمي.
  private static readonly LOW_RATING_THRESHOLD = 2;

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

    // ربط صور "بعد التنفيذ" مباشرة بالتقييم ده (docs/08 §9) — بيتفحص الأول قبل إنشاء الرايتنج
    // (fail fast، مش رايتنج ناقص بسبب صور غلط) — لازم تكون بتاعة نفس الطلب ونفس النوع
    // (after_photo)، وإلا العميل يقدر يربط صور طلب تاني بتقييمه (ثغرة بيانات مش أمنية، بس فحص
    // واضح أحسن من صمت).
    const photoIds = dto.after_photo_media_ids ?? [];
    if (photoIds.length > 0) {
      const photosCount = await this.orderMedia.count({
        where: { id: In(photoIds), orderId: order.id, mediaType: OrderMediaType.AFTER_PHOTO },
      });
      if (photosCount !== photoIds.length) {
        throw new ApiException(ErrorCode.VAL_001, 'صورة واحدة أو أكتر مش موجودة لهذا الطلب', HttpStatus.BAD_REQUEST);
      }
    }

    const technicianUserId = await this.technicianUserId(order.technicianId);
    const rating = await this.createRating(order.id, userId, technicianUserId, RatingType.CUSTOMER_TO_TECHNICIAN, dto);

    if (photoIds.length > 0) {
      await this.orderMedia.update({ id: In(photoIds) }, { ratingId: rating.id });
    }

    // مهمة خلفية (§14.4) — average_rating/total_ratings_count (الفني اللي اتقيّم) وaverage_rating_given
    // (العميل اللي قيّم) بتتحدّثوا هنا مش جوّه معاملة التقييم — الاتنين بره الـtransaction بنفس الفلسفة.
    await this.technicianStatsService.enqueueRecalculation(order.technicianId, order.serviceId);
    await this.customerStatsService.enqueueRecalculation(customerProfile.id);

    if (rating.overallRating <= RatingsService.LOW_RATING_THRESHOLD) {
      this.events.emit(
        LOW_RATING_SUBMITTED_EVENT,
        new LowRatingSubmittedEvent(rating.id, order.id, rating.overallRating, technicianUserId, rating.comment),
      );
    }

    return rating;
  }

  /**
   * طلب مراجعة Google (docs/10 بند 40) — بس بعد تقييم عميل عالي (>= الحد الأدنى القابل للتعديل)،
   * وبس لو رابط المراجعة اتحط فعلاً من الأدمن. عمداً بعد تقييم الفني (customer_to_technician)
   * بس، مش بعد تقييم الفني للعميل — العميل هو اللي المفروض يقيّم المنصة على Google، مش العكس.
   */
  async getGoogleReviewPrompt(rating: Rating): Promise<{ shouldPrompt: boolean; reviewUrl: string | null }> {
    if (rating.ratingType !== RatingType.CUSTOMER_TO_TECHNICIAN) {
      return { shouldPrompt: false, reviewUrl: null };
    }
    const reviewUrl = await this.settingsService.getString('reviews.google_review_url', '');
    if (!reviewUrl) {
      return { shouldPrompt: false, reviewUrl: null };
    }
    const minRating = await this.settingsService.getNumber('reviews.min_rating_for_google_prompt', 4);
    if (rating.overallRating < minRating) {
      return { shouldPrompt: false, reviewUrl: null };
    }
    return { shouldPrompt: true, reviewUrl };
  }

  async rateAsTechnician(userId: string, orderId: string, dto: CreateRatingDto): Promise<Rating> {
    const technicianProfile = await this.techniciansService.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, technicianId: technicianProfile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }
    this.assertRatable(order);

    const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(order.customerId);
    // مفيش تحديث إحصائيات هنا عمداً — customer_profiles.average_rating_given معناها "متوسط
    // التقييمات اللي العميل *أعطاها* لفنيين"، مش اللي استقبلها. التقييم ده (technician_to_customer)
    // مالوش عمود مقابل على customer_profiles أصلاً (زي ما average_rating على technician_profiles
    // بالظبط بيتحدّث بس من رايتنجات العميل للفني، مش العكس).
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
      cleanlinessRating: dto.cleanliness_rating ?? null,
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

    // إشعار مباشر للطرف اللي اتقيّم — مستقل عن rating.low_rating_submitted (ده بيتصدر بس لو التقييم
    // منخفض، ومُوجّه لدور support_agent مش للطرف نفسه). بيتصدر لكل تقييم، مش بس تقييمات العميل للفني.
    this.events.emit(
      RATING_SUBMITTED_EVENT,
      new RatingSubmittedEvent(rating.id, orderId, ratingType, rating.overallRating, ratedUserId),
    );

    return rating;
  }

  private isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
  }

  async listForOrder(orderId: string): Promise<Rating[]> {
    return this.ratings.find({ where: { orderId } });
  }

  /** صور "بعد التنفيذ" المربوطة بتقييم معيّن (docs/08 §9) — مستخدمة في toRatingResponseDto. */
  async getAfterPhotosForRating(ratingId: string): Promise<{ id: string; fileUrl: string }[]> {
    const photos = await this.orderMedia.find({ where: { ratingId }, order: { createdAt: 'ASC' } });
    return photos.map((p) => ({ id: p.id, fileUrl: p.fileUrl }));
  }
}
