import { Link } from "react-router";

import { authClient } from "../auth/auth-client.ts";
import { Button } from "../components/ui/Button.tsx";
import { PaperBadge } from "../components/PaperBadge.tsx";

export function LandingPage() {
  const session = authClient.useSession();
  const signedIn = Boolean(session.data);

  return (
    <div className="space-y-6">
      <PaperBadge />
      <h1 className="text-4xl md:text-5xl">Notional paper perpetuals</h1>
      <p>
        Notional is a paper crypto perpetual-futures simulator. It is not a real exchange, wallet, or
        real-money product. Prices come from Binance USD-M market data through Notional&apos;s backend —
        this browser never talks to Binance.
      </p>
      <div className="flex flex-wrap gap-3">
        {signedIn ? (
          <Link to="/trade">
            <Button variant="primary">Open trade desk</Button>
          </Link>
        ) : (
          <>
            <Link to="/signup">
              <Button variant="primary">Create paper account</Button>
            </Link>
            <Link to="/signin">
              <Button>Sign in</Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
