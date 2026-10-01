import { lazy, Suspense, useEffect, useState } from "react";

// Loads the install button or the iOS hint after hydration, so the server never touches window.
const InstallAppClient = lazy(() => import("./install-app.client"));

export function InstallApp({ tone = "light", className = "" }: { tone?: "light" | "dark"; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <div className={`empty:hidden ${className}`}>
      <Suspense fallback={null}>
        <InstallAppClient tone={tone} />
      </Suspense>
    </div>
  );
}
