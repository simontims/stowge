import { createContext, useContext } from "react";
import { type CurrentUser } from "./types";

interface UserContextValue {
  currentUser: CurrentUser;
}

export const UserContext = createContext<UserContextValue | null>(null);

/** Returns the current authenticated user. Must be called inside a rendered
 *  route — i.e. only when the auth gate in App.tsx already confirmed the user
 *  is signed in. Throws if called outside the provider. */
export function useCurrentUser(): CurrentUser {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useCurrentUser must be used inside UserContext.Provider");
  return ctx.currentUser;
}
