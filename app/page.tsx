import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { LiveBoard } from "@/components/LiveBoard";

// auth() reads the request's cookies, so it renders inside Suspense; the
// empty fallback is the prerendered shell.
export default function Home() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <HomeForUser />
    </Suspense>
  );
}

async function HomeForUser() {
  const { userId } = await auth();
  return userId ? <LiveBoard /> : <Landing />;
}

function Landing() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Divvy Live</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        Know there&apos;s a bike before you walk over.
      </h1>
      <p className="mt-4 text-lg text-slate-600 text-pretty">
        Follow the Divvy stations you use. Classic bikes, e-bikes, and open docks update on their own, and you can
        always see how fresh the numbers are.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/sign-up"
          className="rounded-lg bg-sky-700 px-5 py-2.5 font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          Get started
        </Link>
        <Link
          href="/sign-in"
          className="rounded-lg px-5 py-2.5 font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          Sign in
        </Link>
      </div>
      <dl className="mt-12 grid grid-cols-3 gap-4 border-t border-slate-200 pt-6 text-sm">
        <div>
          <dt className="text-slate-500">Stations</dt>
          <dd className="mt-1 font-semibold">2,000+</dd>
        </div>
        <div>
          <dt className="text-slate-500">Checked every</dt>
          <dd className="mt-1 font-semibold">10 seconds</dd>
        </div>
        <div>
          <dt className="text-slate-500">Refreshing</dt>
          <dd className="mt-1 font-semibold">Never needed</dd>
        </div>
      </dl>
    </main>
  );
}
