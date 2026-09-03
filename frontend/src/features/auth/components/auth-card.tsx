import type { ReactNode } from "react";

type AuthCardProps = {
  children: ReactNode;
  description: string;
  title: string;
};

/** Shared presentation container for authentication forms. */
export function AuthCard({ children, description, title }: AuthCardProps) {
  return (
    <section className="border-border bg-card w-full max-w-md rounded-2xl border p-6 shadow-sm sm:p-8">
      <div className="mb-8">
        <div className="bg-primary text-primary-foreground mb-5 grid size-10 place-items-center rounded-xl text-sm font-bold">
          K
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">{description}</p>
      </div>
      {children}
    </section>
  );
}
