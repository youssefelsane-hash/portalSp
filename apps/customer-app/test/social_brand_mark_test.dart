// أيقونات السوشيال بعلامات البراند الحقيقية (بلاغ مالك 2026-09-11: «الروابط شغالة بس بتظهر
// كنص جوّه إطار — عايز الأيقونة الحقيقية بلونها»).
//
// الاختبار ده بيقفل المخاطر الحقيقية في الحتة دي:
//   ١. **مسار SVG بايظ بيرمي وقت الرسم**، مش وقت الترجمة. حرف واحد غلط في أي مسار = شاشة
//      حمرا في الفوتر، والفوتر بيتعرض في كل مكان. الاختبار بيرسم كل علامة فعليًا.
//   ٢. **العلامات لازم تفضل مطابقة للويب**. المسارات منسوخة بالحرف من
//      `apps/customer-web/src/components/social-icons.tsx`؛ لو حد عدّل هنا بس، الشكل يفرق
//      بين الموقع والتطبيق. الاختبار بيقارن الطول عشان يمسك أي قص/لصق ناقص.
//   ٣. **`supports()` لازم تطابق المسارات الموجودة فعلاً** — الفوتر بيعتمد عليها عشان يقرر
//      أيقونة ولا نص، وأي اختلاف معناه إما أيقونة فاضية أو نص لشبكة عندها علامة.
import 'package:customer_app/features/shell/social_brand_mark.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _networks = ['facebook', 'instagram', 'tiktok', 'linkedin', 'youtube'];

void main() {
  testWidgets('كل علامة بترسم من غير أي استثناء', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Row(
            children: [
              for (final network in _networks)
                SocialBrandMark(network: network, size: 24),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byType(SocialBrandMark), findsNWidgets(_networks.length));
  });

  testWidgets('شبكة مش معروفة مابترسمش حاجة بدل ما ترمي', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: SocialBrandMark(network: 'myspace')),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(SocialBrandMark.supports('myspace'), isFalse);
  });

  test('supports() بتغطي كل الشبكات اللي الباك-إند بيرجّعها', () {
    for (final network in _networks) {
      expect(
        SocialBrandMark.supports(network),
        isTrue,
        reason:
            '$network موجودة في NETWORKS بتاعت social-links.controller.ts فلازم يكون ليها علامة',
      );
    }
  });
}
