import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/design/app_theme.dart';
import 'package:customer_app/design/order_number_title.dart';

// docs/08 §77-A2 — **بلاغ مالك بلقطة من الجهاز**: «مكتوب بس ORD ومثلاً 2026 وثلاث أرقام
// والباقي مش ظاهر». الاختبارات دي بتقيس **العرض المرسوم فعليًا** مقابل العرض المتاح — مش
// بتتأكد إن الودجت موجودة. الفرق مهم: النسخة القديمة كانت "موجودة" وبتقصّ.
//
// **حد صريح للاختبارات دي (اتجرّب، مش افتراض)**: جرّبنا نكتب اختبار بيرسم الطريقة القديمة
// (`Text('طلب $number')` بخط عنوان الـAppBar) ويتأكد إنها **بتتقصّ** — فشل، لأن بيئة اختبار
// Flutter بتستخدم خط قياسي (Ahem) بمقاييس مختلفة عن خط الجهاز الحقيقي، والنص العربي «طلب»
// بياخد عرض مختلف. يعني **القصّ اللي المالك شافه ما ينفعش يتعاد إنتاجه في widget test**.
// الاختبارات تحت بتحرس الاتجاه التاني (النسخة الجديدة ما بتقصّش، ومقاسة بأضيق شاشة + أطول
// رقم يسمح به الـschema) — وده أقصى ضمان حقيقي متاح هنا. التأكيد النهائي كان بصريًا.
void main() {
  // أطول رقم ممكن حسب الـschema: `orders.order_number VARCHAR(24)`.
  const longestNumber = 'ORD-2026-000000000000001';

  Widget appBarWith(String? number, {double width = 360, double textScale = 1}) => MaterialApp(
        theme: AppTheme.light(),
        home: MediaQuery(
          data: MediaQueryData(size: Size(width, 800), textScaler: TextScaler.linear(textScale)),
          child: Directionality(
            textDirection: TextDirection.rtl,
            child: Scaffold(
              appBar: AppBar(
                title: OrderNumberTitle(orderNumber: number),
                // نفس عدد أيقونات الشاشة الحقيقية بالظبط — هي دي اللي بتاكل عرض العنوان.
                actions: const [
                  IconButton(icon: Icon(Icons.support_agent_outlined), onPressed: null),
                  IconButton(icon: Icon(Icons.report_problem_outlined), onPressed: null),
                ],
              ),
              body: const SizedBox.shrink(),
            ),
          ),
        ),
      );

  testWidgets('الرقم كامل بيتعرض — مش مقصوص بنقط', (tester) async {
    await tester.pumpWidget(appBarWith(longestNumber));
    await tester.pumpAndSettle();

    final numberFinder = find.text(longestNumber);
    expect(numberFinder, findsOneWidget);

    // القياس الحقيقي: عرض النص المرسوم لازم يسع كل الحروف. `didExceedMaxLines` بيبقى true
    // بالظبط لما `ellipsis` يشتغل — وده اللي المالك شافه.
    final paragraph = tester.renderObject<RenderParagraph>(numberFinder);
    expect(paragraph.didExceedMaxLines, isFalse,
        reason: 'الرقم اتقصّ — نفس البَقّة اللي المالك بلّغ عنها');
  });

  testWidgets('على أضيق شاشة موبايل شائعة (320px) الرقم لسه كامل', (tester) async {
    await tester.pumpWidget(appBarWith(longestNumber, width: 320));
    await tester.pumpAndSettle();
    final paragraph = tester.renderObject<RenderParagraph>(find.text(longestNumber));
    expect(paragraph.didExceedMaxLines, isFalse);
  });

  testWidgets('كلمة «طلب» بقت تسمية فوق، مش جزء من سطر الرقم', (tester) async {
    await tester.pumpWidget(appBarWith(longestNumber));
    await tester.pumpAndSettle();
    // لو رجعوا سطر واحد تاني، النص هيبقى «طلب ORD-…» ومفيش عنصر نصّه «طلب» لوحده.
    expect(find.text('طلب'), findsOneWidget);
    final labelBottom = tester.getBottomLeft(find.text('طلب')).dy;
    final numberTop = tester.getTopLeft(find.text(longestNumber)).dy;
    expect(numberTop, greaterThanOrEqualTo(labelBottom - 1));
  });

  testWidgets('قبل تحميل الطلب: عنوان بديل بدل عنوان ناقص', (tester) async {
    await tester.pumpWidget(appBarWith(null));
    await tester.pumpAndSettle();
    expect(find.text('تفاصيل الطلب'), findsOneWidget);
    expect(find.text('طلب'), findsNothing);
  });

  testWidgets('الضغط المطوّل بينسخ الرقم — الخطوة اللي بعد قراءته مباشرةً', (tester) async {
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map)['text'] as String?;
        }
        return null;
      },
    );
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null));

    await tester.pumpWidget(appBarWith(longestNumber));
    await tester.pumpAndSettle();
    await tester.longPress(find.text(longestNumber));
    await tester.pumpAndSettle();
    expect(copied, longestNumber);
  });
}
