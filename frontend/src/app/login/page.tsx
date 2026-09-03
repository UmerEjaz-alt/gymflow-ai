import { redirect } from "next/navigation";

import { AuthCard } from "@/features/auth/components/auth-card";
import { LoginForm } from "@/features/auth/components/login-form";
import { getCurrentUser } from "@/services/auth.server";

export const dynamic = "force-dynamic";

/** Public sign-in route that sends authenticated users to the application. */
export default async function LoginPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/inbox");
  }

  return (
    <main className="bg-muted/30 flex min-h-screen items-center justify-center px-6 py-12">
      <AuthCard
        description="Sign in to continue to your Kroway operations workspace."
        title="Welcome back"
      >
        <LoginForm />
      </AuthCard>
    </main>
  );
}
