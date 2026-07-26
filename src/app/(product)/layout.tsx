import { AppShell } from "@/lib/ui/AppShell";
import { OnboardingProvider } from "@/features/onboarding/OnboardingProvider";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <OnboardingProvider>
      <AppShell>{children}</AppShell>
    </OnboardingProvider>
  );
}
