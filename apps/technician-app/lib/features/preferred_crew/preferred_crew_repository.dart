import '../../core/auth_repository.dart';
import 'models.dart';

// نفس نمط OnboardingRepository.requestAssistant() بالحرف (بحث بـtechnician_code) — راجع
// docs/08 §36.16 وapps/api/src/modules/technicians/preferred-crew.service.ts.
class PreferredCrewRepository {
  final AuthRepository auth;

  PreferredCrewRepository(this.auth);

  Future<List<PreferredCrewMember>> listMine() async {
    final items = await auth.authedRequestList('/technician/preferred-crew');
    return items.map(PreferredCrewMember.fromJson).toList();
  }

  Future<List<PreferredCrewMember>> listInvitationsReceived() async {
    final items = await auth.authedRequestList('/technician/preferred-crew/invitations');
    return items.map(PreferredCrewMember.fromJson).toList();
  }

  Future<List<PreferredCrewMember>> listMyMemberships() async {
    final items = await auth.authedRequestList('/technician/preferred-crew/memberships');
    return items.map(PreferredCrewMember.fromJson).toList();
  }

  Future<void> invite(String memberTechnicianCode) async {
    await auth.authedRequest(
      'POST',
      '/technician/preferred-crew',
      body: {'member_technician_code': memberTechnicianCode},
    );
  }

  Future<void> acceptInvitation(String invitationId) async {
    await auth.authedRequest('POST', '/technician/preferred-crew/invitations/$invitationId/accept');
  }

  Future<void> declineInvitation(String invitationId) async {
    await auth.authedRequest('POST', '/technician/preferred-crew/invitations/$invitationId/decline');
  }

  Future<void> removeMember(String memberId) async {
    await auth.authedRequest('DELETE', '/technician/preferred-crew/$memberId');
  }

  Future<void> leave(String membershipId) async {
    await auth.authedRequest('POST', '/technician/preferred-crew/$membershipId/leave');
  }
}
