"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="dashboard-page"><h1>We couldn’t load your workspace.</h1><p>Please check your connection and try again.</p><button className="button" onClick={reset}>Try again</button><a href="/login">Sign in</a></main>; }
