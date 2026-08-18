-- Script 2 Part F (finding #31) — getOrCreateSupportThread() كانت "search then create" بلا حماية
-- DB، فطلبين متزامنين من نفس العميل ممكن يعدّوا الاتنين على existing=null ويعملوا صفين خيط دعم.
-- فهرس فريد جزئي (بس لخيوط support_chat) يمنع التكرار على مستوى القاعدة، مش بس منطق التطبيق.
CREATE UNIQUE INDEX idx_chat_threads_one_support_thread_per_customer
  ON chat_threads (customer_id)
  WHERE thread_type = 'support_chat';
