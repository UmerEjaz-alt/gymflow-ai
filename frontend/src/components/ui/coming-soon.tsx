type ComingSoonProps = {
  title: string;
};

/** Minimal route placeholder used until a product area is implemented. */
export function ComingSoon({ title }: ComingSoonProps) {
  return (
    <section className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="max-w-xl text-center">
        <p className="text-muted-foreground mb-3 text-sm font-medium">Kroway</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="text-muted-foreground mt-4 text-base leading-7 sm:text-lg">
          Coming Soon
        </p>
      </div>
    </section>
  );
}
