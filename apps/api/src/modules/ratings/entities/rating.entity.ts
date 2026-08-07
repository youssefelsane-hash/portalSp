import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export enum RatingType {
  CUSTOMER_TO_TECHNICIAN = 'customer_to_technician',
  TECHNICIAN_TO_CUSTOMER = 'technician_to_customer',
}

@Entity('ratings')
export class Rating {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid', unique: true })
  orderId: string;

  @Column({ name: 'rated_by_user_id', type: 'uuid' })
  ratedByUserId: string;

  @Column({ name: 'rated_user_id', type: 'uuid' })
  ratedUserId: string;

  @Column({ name: 'rating_type', type: 'enum', enum: RatingType, enumName: 'rating_type' })
  ratingType: RatingType;

  @Column({ name: 'overall_rating', type: 'smallint' })
  overallRating: number;

  @Column({ name: 'punctuality_rating', type: 'smallint', nullable: true })
  punctualityRating: number | null;

  @Column({ name: 'quality_rating', type: 'smallint', nullable: true })
  qualityRating: number | null;

  @Column({ name: 'professionalism_rating', type: 'smallint', nullable: true })
  professionalismRating: number | null;

  @Column({ name: 'price_fairness_rating', type: 'smallint', nullable: true })
  priceFairnessRating: number | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ type: 'text', array: true, nullable: true })
  tags: string[] | null;

  @Column({ name: 'is_published', type: 'boolean', default: true })
  isPublished: boolean;

  @Column({ name: 'is_flagged', type: 'boolean', default: false })
  isFlagged: boolean;

  @Column({ name: 'flagged_reason', type: 'text', nullable: true })
  flaggedReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
