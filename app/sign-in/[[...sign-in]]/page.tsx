import { Suspense } from "react";
import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10">
      <Link href="/" className="text-2xl font-semibold tracking-tight">
        Divvy Live
      </Link>
      {/* <SignIn /> reads the URL at request time, so it can't be part of the prerendered shell. */}
      <Suspense>
        <SignIn />
      </Suspense>
    </main>
  );
}
