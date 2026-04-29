import { Badge } from "@/components/ui/badge";
import {
  getContactRoleConfig,
  type ContactRole,
} from "@/lib/constants/contact-roles";

export type ContactRoleBadgeProps = {
  role: ContactRole;
  className?: string;
};

export function ContactRoleBadge({ role, className }: ContactRoleBadgeProps) {
  const config = getContactRoleConfig(role);
  return (
    <Badge variant={config.badgeVariant} className={className}>
      {config.label}
    </Badge>
  );
}
