'use client';

// Catches errors in the signed-in layout itself (for example the API not answering), which the (app) error page
// can't, because an error page only covers the pages below its own layout.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="content" id="main" style={{ maxWidth: 560 }}>
      <div className="card card-pad mt-24">
        <h1>VeQMS can’t load this page</h1>
        <p className="muted">The service didn’t answer. Try again in a moment. If it keeps happening, tell the Quality Manager. {error.digest ? `Reference: ${error.digest}` : ''}</p>
        <div className="btn-row mt-16"><button className="btn btn-primary" onClick={() => reset()}>Try again</button><a className="btn" href="/login">Sign in again</a></div>
      </div>
    </main>
  );
}
