import { redirect } from "next/navigation";

export default function Home() {
  // The protected dashboard sends new visitors to sign-in and existing users
  // to their own boards. Never render the local demo at the public entry point.
  redirect("/dashboard");
}
