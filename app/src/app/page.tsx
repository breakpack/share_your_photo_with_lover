import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import Gallery from '@/components/Gallery';

export const dynamic = 'force-dynamic';

export default function Home() {
  const user = getCurrentUser();
  if (!user) redirect('/login');
  return <Gallery currentUser={user} />;
}
