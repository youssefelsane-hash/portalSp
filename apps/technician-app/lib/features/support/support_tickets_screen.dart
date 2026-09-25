import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'create_support_ticket_screen.dart';
import 'models.dart';
import 'support_repository.dart';

/// **تذاكر دعم الفني** — كانت فجوة: الباك-إند بيدي الفني نفس حقوق العميل بالظبط
/// (`@Roles(CUSTOMER, TECHNICIAN)` على `support-tickets`)، وتطبيق الفني مكانش فيه غير
/// **الشكاوى** — وهي حاجة تانية: الشكوى على **طلب بعينه**، والتذكرة لأي حاجة تانية.
class SupportTicketsScreen extends StatefulWidget {
  const SupportTicketsScreen({super.key});

  @override
  State<SupportTicketsScreen> createState() => _SupportTicketsScreenState();
}

class _SupportTicketsScreenState extends State<SupportTicketsScreen> {
  late final SupportRepository _repository;
  List<SupportTicket>? _tickets;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = SupportRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final tickets = await _repository.listTickets();
      if (mounted) setState(() => _tickets = tickets);
    } catch (error) {
      if (mounted) {
        setState(() => _error = ApiException.from(error).displayMessage);
      }
    }
  }

  Future<void> _createTicket() async {
    final ticket = await Navigator.of(context).push<SupportTicket>(
      MaterialPageRoute(builder: (_) => const CreateSupportTicketScreen()),
    );
    if (ticket == null || !mounted) return;
    await _load();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('اتفتحت تذكرتك رقم ${ticket.ticketNumber}. الدعم هيتابعها معاك.'),
      ),
    );
  }

  Future<void> _rate(SupportTicket ticket) async {
    final rating = await showModalBottomSheet<int>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('إيه رأيك في خدمة الدعم؟'),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var star = 1; star <= 5; star++)
                  IconButton(
                    icon: const Icon(Icons.star_border, size: 32),
                    onPressed: () => Navigator.of(sheetContext).pop(star),
                  ),
              ],
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
    if (rating == null || !mounted) return;
    try {
      await _repository.rateTicket(ticket.id, rating);
      await _load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('شكرًا — تقييمك وصل')),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ApiException.from(error).displayMessage)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('تذاكر الدعم')),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _createTicket,
          icon: const Icon(Icons.add),
          label: const Text('تذكرة جديدة'),
        ),
        body: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_tickets == null) {
      if (_error == null) return const Center(child: CircularProgressIndicator());
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: _load, child: const Text('حاول تاني')),
            ],
          ),
        ),
      );
    }
    if (_tickets!.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text(
            'مفيش تذاكر دعم لسه.\n\nلو عندك مشكلة في حسابك أو أرباحك أو التطبيق نفسه، افتح تذكرة. '
            'أما لو المشكلة في طلب بعينه، قدّمها من «شكاويّي».',
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.only(bottom: 88),
        itemCount: _tickets!.length,
        separatorBuilder: (_, _) => const Divider(height: 1),
        itemBuilder: (_, index) {
          final ticket = _tickets![index];
          return ListTile(
            leading: const Icon(Icons.support_agent_outlined),
            title: Text(ticket.subject, maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: Text(
              '#${ticket.ticketNumber} · ${supportTicketCategoryLabelsAr[ticket.category] ?? ticket.category}',
            ),
            trailing: ticket.canRate
                ? TextButton(onPressed: () => _rate(ticket), child: const Text('قيّم الدعم'))
                : Chip(
                    label: Text(
                      ticket.satisfactionRating != null
                          ? '${ticket.satisfactionRating} ★'
                          : supportTicketStatusLabelsAr[ticket.ticketStatus] ?? ticket.ticketStatus,
                    ),
                  ),
          );
        },
      ),
    );
  }
}
