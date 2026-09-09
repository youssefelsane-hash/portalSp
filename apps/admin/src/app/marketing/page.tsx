import { redirect } from 'next/navigation';

/** صفحة قديمة محفوظة كرابط فقط؛ إدارة العروض والإسناد أصبحت موحّدة تحت /promotions. */
export default function MarketingPage() {
  redirect('/promotions');
}
