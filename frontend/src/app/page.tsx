import { redirect } from "next/navigation";

/** Sends the root URL to the initial application destination. */
export default function HomePage() {
  redirect("/inbox");
}
