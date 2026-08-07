// TODO: proteksi khusus admin/superadmin, cek role di sini
import type { ReactNode } from "react";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <div>{children}</div>;
}
