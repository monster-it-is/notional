import { createAuthClient } from "better-auth/react";

import { apiBaseUrl } from "../lib/env.ts";

export const authClient = createAuthClient({
  baseURL: apiBaseUrl(),
  fetchOptions: {
    credentials: "include",
  },
});
