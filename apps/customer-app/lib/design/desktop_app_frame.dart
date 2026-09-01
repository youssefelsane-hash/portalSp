import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

bool get isDesktopApp =>
    !kIsWeb &&
    (defaultTargetPlatform == TargetPlatform.macOS ||
        defaultTargetPlatform == TargetPlatform.windows ||
        defaultTargetPlatform == TargetPlatform.linux);

/// Keeps the native desktop build focused and readable instead of stretching mobile pages
/// across the full laptop window. Mobile and web layouts are left untouched.
class DesktopAppFrame extends StatelessWidget {
  const DesktopAppFrame({super.key, required this.child, this.maxWidth = 760});

  final Widget child;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    if (!isDesktopApp) return child;

    final scheme = Theme.of(context).colorScheme;
    return LayoutBuilder(
      builder: (context, constraints) => ColoredBox(
        color: scheme.surfaceContainerLowest,
        child: Center(
          child: Container(
            width: constraints.maxWidth.clamp(0.0, maxWidth).toDouble(),
            height: constraints.maxHeight,
            decoration: BoxDecoration(
              color: scheme.surface,
              boxShadow: [
                BoxShadow(
                  color: scheme.shadow.withValues(alpha: 0.12),
                  blurRadius: 28,
                ),
              ],
            ),
            clipBehavior: Clip.hardEdge,
            child: child,
          ),
        ),
      ),
    );
  }
}
