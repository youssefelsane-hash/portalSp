import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import 'catalog_repository.dart';
import 'models.dart';
import 'services_screen.dart';

class CategoriesScreen extends StatefulWidget {
  // هيكل الحجز الجديد (docs/06 §1) — الوضع اللي العميل اختاره في BookingModeScreen، بيتمرر
  // كامل لـ ServicesScreen عشان يفلتر GET /services?booking_mode=...
  final BookingMode bookingMode;

  const CategoriesScreen({super.key, required this.bookingMode});

  @override
  State<CategoriesScreen> createState() => _CategoriesScreenState();
}

class _CategoriesScreenState extends State<CategoriesScreen> {
  final _repository = CatalogRepository();
  List<ServiceCategory>? _categories;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final categories = await _repository.fetchCategories();
      if (mounted) setState(() => _categories = categories);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text(widget.bookingMode.labelAr)),
        body: _error != null
            ? Center(child: Text(_error!))
            : _categories == null
                ? const Center(child: CircularProgressIndicator())
                : _categories!.isEmpty
                    ? const Center(child: Text('مفيش فئات خدمات متاحة دلوقتي'))
                    : GridView.builder(
                        padding: const EdgeInsets.all(16),
                        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 2,
                          mainAxisSpacing: 12,
                          crossAxisSpacing: 12,
                          childAspectRatio: 1.2,
                        ),
                        itemCount: _categories!.length,
                        itemBuilder: (context, index) {
                          final category = _categories![index];
                          return Card(
                            child: InkWell(
                              onTap: () => Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => ServicesScreen(category: category, bookingMode: widget.bookingMode),
                                ),
                              ),
                              child: Center(
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Text(
                                    category.nameAr,
                                    textAlign: TextAlign.center,
                                    style: Theme.of(context).textTheme.titleMedium,
                                  ),
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
