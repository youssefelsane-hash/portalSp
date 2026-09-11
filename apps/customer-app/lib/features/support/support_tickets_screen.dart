import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'create_support_ticket_screen.dart';
import 'models.dart';
import 'support_repository.dart';

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
      final apiError = ApiException.from(error);
      if (mounted) setState(() => _error = apiError.displayMessage);
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
        content: Text(
          'اتفتحت تذكرتك رقم ${ticket.ticketNumber}. فريق الدعم هيتابعها معاك.',
        ),
      ),
    );
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
        body: _tickets == null
            ? (_error == null
                  ? const Center(child: CircularProgressIndicator())
                  : Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(_error!, textAlign: TextAlign.center),
                            const SizedBox(height: 12),
                            OutlinedButton(
                              onPressed: _load,
                              child: const Text('حاول تاني'),
                            ),
                          ],
                        ),
                      ),
                    ))
            : _tickets!.isEmpty
            ? const Center(
                child: Padding(
                  padding: EdgeInsets.all(32),
                  child: Text(
                    'مفيش تذاكر دعم لسه. لو عندك مشكلة عامة افتح تذكرة جديدة.',
                  ),
                ),
              )
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView.separated(
                  padding: const EdgeInsets.only(bottom: 88),
                  itemCount: _tickets!.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (_, index) {
                    final ticket = _tickets![index];
                    return ListTile(
                      leading: const Icon(Icons.support_agent_outlined),
                      title: Text(
                        ticket.subject,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text(
                        '#${ticket.ticketNumber} - ${supportTicketCategoryLabelsAr[ticket.category] ?? ticket.category}',
                      ),
                      trailing: Chip(
                        label: Text(
                          supportTicketStatusLabelsAr[ticket.ticketStatus] ??
                              ticket.ticketStatus,
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
