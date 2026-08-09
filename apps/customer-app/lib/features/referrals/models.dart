class ReferralInfo {
  final String referralCode;
  final int completedReferralsCount;
  final int pendingReferralsCount;
  final int requiredReferralsPerReward;
  final int referralsUntilNextReward;

  ReferralInfo({
    required this.referralCode,
    required this.completedReferralsCount,
    required this.pendingReferralsCount,
    required this.requiredReferralsPerReward,
    required this.referralsUntilNextReward,
  });

  factory ReferralInfo.fromJson(Map<String, dynamic> json) {
    return ReferralInfo(
      referralCode: json['referral_code'] as String,
      completedReferralsCount: json['completed_referrals_count'] as int,
      pendingReferralsCount: json['pending_referrals_count'] as int,
      requiredReferralsPerReward: json['required_referrals_per_reward'] as int,
      referralsUntilNextReward: json['referrals_until_next_reward'] as int,
    );
  }
}
