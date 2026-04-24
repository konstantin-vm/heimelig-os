"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type LogoutButtonProps = {
  className?: string;
};

export function LogoutButton({ className }: LogoutButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const logout = async () => {
    if (isPending) return;
    setIsPending(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/auth/login");
    } catch {
      setIsPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={logout}
      disabled={isPending}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-hidden",
        isPending && "pointer-events-none opacity-50",
        className,
      )}
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      <span>{isPending ? "Abmelden …" : "Abmelden"}</span>
    </button>
  );
}
