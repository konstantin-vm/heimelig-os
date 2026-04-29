import { Badge } from "@/components/ui/badge";
import {
  getInsuranceTypeConfig,
  type InsuranceType,
} from "@/lib/constants/insurance";

export type InsuranceTypeBadgeProps = {
  type: InsuranceType;
  className?: string;
};

export function InsuranceTypeBadge({ type, className }: InsuranceTypeBadgeProps) {
  const config = getInsuranceTypeConfig(type);
  return (
    <Badge variant={config.badgeVariant} className={className}>
      {config.label}
    </Badge>
  );
}
