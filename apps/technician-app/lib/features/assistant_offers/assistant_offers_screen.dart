import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'assistant_offers_repository.dart';
import 'models.dart';

// مطابقة المساعد التلقائية (ADR-0007) — كانت فجوة موثّقة صراحة: الباك-إند بيبث فرص المساعدة
// (أولوية 2، لما مفيش مساعد شخصي متاح) عبر GET /technician/assistant-offers/available بس
// مفيش شاشة كانت بتناديه، فالمساعد ميكنش يشوف الفرصة ولا يقبلها خالص. نفس نمط
// available_orders_screen.dart بالحرف، بس لفرص "شريحة مساعد" — أول قبول صحيح ياخدها.
class AssistantOffersScreen extends StatefulWidget {
  const AssistantOffersScreen({super.key});

  @override
  State<AssistantOffersScreen> createState() => _AssistantOffersScreenState();
}

class _AssistantOffersScreenState extends State<AssistantOffersScreen> {
  late final AssistantOffersRepository _repository;
  List<AssistantOffer>? _offers;
  String? _error;
  bool _isActing = false;

  @override
  void initState() {
    super.initState();
    _repository = AssistantOffersRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final offers = await _repository.fetchAvailable();
      if (mounted) setState(() => _offers = offers);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _accept(AssistantOffer offer) async {
    setState(() => _isActing = true);
    try {
      await _repository.accept(offer.offerId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('اتعيّنت مساعد على الطلب ده بنجاح')),
        );
      }
      await _load();
    } on ApiException catch (err) {
      // فرصة ضاعت لحد تاني (409) — رسالة واضحة، مش خطأ عام. نفس رسالة الباك-إند بالظبط.
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
      await _load();
    } finally {
      if (mounted) setState(() => _isActing = false);
    }
  }

  Future<void> _reject(AssistantOffer offer) async {
    setState(() => _isActing = true);
    try {
      await _repository.reject(offer.offerId);
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _isActing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('فرص المساعدة')),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _error != null
              ? Center(child: Text(_error!))
              : _offers == null
                  ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
                  : _offers!.isEmpty
                      ? ListView(
                          children: const [
                            SizedBox(height: 80),
                            EmptyState(icon: Icons.handshake_outlined, title: 'مفيش فرص مساعدة متاحة ليك دلوقتي'),
                          ],
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: _offers!.length,
                          separatorBuilder: (context, index) => const SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final offer = _offers![index];
                            return Card(
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(offer.serviceNameAr, style: Theme.of(context).textTheme.titleMedium),
                                    const SizedBox(height: 4),
                                    Text('${offer.streetName}${offer.landmark != null ? ' — ${offer.landmark}' : ''}'),
                                    if (offer.problemDescription != null) Text(offer.problemDescription!),
                                    const SizedBox(height: 4),
                                    Text(
                                      'أول واحد يقبل ياخد الفرصة — استعجل!',
                                      style: TextStyle(color: Theme.of(context).colorScheme.error, fontWeight: FontWeight.bold),
                                    ),
                                    const SizedBox(height: 8),
                                    Row(
                                      children: [
                                        FilledButton(
                                          onPressed: _isActing ? null : () => _accept(offer),
                                          child: const Text('قبول'),
                                        ),
                                        const SizedBox(width: 8),
                                        OutlinedButton(
                                          onPressed: _isActing ? null : () => _reject(offer),
                                          child: const Text('رفض'),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
        ),
      ),
    );
  }
}
