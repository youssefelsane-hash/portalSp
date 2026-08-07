-- baytak — 0002: كل أنواع الـ ENUM المستخدمة في النظام
-- مرجع: docs/02-data-dictionary.md (كل الجداول)
-- ملاحظة: القيم المعلّم عليها "افتراضي" مش مذكورة بالتفصيل في القاموس الأصلي — راجعها مع
-- المنتج قبل تجميدها نهائياً. كل حاجة تانية منسوخة بالحرف من القاموس المعتمد.

CREATE TYPE user_type AS ENUM ('customer', 'technician', 'admin', 'partner');
CREATE TYPE device_platform AS ENUM ('ios', 'android', 'web');
CREATE TYPE otp_purpose AS ENUM ('login', 'register', 'reset_password', 'verify_phone');

CREATE TYPE gender_type AS ENUM ('male', 'female');
CREATE TYPE technician_level AS ENUM ('bronze', 'silver', 'gold', 'platinum');
CREATE TYPE technician_verification_status AS ENUM (
  'pending', 'documents_submitted', 'under_review', 'interview_scheduled',
  'test_passed', 'approved', 'rejected', 'suspended'
);
CREATE TYPE technician_document_type AS ENUM (
  'national_id_front', 'national_id_back', 'criminal_record',
  'professional_certificate', 'photo', 'driving_license', 'vehicle_license'
);
CREATE TYPE document_review_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE skill_level AS ENUM ('beginner', 'standard', 'expert');
CREATE TYPE technician_level_change_type AS ENUM ('promotion', 'demotion', 'manual_override');
CREATE TYPE customer_tier AS ENUM ('standard', 'silver', 'gold', 'vip');

CREATE TYPE pricing_model AS ENUM ('fixed', 'hourly', 'per_unit', 'inspection_then_quote');

CREATE TYPE order_type AS ENUM ('standard', 'emergency', 'scheduled', 'recurring', 'b2b');
CREATE TYPE order_status AS ENUM (
  'draft', 'pending_payment', 'searching_technician', 'technician_assigned',
  'accepted', 'technician_on_way', 'technician_arrived', 'in_progress',
  'awaiting_quote_approval', 'work_completed', 'awaiting_payment', 'completed',
  'cancelled_by_customer', 'cancelled_by_technician', 'cancelled_by_system',
  'expired', 'disputed', 'refunded'
);
CREATE TYPE order_payment_status AS ENUM (
  'unpaid', 'pending', 'paid', 'partially_refunded', 'refunded', 'failed'
);
CREATE TYPE payment_method AS ENUM ('cash', 'card', 'wallet', 'bank_transfer', 'corporate_credit');
CREATE TYPE order_change_source AS ENUM ('customer', 'technician', 'admin', 'system', 'webhook');
CREATE TYPE order_item_type AS ENUM ('service', 'addon', 'spare_part', 'extra_labor');
CREATE TYPE order_media_type AS ENUM (
  'before_photo', 'after_photo', 'problem_photo', 'receipt', 'signature', 'video'
);
CREATE TYPE order_assignment_status AS ENUM ('sent', 'viewed', 'accepted', 'rejected', 'timeout', 'cancelled');
CREATE TYPE cancellation_applies_to AS ENUM ('customer', 'technician', 'admin');
CREATE TYPE order_source_channel AS ENUM ('customer_app', 'web', 'call_center', 'b2b_portal', 'whatsapp');

CREATE TYPE wallet_owner_type AS ENUM ('customer', 'technician', 'partner', 'platform');
CREATE TYPE wallet_tx_direction AS ENUM ('credit', 'debit');
CREATE TYPE wallet_tx_type AS ENUM (
  'order_earning', 'commission_deduction', 'topup', 'withdrawal',
  'refund', 'penalty', 'bonus', 'referral_reward', 'adjustment'
);
CREATE TYPE payment_gateway_status AS ENUM (
  'pending', 'processing', 'succeeded', 'failed', 'cancelled', 'expired', 'refunded'
);
CREATE TYPE refund_type AS ENUM ('full', 'partial');
CREATE TYPE refund_method AS ENUM ('original_method', 'wallet_credit', 'cash');
CREATE TYPE refund_status AS ENUM ('pending', 'approved', 'processing', 'completed', 'rejected');
CREATE TYPE payout_method AS ENUM ('bank_transfer', 'vodafone_cash', 'instapay', 'cash');
CREATE TYPE payout_status AS ENUM (
  'requested', 'under_review', 'approved', 'processing', 'completed', 'rejected', 'failed'
);

