// انحدار مثبّت (بلاغ مالك 2026-08-25): "شاشة حمرا ظهرت في التطبيقين بعد اللوجن على طول".
// الشاشة الحمرا = `ErrorWidget` بتاع Flutter (`RenderErrorBox` بيرسم أحمر داكن) — يعني استثناء
// وقت البناء. السبب كان `tooltip:` على الزرار العايم: `Tooltip` بيحتاج `Overlay` جدّ، والزرار
// متركّب في `MaterialApp.builder` جنب `child` يعني **بره الـNavigator** فمفيش Overlay فوقه.
//
// الاختبار ده بيعيد نفس التركيب بالحرف (Stack جوّه builder، بلا Overlay) ويتأكد إن البناء
// مابيرميش. أي ويدجت تتضاف هناك بعد كده وبتحتاج Overlay هتوقّع الاختبار ده فورًا.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('الزرار العايم بيتبني بلا استثناء وهو بره الـNavigator (مفيش Overlay)', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('ar', 'EG'),
        builder: (context, child) => Stack(
          children: [
            child ?? const SizedBox.shrink(),
            // نفس تركيب main.dart بالحرف.
            PositionedDirectional(
              end: 16,
              bottom: 88,
              child: Semantics(
                label: '3 إشعارات غير مقروءة',
                button: true,
                child: const FloatingActionButton.small(
                  heroTag: 'global-unread-notifications',
                  onPressed: null,
                  child: Badge(
                    label: Text('3'),
                    child: Icon(Icons.mark_unread_chat_alt_outlined),
                  ),
                ),
              ),
            ),
          ],
        ),
        home: const Scaffold(body: Text('شاشة بعد اللوجن')),
      ),
    );
    await tester.pump();

    expect(tester.takeException(), isNull);
    // ErrorWidget ما اترسمش — يعني مفيش شاشة حمرا.
    expect(find.byType(ErrorWidget), findsNothing);
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });

  testWidgets('حارس: Tooltip في نفس المكان بيرمي — ده اللي كان بيعمل الشاشة الحمرا', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('ar', 'EG'),
        builder: (context, child) => Stack(
          children: [
            child ?? const SizedBox.shrink(),
            const PositionedDirectional(
              end: 16,
              bottom: 88,
              child: FloatingActionButton.small(
                heroTag: 'with-tooltip',
                onPressed: null,
                tooltip: 'رسائل وإشعارات جديدة',
                child: Icon(Icons.mark_unread_chat_alt_outlined),
              ),
            ),
          ],
        ),
        home: const Scaffold(body: Text('شاشة بعد اللوجن')),
      ),
    );
    await tester.pump();

    // بيوثّق السبب الجذري صراحة: أي حاجة محتاجة Overlay في المكان ده بترمي.
    expect(tester.takeException().toString(), contains('Overlay'));
  });
}
