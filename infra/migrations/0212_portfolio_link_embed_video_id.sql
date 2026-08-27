-- baytak — 0212: بَقّة حقيقية اتلقطت (docs/08 §81، بلاغ مالك) — فيديو تيك توك في معرض أعمال
-- الفني بيفشل يشتغل للعميل رغم إن الـthumbnail ظاهر صح. السبب: الباك-إند بيتبع short links
-- (redirects) فعليًا وقت جلب معاينة oEmbed، بس الكلاينت (customer-app) بيحاول يفكّ نفس اللينك
-- الخام بـregex محلي بلا أي نداء شبكة — بيفشل مع short links (vm.tiktok.com/...) اللي مفيهاش
-- /video/<رقم> صريح. الحل: نخزّن الـID الفعلي اللي oEmbed استخرجه بالفعل (embed_product_id —
-- حقل رسمي في رد oEmbed تيك توك) بدل ما نسيب الكلاينت يحاول يفكّ اللينك تاني من الصفر.
ALTER TABLE technician_portfolio_links ADD COLUMN embed_video_id TEXT NULL;
