import 'package:flutter/material.dart';

/// Keeps every configured hero image mounted so the next slide is decoded
/// before its opacity transition starts. Replacing a DecorationImage directly
/// briefly exposes the fallback while the new image is decoded.
class HeroImageCrossfade extends StatelessWidget {
  const HeroImageCrossfade({
    super.key,
    required this.images,
    required this.activeIndex,
    required this.fallback,
    this.duration = const Duration(milliseconds: 1000),
  });

  final List<ImageProvider<Object>> images;
  final int activeIndex;
  final Widget fallback;
  final Duration duration;

  @override
  Widget build(BuildContext context) {
    final normalizedIndex = images.isEmpty ? 0 : activeIndex % images.length;

    return Stack(
      fit: StackFit.expand,
      children: [
        fallback,
        for (var index = 0; index < images.length; index++)
          AnimatedOpacity(
            key: ValueKey('hero-image-$index'),
            opacity: index == normalizedIndex ? 1 : 0,
            duration: duration,
            curve: Curves.easeInOutCubic,
            child: Image(
              image: images[index],
              fit: BoxFit.cover,
              gaplessPlayback: true,
              excludeFromSemantics: true,
              errorBuilder: (_, _, _) => const SizedBox.expand(),
            ),
          ),
      ],
    );
  }
}
