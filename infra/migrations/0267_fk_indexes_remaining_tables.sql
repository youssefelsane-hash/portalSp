-- تكملة تدقيق DB-1 — تعميم قاعدة «كل مفتاح أجنبي له فهرس» على باقي الجداول.
--
-- 0265 غطّت الجداول الساخنة اللي التدقيق حدّدها بالاسم. الحارس الجديد
-- (`scripts/check-db-hygiene.js`) كشف **119 مفتاح أجنبي تاني** بلا فهرس على باقي المخطّط.
--
-- **ليه بنغطّيهم كلهم بدل ما نفضل ننتقي**: تكلفة الفهرس على جدول قليل الكتابة ≈ صفر (المساحة
-- والصيانة بيتناسبوا مع عدد الصفوف والكتابات، مش مع وجود الفهرس نفسه). في المقابل، أي قايمة
-- استثناءات «الجداول الصغيرة» بتتآكل مع الوقت: جدول بيتحسب صغير النهارده بيكبر بعد سنة ومحدش
-- بيرجع يراجع القايمة. القاعدة المطلقة («كل FK أحادي العمود له فهرس») قابلة للفرض آليًا وبلا
-- أي حكم بشري يختلف عليه اتنين.
--
-- **الخطر اللي بيتغطّى**: Postgres مابيعملش فهرس تلقائي على الطرف المُشير، فحذف مستخدم واحد
-- بيعمل seq scan على **كل** جدول فيه `*_user_id` — وهما عشرات هنا.
--
-- الأعمدة اللي بتقبل NULL بتاخد فهرس جزئي (`WHERE ... IS NOT NULL`).
-- مش `CONCURRENTLY` لأن `migrate.js` بيلفّ كل ملف في transaction.

