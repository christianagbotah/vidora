import Link from "next/link";
import type { ReactNode } from "react";

export default function ProviderStudioLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto px-4 py-2 sm:px-6 lg:px-8">
          <Link
            href="/admin/providers"
            className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Provider routing
          </Link>
          <Link
            href="/admin/providers/voice"
            className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Voice providers
          </Link>
        </div>
      </div>
      {children}
    </>
  );
}
