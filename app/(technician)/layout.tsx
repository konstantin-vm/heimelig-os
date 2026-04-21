// Role-based access is enforced in `lib/supabase/proxy.ts`. Story 1.4 will
// replace the <main> with the Mobile PWA Shell (bottom nav, no sidebar).
export default function TechnicianGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <main className="p-4">{children}</main>;
}
