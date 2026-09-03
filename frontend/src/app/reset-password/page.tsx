import { AuthCard } from "@/features/auth/components/auth-card";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";

export const dynamic = "force-dynamic";

/**
 * Public route for setting a new password via Supabase recovery lifecycle.
 */
export default function ResetPasswordPage() {
  return (
    <main className="bg-muted/30 flex min-h-screen items-center justify-center px-6 py-12">
      <AuthCard
        description="Choose a new secure password for your Kroway account."
        title="Reset password"
      >
        <ResetPasswordForm />
      </AuthCard>
    </main>
  );
}
