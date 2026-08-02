import { Nav } from '@/components/nav';

/** Shell for every authenticated screen. /login sits outside this group so it
 *  renders without navigation. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <div className="mx-auto w-full max-w-6xl px-6 py-8">{children}</div>
    </>
  );
}
