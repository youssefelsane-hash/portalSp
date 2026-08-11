import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import '../orders/create_order_screen.dart';
import 'catalog_repository.dart';
import 'models.dart';

class ServicesScreen extends StatefulWidget {
  final ServiceCategory category;
  final BookingMode bookingMode;

  const ServicesScreen({super.key, required this.category, required this.bookingMode});

  @override
  State<ServicesScreen> createState() => _ServicesScreenState();
}

class _ServicesScreenState extends State<ServicesScreen> {
  final _repository = CatalogRepository();
  List<CatalogService>? _services;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final services = await _repository.fetchServices(
        categoryId: widget.category.id,
        bookingMode: widget.bookingMode,
      );
      if (mounted) setState(() => _services = services);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text(widget.category.nameAr)),
        body: _error != null
            ? Center(child: Text(_error!))
            : _services == null
                ? const Center(child: CircularProgressIndicator())
                : _services!.isEmpty
                    ? Center(child: Text('مفيش خدمات "${widget.bookingMode.labelAr}" في الفئة دي دلوقتي'))
                    : ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _services!.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final service = _services![index];
                          return Card(
                            child: ListTile(
                              title: Text(service.nameAr),
                              subtitle: service.shortDescriptionAr != null
                                  ? Text(service.shortDescriptionAr!)
                                  : null,
                              trailing: Text(
                                _formatEgp(service.basePriceCents),
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                              onTap: () => Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => CreateOrderScreen(service: service, bookingMode: widget.bookingMode),
                                ),
                              ),
                            ),
                          );
                        },
                      ),
      ),
    );
  }
}
