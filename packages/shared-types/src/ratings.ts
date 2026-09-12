export interface PendingCustomerRatingResponseDto {
  order_id: string;
  order_number: string;
  service_name_ar: string;
  technician_name: string;
  completed_at: string;
}
export interface OrderRatingResponseDto {
  id: string;
  order_id: string;
  rating_type: 'customer_to_technician' | 'technician_to_customer';
  overall_rating: number;
  punctuality_rating: number | null;
  quality_rating: number | null;
  professionalism_rating: number | null;
  price_fairness_rating: number | null;
  cleanliness_rating: number | null;
  comment: string | null;
  tags: string[] | null;
  created_at: string;
  after_photos: { id: string; file_url: string }[];
}
