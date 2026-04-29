import { cn } from "@/lib/utils";
import {
  getContactRoleConfig,
  type ContactRole,
} from "@/lib/constants/contact-roles";

export type ContactAvatarProps = {
  firstName: string | null;
  lastName: string | null;
  role: ContactRole;
  className?: string;
};

function initials(firstName: string | null, lastName: string | null): string {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();
  const a = f ? f[0]! : "";
  const b = l ? l[0]! : "";
  const result = `${a}${b}`.toUpperCase();
  return result || "?";
}

export function ContactAvatar({
  firstName,
  lastName,
  role,
  className,
}: ContactAvatarProps) {
  const config = getContactRoleConfig(role);
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        config.avatarTint,
        config.avatarText,
        className,
      )}
    >
      {initials(firstName, lastName)}
    </div>
  );
}
