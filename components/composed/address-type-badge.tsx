import { Badge } from "@/components/ui/badge";
import {
  getAddressTypeConfig,
  type AddressType,
} from "@/lib/constants/address";

export type AddressTypeBadgeProps = {
  type: AddressType;
  className?: string;
};

export function AddressTypeBadge({ type, className }: AddressTypeBadgeProps) {
  const config = getAddressTypeConfig(type);
  return (
    <Badge variant={config.badgeVariant} className={className}>
      {config.label}
    </Badge>
  );
}