CREATE TYPE rating_type AS ENUM ('customer_to_technician', 'technician_to_customer');

CREATE TYPE complaint_category AS ENUM (
  'poor_quality', 'late_arrival', 'no_show', 'overcharging', 'rude_behavior',
  'damage_to_property', 'incomplete_work', 'safety_concern', 'fraud', 'other'
);
CREATE TYPE complaint_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE complaint_status AS ENUM (
  'open', 'under_investigation', 'awaiting_customer', 'awaiting_technician',
  'resolved', 'rejected', 'escalated', 'closed'
);
CREATE TYPE complaint_resolution_type AS ENUM (
  'refund', 'redo_service', 'partial_refund', 'warning_issued', 'technician_suspended', 'no_action'
);
CREATE TYPE support_ticket_priority AS ENUM ('low', 'medium', 'high', 'urgent'); -- افتراضي
CREATE TYPE support_ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed'); -- افتراضي
CREATE TYPE support_channel AS ENUM ('app', 'phone', 'whatsapp', 'email');

CREATE TYPE chat_thread_type AS ENUM ('order_chat', 'support_chat');
CREATE TYPE chat_message_type AS ENUM ('text', 'image', 'location', 'system', 'quick_reply');

CREATE TYPE notification_channel AS ENUM ('push', 'sms', 'email', 'in_app', 'whatsapp');
CREATE TYPE notification_delivery_status AS ENUM ('queued', 'sent', 'delivered', 'failed', 'read');

CREATE TYPE discount_type AS ENUM ('percentage', 'fixed_amount', 'free_inspection');
CREATE TYPE loyalty_direction AS ENUM ('earn', 'redeem', 'expire');
CREATE TYPE loyalty_source AS ENUM ('order', 'referral', 'review', 'promotion', 'manual');

CREATE TYPE webhook_processing_status AS ENUM ('received', 'processing', 'processed', 'failed', 'ignored');

-- المرحلة 3 — المغاسل
CREATE TYPE laundry_partner_status AS ENUM ('pending', 'active', 'suspended', 'terminated'); -- افتراضي
CREATE TYPE laundry_dashboard_plan AS ENUM ('free', 'basic', 'pro');
CREATE TYPE laundry_order_status AS ENUM (
  'requested', 'picked_up', 'received_at_laundry', 'washing', 'drying',
  'ironing', 'ready', 'out_for_delivery', 'delivered'
);
CREATE TYPE laundry_item_service_type AS ENUM ('wash', 'dry_clean', 'iron_only', 'wash_and_iron');
CREATE TYPE laundry_item_status AS ENUM ('received', 'in_progress', 'ready', 'delivered', 'damaged'); -- افتراضي

-- المرحلة 4 — الشركات B2B
CREATE TYPE corporate_account_type AS ENUM ('company', 'compound', 'property_manager');
CREATE TYPE corporate_role AS ENUM ('admin', 'requester', 'approver', 'viewer');
CREATE TYPE corporate_property_type AS ENUM ('residential', 'commercial', 'mixed_use'); -- افتراضي
CREATE TYPE corporate_account_status AS ENUM ('active', 'suspended', 'terminated'); -- افتراضي
CREATE TYPE corporate_invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled'); -- افتراضي

-- المرحلة 5 — الذكاء الاصطناعي
CREATE TYPE ai_urgency_level AS ENUM ('low', 'medium', 'high', 'emergency'); -- افتراضي

-- المرحلة 7 — الاشتراكات
CREATE TYPE subscription_plan_type AS ENUM ('customer', 'technician');
CREATE TYPE billing_cycle AS ENUM ('monthly', 'quarterly', 'annual');
CREATE TYPE subscription_status AS ENUM ('active', 'paused', 'cancelled', 'expired'); -- افتراضي

-- المرحلة 8 — Home Management
CREATE TYPE home_property_type AS ENUM ('apartment', 'villa', 'duplex', 'studio', 'other'); -- افتراضي
CREATE TYPE home_appliance_condition AS ENUM ('excellent', 'good', 'fair', 'needs_repair', 'broken'); -- افتراضي
CREATE TYPE maintenance_recurrence_type AS ENUM ('fixed_interval', 'seasonal', 'manual'); -- افتراضي
CREATE TYPE home_document_type AS ENUM ('invoice', 'warranty', 'contract', 'manual', 'photo');
