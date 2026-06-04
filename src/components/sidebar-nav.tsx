"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./logo";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const navGroups = [
  {
    label: "Portfolio",
    items: [
      { href: "/deals", label: "Deals" },
      { href: "/payables", label: "Payables" },
    ],
  },
];

export default function SidebarNav({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <aside className="w-64 bg-nurock-navy text-white min-h-screen flex flex-col flex-shrink-0">
      <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
        <Logo className="h-9 w-auto" />
        <div>
          <div className="font-display text-sm font-semibold uppercase tracking-wider leading-tight">
            NuRock
          </div>
          <div className="text-[10px] text-white/60 uppercase tracking-wider leading-tight">
            Dev Management
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="text-[10px] font-display uppercase tracking-[0.12em] text-white/40 px-3 mb-1.5">
              {group.label}
            </div>
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block px-3 py-2 rounded-md text-sm font-medium transition ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/70 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-white/10 text-xs">
        <div className="text-white/60 truncate mb-2 px-1" title={userEmail}>
          {userEmail}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-white/80 hover:bg-white/10 hover:text-white"
          onClick={signOut}
        >
          Sign out
        </Button>
      </div>
    </aside>
  );
}
