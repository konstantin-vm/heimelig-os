import {
  ClipboardList,
  FileText,
  LayoutDashboard,
  Package,
  Receipt,
  Route,
  ScanLine,
  Settings,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { NavIconKey } from "@/lib/constants/navigation";

export const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  customers: Users,
  articles: Package,
  orders: ClipboardList,
  contracts: FileText,
  invoices: Receipt,
  tours: Truck,
  settings: Settings,
  tour: Route,
  scan: ScanLine,
};
