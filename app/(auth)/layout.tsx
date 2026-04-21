// Role-based access is enforced in `lib/supabase/proxy.ts` — this layout
// is just the outer wrapper for the desktop shell group. Story 1.4 will
// replace the <main> with the real Desktop Shell (sidebar, top bar, nav).
export default function DesktopGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <main className="p-6">{children}</main>;
}
