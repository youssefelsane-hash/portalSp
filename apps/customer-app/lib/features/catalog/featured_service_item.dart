import 'package:flutter/material.dart';

import 'models.dart';

const double _kFeaturedIconSize = 44;
const double _kFeaturedLabelGap = 6;
const double _kFeaturedLabelFontSize = 12;
const double _kFeaturedLabelLineHeight = 1.35;

double featuredRowHeight(BuildContext context) {
  final scaler = MediaQuery.textScalerOf(context);
  return _kFeaturedIconSize +
      _kFeaturedLabelGap +
      scaler.scale(_kFeaturedLabelFontSize) * _kFeaturedLabelLineHeight;
}

/// خدمة نهائية من «الأكثر طلبًا»؛ الضغط يبدأ حجزها مباشرة بدل فتح القسم العام.
class FeaturedServiceItem extends StatelessWidget {
  final CatalogService service;
  final VoidCallback onTap;

  const FeaturedServiceItem({
    super.key,
    required this.service,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final iconUrl = service.featuredCardIconUrl;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(
        width: 82,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox.square(
              dimension: _kFeaturedIconSize,
              child: iconUrl != null && iconUrl.isNotEmpty
                  ? ClipOval(
                      clipBehavior: Clip.antiAlias,
                      child: Image.network(
                        iconUrl,
                        fit: BoxFit.contain,
                        errorBuilder: (_, _, _) =>
                            _FeaturedInitial(service: service),
                      ),
                    )
                  : _FeaturedInitial(service: service),
            ),
            const SizedBox(height: _kFeaturedLabelGap),
            Flexible(
              child: Text(
                service.featuredCardName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  fontSize: _kFeaturedLabelFontSize,
                  height: _kFeaturedLabelLineHeight,
                  fontWeight: FontWeight.w500,
                  color: scheme.onSurface,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FeaturedInitial extends StatelessWidget {
  const _FeaturedInitial({required this.service});

  final CatalogService service;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.primary.withValues(alpha: 0.1),
        shape: BoxShape.circle,
      ),
      child: Center(
        child: Text(
          service.featuredCardName.characters.first,
          style: TextStyle(
            color: scheme.primary,
            fontWeight: FontWeight.bold,
            fontSize: 18,
          ),
        ),
      ),
    );
  }
}
