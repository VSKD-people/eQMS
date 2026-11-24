'use client';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card card-pad">
      <h1>Something went wrong on this page</h1>
      <p className="muted">{error.message || 'The service didn’t answer.'} {error.digest ? `Reference: ${error.digest}` : ''}</p>
      <div className="btn-row mt-16"><button className="btn btn-primary" onClick={() => reset()}>Try again</button><a className="btn" href="/today">Back to Today</a></div>
    </div>
  );
}
