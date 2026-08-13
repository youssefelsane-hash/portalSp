import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../technicians/technician_profile_screen.dart';
import 'favorites_repository.dart';
import 'models.dart';

// المفضّلة (Favorites، docs/10 بند 36) — كانت مؤجّلة عمداً كـbacklog منفصل، مش موجودة خالص.
// العميل يحفظ فني اشتغل معاه قبل كده عشان يلاقيه بسهولة تاني بدل ما يدوّر من الأول.
class FavoritesScreen extends StatefulWidget {
  const FavoritesScreen({super.key});

  @override
  State<FavoritesScreen> createState() => _FavoritesScreenState();
}

class _FavoritesScreenState extends State<FavoritesScreen> {
  late final FavoritesRepository _repository;
  List<FavoriteTechnician>? _favorites;
  String? _error;
  final Set<String> _removing = {};

  @override
  void initState() {
    super.initState();
    _repository = FavoritesRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final favorites = await _repository.listFavorites();
      if (mounted) setState(() => _favorites = favorites);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _remove(FavoriteTechnician favorite) async {
    setState(() => _removing.add(favorite.technicianId));
    try {
      await _repository.removeFavorite(favorite.technicianId);
      if (mounted) {
        setState(() {
          _favorites = _favorites?.where((f) => f.technicianId != favorite.technicianId).toList();
        });
      }
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _removing.remove(favorite.technicianId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final favorites = _favorites;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('المفضّلة')),
        body: RefreshIndicator(
          onRefresh: _load,
          child: favorites == null
              ? (_error != null ? Center(child: Text(_error!)) : const Center(child: CircularProgressIndicator()))
              : favorites.isEmpty
                  ? ListView(
                      children: const [
                        Padding(
                          padding: EdgeInsets.all(32),
                          child: Center(child: Text('لسه مفيش فنيين في المفضّلة — احفظ فني بعد ما تشتغل معاه')),
                        ),
                      ],
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: favorites.length,
                      itemBuilder: (context, index) {
                        final favorite = favorites[index];
                        final removing = _removing.contains(favorite.technicianId);
                        return Card(
                          child: ListTile(
                            leading: CircleAvatar(
                              backgroundImage: favorite.avatarUrl != null ? NetworkImage(favorite.avatarUrl!) : null,
                              child: favorite.avatarUrl == null ? const Icon(Icons.person) : null,
                            ),
                            title: Text(favorite.fullName),
                            subtitle: Text(
                              favorite.totalRatingsCount > 0
                                  ? '${favorite.averageRating.toStringAsFixed(1)} ★ (${favorite.totalRatingsCount}) — ${favorite.completedOrdersCount} طلب مكتمل'
                                  : '${favorite.completedOrdersCount} طلب مكتمل',
                            ),
                            trailing: removing
                                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                : IconButton(
                                    icon: const Icon(Icons.favorite, color: Colors.red),
                                    onPressed: () => _remove(favorite),
                                  ),
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => TechnicianProfileScreen(technicianId: favorite.technicianId),
                              ),
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
