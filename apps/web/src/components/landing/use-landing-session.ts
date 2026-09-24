import { authClient } from "../../auth/auth-client.ts";

export function useLandingSession(): {
  signedIn: boolean;
  pending: boolean;
  email: string | null;
} {
  const session = authClient.useSession();
  const email = session.data?.user.email;

  return {
    signedIn: session.data != null,
    pending: session.isPending === true,
    email: typeof email === "string" ? email : null,
  };
}