CREATE INDEX IF NOT EXISTS idx_academy_exam_attempts_recorded_by_user_id ON academy_exam_attempts(recorded_by_user_id) WHERE recorded_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_addresses_area_id ON addresses(area_id) WHERE area_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_addresses_city_id ON addresses(city_id) WHERE city_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_match_previews_address_id ON booking_match_previews(address_id);
CREATE INDEX IF NOT EXISTS idx_booking_match_previews_order_id ON booking_match_previews(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_match_previews_service_id ON booking_match_previews(service_id);
CREATE INDEX IF NOT EXISTS idx_booking_match_previews_technician_company_id ON booking_match_previews(technician_company_id) WHERE technician_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_match_previews_technician_id ON booking_match_previews(technician_id) WHERE technician_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_branding_assets_uploaded_by_user_id ON branding_assets(uploaded_by_user_id);
CREATE INDEX IF NOT EXISTS idx_buildings_city_id ON buildings(city_id) WHERE city_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_threads_technician_id ON chat_threads(technician_id) WHERE technician_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_complaint_attachments_uploaded_by_user_id ON complaint_attachments(uploaded_by_user_id);
CREATE INDEX IF NOT EXISTS idx_complaint_messages_sender_user_id ON complaint_messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_complaints_assigned_to_user_id ON complaints(assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_complaints_filed_by_user_id ON complaints(filed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_complaints_resolved_by_user_id ON complaints(resolved_by_user_id) WHERE resolved_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_favorite_technicians_technician_id ON customer_favorite_technicians(technician_id);
CREATE INDEX IF NOT EXISTS idx_customer_service_intents_service_id ON customer_service_intents(service_id);
CREATE INDEX IF NOT EXISTS idx_customer_warranties_plan_id ON customer_warranties(plan_id);
CREATE INDEX IF NOT EXISTS idx_customer_warranties_project_id ON customer_warranties(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_earnings_skill_policy_updated_by_user_id ON earnings_skill_policy(updated_by_user_id) WHERE updated_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employee_profiles_created_by_user_id ON employee_profiles(created_by_user_id) WHERE created_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_installment_application_documents_uploaded_by ON installment_application_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_installment_applications_payment_method_id ON installment_applications(payment_method_id) WHERE payment_method_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_installment_applications_plan_id ON installment_applications(plan_id);
CREATE INDEX IF NOT EXISTS idx_installment_applications_reviewed_by ON installment_applications(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_internal_messages_sender_user_id ON internal_messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_notification_campaign_sends_service_id ON notification_campaign_sends(service_id) WHERE service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notification_campaigns_category_id ON notification_campaigns(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notification_routing_rules_role_name ON notification_routing_rules(role_name);
CREATE INDEX IF NOT EXISTS idx_order_customer_notices_created_by_user_id ON order_customer_notices(created_by_user_id) WHERE created_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_earning_adjustments_created_by_user_id ON order_earning_adjustments(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_order_earning_adjustments_technician_id ON order_earning_adjustments(technician_id);
CREATE INDEX IF NOT EXISTS idx_order_internal_notes_author_user_id ON order_internal_notes(author_user_id);
CREATE INDEX IF NOT EXISTS idx_order_problem_image_uploads_claimed_order_id ON order_problem_image_uploads(claimed_order_id) WHERE claimed_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_problem_image_uploads_service_id ON order_problem_image_uploads(service_id);
CREATE INDEX IF NOT EXISTS idx_order_quotes_admin_decided_by_user_id ON order_quotes(admin_decided_by_user_id) WHERE admin_decided_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_quotes_customer_decided_by_user_id ON order_quotes(customer_decided_by_user_id) WHERE customer_decided_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_quotes_submitted_by_user_id ON order_quotes(submitted_by_user_id);
CREATE INDEX IF NOT EXISTS idx_order_reschedule_requests_proposed_slot_id ON order_reschedule_requests(proposed_slot_id);
CREATE INDEX IF NOT EXISTS idx_order_reschedule_requests_resolved_by_user_id ON order_reschedule_requests(resolved_by_user_id) WHERE resolved_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_team_members_added_by_admin_user_id ON order_team_members(added_by_admin_user_id) WHERE added_by_admin_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_team_members_added_by_technician_id ON order_team_members(added_by_technician_id) WHERE added_by_technician_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_team_members_technician_id ON order_team_members(technician_id);
CREATE INDEX IF NOT EXISTS idx_payment_policies_target_category_id ON payment_policies(target_category_id) WHERE target_category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_policies_target_service_id ON payment_policies(target_service_id) WHERE target_service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_policy_acceptances_policy_version_id ON payment_policy_acceptances(policy_version_id);
CREATE INDEX IF NOT EXISTS idx_payout_order_items_order_id ON payout_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payouts_reviewed_by_user_id ON payouts(reviewed_by_user_id) WHERE reviewed_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payouts_wallet_id ON payouts(wallet_id);
CREATE INDEX IF NOT EXISTS idx_pricing_field_uploads_claimed_order_id ON pricing_field_uploads(claimed_order_id) WHERE claimed_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pricing_field_uploads_field_id ON pricing_field_uploads(field_id);
CREATE INDEX IF NOT EXISTS idx_pricing_field_uploads_service_id ON pricing_field_uploads(service_id);
CREATE INDEX IF NOT EXISTS idx_project_comments_author_user_id ON project_comments(author_user_id);
CREATE INDEX IF NOT EXISTS idx_project_notification_outbox_actor_user_id ON project_notification_outbox(actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_notification_outbox_project_id ON project_notification_outbox(project_id);
CREATE INDEX IF NOT EXISTS idx_project_quotes_created_by ON project_quotes(created_by);
CREATE INDEX IF NOT EXISTS idx_project_quotes_proposed_company_id ON project_quotes(proposed_company_id) WHERE proposed_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_address_id ON projects(address_id);
CREATE INDEX IF NOT EXISTS idx_projects_assigned_company_id ON projects(assigned_company_id) WHERE assigned_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_city_id ON projects(city_id) WHERE city_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promo_code_usages_order_id ON promo_code_usages(order_id);
CREATE INDEX IF NOT EXISTS idx_promo_codes_created_by_user_id ON promo_codes(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_order_occurrences_order_id ON recurring_order_occurrences(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recurring_order_templates_address_id ON recurring_order_templates(address_id);
CREATE INDEX IF NOT EXISTS idx_recurring_order_templates_last_generated_order_id ON recurring_order_templates(last_generated_order_id) WHERE last_generated_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recurring_order_templates_requested_technician_company_id ON recurring_order_templates(requested_technician_company_id) WHERE requested_technician_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recurring_order_templates_requested_technician_id ON recurring_order_templates(requested_technician_id) WHERE requested_technician_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recurring_order_templates_service_id ON recurring_order_templates(service_id);
CREATE INDEX IF NOT EXISTS idx_referrals_reference_order_id ON referrals(reference_order_id) WHERE reference_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refund_settlement_reversals_order_id ON refund_settlement_reversals(order_id);
CREATE INDEX IF NOT EXISTS idx_refund_settlement_reversals_technician_id ON refund_settlement_reversals(technician_id) WHERE technician_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_security_event_notes_author_user_id ON security_event_notes(author_user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_acknowledged_by_user_id ON security_events(acknowledged_by_user_id) WHERE acknowledged_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_security_events_resolved_by_user_id ON security_events(resolved_by_user_id) WHERE resolved_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_security_events_session_id ON security_events(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_earnings_level_overrides_updated_by_user_id ON service_earnings_level_overrides(updated_by_user_id);
CREATE INDEX IF NOT EXISTS idx_service_earnings_skill_overrides_updated_by_user_id ON service_earnings_skill_overrides(updated_by_user_id);
CREATE INDEX IF NOT EXISTS idx_service_installment_plans_plan_id ON service_installment_plans(plan_id);
CREATE INDEX IF NOT EXISTS idx_service_pricing_rule_tests_created_by_admin_user_id ON service_pricing_rule_tests(created_by_admin_user_id) WHERE created_by_admin_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_productivity_actuals_recorded_by_user_id ON service_productivity_actuals(recorded_by_user_id) WHERE recorded_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_productivity_suggestions_reviewed_by_user_id ON service_productivity_suggestions(reviewed_by_user_id) WHERE reviewed_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_zone_pricing_service_zone_id ON service_zone_pricing(service_zone_id);
CREATE INDEX IF NOT EXISTS idx_settings_updated_by_user_id ON settings(updated_by_user_id) WHERE updated_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned_to_user_id ON support_tickets(assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_categories_reviewed_by_user_id ON technician_categories(reviewed_by_user_id) WHERE reviewed_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_certificates_reviewed_by_user_id ON technician_certificates(reviewed_by_user_id) WHERE reviewed_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_companies_trust_verified_by ON technician_companies(trust_verified_by) WHERE trust_verified_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_company_branches_area_id ON technician_company_branches(area_id) WHERE area_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_debt_settlements_recorded_by_user_id ON technician_debt_settlements(recorded_by_user_id);
CREATE INDEX IF NOT EXISTS idx_technician_debt_settlements_wallet_transaction_id ON technician_debt_settlements(wallet_transaction_id) WHERE wallet_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_documents_reviewed_by_user_id ON technician_documents(reviewed_by_user_id) WHERE reviewed_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_earning_adjustments_created_by_user_id ON technician_earning_adjustments(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_technician_earning_adjustments_service_id ON technician_earning_adjustments(service_id) WHERE service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_earning_adjustments_updated_by_user_id ON technician_earning_adjustments(updated_by_user_id);
CREATE INDEX IF NOT EXISTS idx_technician_excluded_services_excluded_by_user_id ON technician_excluded_services(excluded_by_user_id);
CREATE INDEX IF NOT EXISTS idx_technician_excluded_services_service_id ON technician_excluded_services(service_id);
CREATE INDEX IF NOT EXISTS idx_technician_internal_notes_author_user_id ON technician_internal_notes(author_user_id);
CREATE INDEX IF NOT EXISTS idx_technician_kpi_snapshots_approved_by_user_id ON technician_kpi_snapshots(approved_by_user_id) WHERE approved_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_level_history_changed_by_user_id ON technician_level_history(changed_by_user_id) WHERE changed_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_order_cancellations_cancellation_reason_id ON technician_order_cancellations(cancellation_reason_id);
CREATE INDEX IF NOT EXISTS idx_technician_order_cancellations_technician_user_id ON technician_order_cancellations(technician_user_id);
CREATE INDEX IF NOT EXISTS idx_technician_progression_status_admin_decision_by_user_id ON technician_progression_status(admin_decision_by_user_id) WHERE admin_decision_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_referral_bonuses_customer_user_id ON technician_referral_bonuses(customer_user_id);
CREATE INDEX IF NOT EXISTS idx_technician_referral_bonuses_wallet_credit_tx_id ON technician_referral_bonuses(wallet_credit_tx_id) WHERE wallet_credit_tx_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_referral_bonuses_wallet_debit_tx_id ON technician_referral_bonuses(wallet_debit_tx_id) WHERE wallet_debit_tx_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_services_reviewed_by_user_id ON technician_services(reviewed_by_user_id) WHERE reviewed_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_roles_assigned_by ON user_roles(assigned_by) WHERE assigned_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_users_referred_by_user_id ON users(referred_by_user_id) WHERE referred_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wallet_adjustments_target_user_id ON wallet_adjustments(target_user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_adjustments_wallet_credit_tx_id ON wallet_adjustments(wallet_credit_tx_id) WHERE wallet_credit_tx_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wallet_adjustments_wallet_debit_tx_id ON wallet_adjustments(wallet_debit_tx_id) WHERE wallet_debit_tx_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warranty_claims_customer_id ON warranty_claims(customer_id);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_order_id ON warranty_claims(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warranty_claims_original_provider_id ON warranty_claims(original_provider_id) WHERE original_provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warranty_claims_project_id ON warranty_claims(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warranty_claims_repair_order_id ON warranty_claims(repair_order_id) WHERE repair_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warranty_plans_target_category_id ON warranty_plans(target_category_id) WHERE target_category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warranty_plans_target_service_id ON warranty_plans(target_service_id) WHERE target_service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user_id ON webauthn_challenges(user_id) WHERE user_id IS NOT NULL;
