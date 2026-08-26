import 'dart:convert';
import 'dart:typed_data';

import 'package:customer_app/features/catalog/hero_image_crossfade.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

final Uint8List _pixel = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);

Widget _subject({
  required int activeIndex,
  List<ImageProvider<Object>>? images,
}) => MaterialApp(
  home: SizedBox(
    width: 300,
    height: 180,
    child: HeroImageCrossfade(
      images: images ?? [MemoryImage(_pixel), MemoryImage(_pixel)],
      activeIndex: activeIndex,
      fallback: const ColoredBox(color: Colors.blue),
    ),
  ),
);

void main() {
  testWidgets(
    'كل الصور تفضل mounted والصورتان تعملان cross-fade بلا frame أزرق',
    (tester) async {
      await tester.pumpWidget(_subject(activeIndex: 0));
      await tester.pump();

      expect(find.byType(Image), findsNWidgets(2));
      expect(
        tester
            .widget<AnimatedOpacity>(find.byKey(const ValueKey('hero-image-0')))
            .opacity,
        1,
      );
      expect(
        tester
            .widget<AnimatedOpacity>(find.byKey(const ValueKey('hero-image-1')))
            .opacity,
        0,
      );

      await tester.pumpWidget(_subject(activeIndex: 1));
      await tester.pump(const Duration(milliseconds: 500));

      expect(find.byType(Image), findsNWidgets(2));
      final oldOpacity = tester.widget<FadeTransition>(
        find.descendant(
          of: find.byKey(const ValueKey('hero-image-0')),
          matching: find.byType(FadeTransition),
        ),
      );
      final newOpacity = tester.widget<FadeTransition>(
        find.descendant(
          of: find.byKey(const ValueKey('hero-image-1')),
          matching: find.byType(FadeTransition),
        ),
      );
      expect(oldOpacity.opacity.value, greaterThan(0));
      expect(newOpacity.opacity.value, greaterThan(0));
    },
  );

  testWidgets('الصورة التالفة تعرض fallback ولا ترمي استثناء', (tester) async {
    await tester.pumpWidget(
      _subject(
        activeIndex: 0,
        images: [
          MemoryImage(Uint8List.fromList([1, 2, 3])),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.byWidgetPredicate(
        (widget) => widget is ColoredBox && widget.color == Colors.blue,
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
