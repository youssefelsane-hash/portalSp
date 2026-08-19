import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import '../../design/network_image_box.dart';
import 'catalog_navigation.dart';
import 'catalog_repository.dart';
import 'models.dart';

// Script 3 §6/§7 — نتيجة "قول لينا محتاج مساعدة في إيه؟" من HomeScreen. وصف طبيعي ("المياه
// بتنزل من تحت الحوض") بيوصل لخدمات مطابقة عبر aliases/substring (GET /services/search)، مش
// تصنيف AI. نفس navigateToServiceBooking المستخدمة في ServicesScreen — مفيش محرك حجز تاني.
class SearchResultsScreen extends StatefulWidget {
  final String initialQuery;

  const SearchResultsScreen({super.key, this.initialQuery = ''});

  @override
  State<SearchResultsScreen> createState() => _SearchResultsScreenState();
}

class _SearchResultsScreenState extends State<SearchResultsScreen> {
  final _repository = CatalogRepository();
  final _controller = TextEditingController();
  Timer? _debounce;
  List<CatalogService>? _results;
  String? _error;
  bool _searched = false;

  @override
  void initState() {
    super.initState();
    _controller.text = widget.initialQuery;
    if (widget.initialQuery.trim().length >= 2) _search(widget.initialQuery);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () => _search(value));
  }

  Future<void> _search(String value) async {
    final trimmed = value.trim();
    if (trimmed.length < 2) {
      if (mounted) setState(() => _results = null);
      return;
    }
    if (mounted) setState(() => _searched = true);
    try {
      final results = await _repository.searchServices(trimmed);
      if (mounted) {
        setState(() {
          _results = results;
          _error = null;
        });
      }
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
        appBar: AppBar(
          title: TextField(
            controller: _controller,
            autofocus: widget.initialQuery.isEmpty,
            textInputAction: TextInputAction.search,
            decoration: const InputDecoration(
              hintText: 'قول لينا محتاج مساعدة في إيه...',
              border: InputBorder.none,
            ),
            onChanged: _onChanged,
            onSubmitted: _search,
          ),
        ),
        body: !_searched
            ? const Center(
                child: EmptyState(icon: Icons.search, title: 'اكتب وصف مشكلتك (زي: "المياه بتنزل من تحت الحوض")'),
              )
            : _error != null
                ? Center(child: Text(_error!))
                : _results == null
                    ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
                    : _results!.isEmpty
                        ? const Center(
                            child: EmptyState(
                              icon: Icons.search_off,
                              title: 'مفيش خدمات مطابقة — جرّب توصيف مختلف أو تصفّح الفئات',
                            ),
                          )
                        : ListView.separated(
                            padding: const EdgeInsets.all(16),
                            itemCount: _results!.length,
                            separatorBuilder: (_, _) => const SizedBox(height: 8),
                            itemBuilder: (context, index) {
                              final service = _results![index];
                              return Card(
                                child: ListTile(
                                  leading: SizedBox(
                                    width: 56,
                                    height: 56,
                                    child: NetworkImageBox(
                                      imageUrl: service.iconUrl,
                                      placeholderIcon: Icons.build_outlined,
                                      aspectRatio: 1,
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                  ),
                                  title: Text(service.nameAr),
                                  subtitle: service.shortDescriptionAr != null ? Text(service.shortDescriptionAr!) : null,
                                  trailing: Text(
                                    service.pricingModel == 'formula' ? 'يُحسب حسب التفاصيل' : _formatEgp(service.basePriceCents),
                                    style: Theme.of(context).textTheme.titleMedium,
                                  ),
                                  onTap: () => navigateToServiceBooking(context, service),
                                ),
                              );
                            },
                          ),
      ),
    );
  }
}
