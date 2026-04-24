import Image from "next/image";

import { LoginForm } from "@/components/login-form";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full flex-col md:flex-row">
      <div className="flex flex-1 flex-col items-center justify-center gap-10 bg-background p-6 md:p-12">
        <Image
          src="/Heimelig_Logo.png"
          alt="Heimelig"
          width={236}
          height={40}
          priority
        />
        <LoginForm className="w-full max-w-sm" />
      </div>
      <div className="relative hidden flex-1 md:block">
        <Image
          src="/home-hero.avif"
          alt=""
          fill
          priority
          sizes="50vw"
          className="object-cover"
        />
      </div>
    </div>
  );
}
