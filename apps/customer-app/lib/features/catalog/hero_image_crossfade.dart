import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Keeps every configured hero image mounted so the next slide is decoded
/// before its opacity transition starts. Replacing a DecorationImage directly
/// briefly exposes the fallback while the new image is decoded.
class HeroImageCrossfade extends StatefulWidget {
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
  State<HeroImageCrossfade> createState() => _HeroImageCrossfadeState();
}

class _HeroImageCrossfadeState extends State<HeroImageCrossfade>
    with AutomaticKeepAliveClientMixin {
  final Set<int> _loadedIndices = <int>{};
  final Set<int> _pendingLoadedIndices = <int>{};
  final Map<int, ImageStream> _imageStreams = <int, ImageStream>{};
  final Map<int, ImageStreamListener> _imageListeners =
      <int, ImageStreamListener>{};
  int? _visibleIndex;

  int get _targetIndex =>
      widget.images.isEmpty ? 0 : widget.activeIndex % widget.images.length;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _replaceImageListeners();
  }

  @override
  void didUpdateWidget(covariant HeroImageCrossfade oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!listEquals(oldWidget.images, widget.images)) {
      _loadedIndices.clear();
      _pendingLoadedIndices.clear();
      _visibleIndex = null;
      _replaceImageListeners();
    } else if (_loadedIndices.contains(_targetIndex)) {
      _visibleIndex = _targetIndex;
    }
  }

  void _replaceImageListeners() {
    _removeImageListeners();
    final configuration = createLocalImageConfiguration(context);
    for (var index = 0; index < widget.images.length; index++) {
      final stream = widget.images[index].resolve(configuration);
      final listener = ImageStreamListener(
        (_, _) => _scheduleLoaded(index),
        onError: (_, _) {},
      );
      _imageStreams[index] = stream;
      _imageListeners[index] = listener;
      stream.addListener(listener);
    }
  }

  void _removeImageListeners() {
    for (final entry in _imageStreams.entries) {
      final listener = _imageListeners[entry.key];
      if (listener != null) entry.value.removeListener(listener);
    }
    _imageStreams.clear();
    _imageListeners.clear();
  }

  void _scheduleLoaded(int index) {
    if (_loadedIndices.contains(index) || !_pendingLoadedIndices.add(index)) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _pendingLoadedIndices.remove(index);
      if (!mounted || index >= widget.images.length) return;
      setState(() {
        _loadedIndices.add(index);
        if (_visibleIndex == null || index == _targetIndex) {
          _visibleIndex = index;
        }
      });
    });
  }

  @override
  bool get wantKeepAlive => true;

  @override
  void dispose() {
    _removeImageListeners();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final targetIndex = _targetIndex;
    final visibleIndex = _loadedIndices.contains(targetIndex)
        ? targetIndex
        : _visibleIndex;
    final displayIndex = visibleIndex ?? targetIndex;

    return Stack(
      fit: StackFit.expand,
      children: [
        AnimatedOpacity(
          key: const ValueKey('hero-fallback'),
          opacity: visibleIndex == null ? 1 : 0,
          duration: const Duration(milliseconds: 350),
          curve: Curves.easeOutCubic,
          child: widget.fallback,
        ),
        for (var index = 0; index < widget.images.length; index++)
          AnimatedOpacity(
            key: ValueKey('hero-image-$index'),
            opacity: index == displayIndex ? 1 : 0,
            duration: widget.duration,
            curve: Curves.easeInOutCubic,
            child: Image(
              image: widget.images[index],
              fit: BoxFit.cover,
              gaplessPlayback: true,
              filterQuality: FilterQuality.medium,
              excludeFromSemantics: true,
              errorBuilder: (_, _, _) => const SizedBox.expand(),
            ),
          ),
      ],
    );
  }
}
