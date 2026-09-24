import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="space-y-3 p-6">
      <h1 className="text-2xl text-foreground">Not found</h1>
      <p className="text-sm text-secondary">That page does not exist.</p>
      <Link to="/">Back to Notional</Link>
    </div>
  );
}
