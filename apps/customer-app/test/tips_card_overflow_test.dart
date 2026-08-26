// انحدار مثبّت (كونسول المالك 2026-08-26): `RenderFlex overflowed by 14 pixels on the bottom`
// بيترمي كل frame من كارت داخل قائمة. تتبّع الـpaint stack
// (sliver_multi_box_adaptor ← RepaintBoundary ← ConstrainedBox ← Card margin ← ClipPath ←
// _InkFeatures ← Material ← Flex) بيطابق كارت "نصايح مفيدة" في home_screen.dart: صندوق ارتفاعه
// ثابت 190، صورة بتاخد 80، والباقي عنوان سطرين + نص 3 سطور — أطول من الفاضل.
//
// الاختبار ده بيعيد نفس التركيب بالحرف بنص طويل حقيقي، والنسخة القديمة (Padding بدل Expanded،
// وText بدل Flexible) كانت بتوقّعه.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _longTitle = 'اغسل فلتر التكييف كل شهر عشان يفضل يبرّد كويس ويوفّر في الكهربا';
const _longBody =
    'الفلتر المتربّي بيخلّي الكمبروسر يشتغل أكتر من اللازم، فالفاتورة بتزيد والتبريد بيقل. '
    'نضّفه بميّه فاترة وسيبه ينشف كويس قبل ما ترجّعه، ومتشغّلش الجهاز وهو لسه مبلول.';

Widget _tipCard() => MaterialApp(
      locale: const Locale('ar', 'EG'),
      home: Scaffold(
        body: SizedBox(
          height: 190,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              SizedBox(
                width: 220,
                child: Card(
                  clipBehavior: Clip.antiAlias,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Container(height: 80, color: Colors.teal),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Text(_longTitle, maxLines: 2, overflow: TextOverflow.ellipsis),
                              const SizedBox(height: 4),
                              Flexible(
                                child: Text(
                                  _longBody,
                                  maxLines: 3,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(fontSize: 12),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );

void main() {
  testWidgets('كارت النصيحة مابيعملش overflow مع عنوان سطرين ونص 3 سطور', (tester) async {
    await tester.pumpWidget(_tipCard());
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.byType(ErrorWidget), findsNothing);
  });

  testWidgets('نفس الكارت بمقياس خط أكبر (تكبير النص من إعدادات الجهاز) برضه مابيعملش overflow',
      (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.6;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

    await tester.pumpWidget(_tipCard());
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.byType(ErrorWidget), findsNothing);
  });
}
