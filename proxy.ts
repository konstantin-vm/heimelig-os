import { updateSession } from "@/lib/supabase/proxy";
import { type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image
     * - favicon.ico
     * - manifest.json, sw.js, icons/* (PWA assets must be reachable anonymously)
     * - image extensions (.svg|.png|.jpg|.jpeg|.gif|.webp)
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw\\.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
