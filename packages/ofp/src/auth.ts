import { z } from 'zod';

/** Sign-in as the web app sees it. Shared so both sides validate the same shape. */

export const SignedInPilot = z.object({
  id: z.uuid(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type SignedInPilot = z.infer<typeof SignedInPilot>;

export const SignInProvider = z.object({
  id: z.enum(['google', 'github']),
  label: z.string(),
});
export type SignInProvider = z.infer<typeof SignInProvider>;

/** GET /api/auth/session: who is signed in (null: nobody), and how one can sign in. */
export const AuthSessionResponse = z.object({
  pilot: SignedInPilot.nullable(),
  providers: z.array(SignInProvider),
  /** Development sign-in (any name, no password) is switched on. Never on a public server. */
  devSignIn: z.boolean(),
});
export type AuthSessionResponse = z.infer<typeof AuthSessionResponse>;

/** POST /api/auth/dev body. */
export const DevSignInRequest = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(40, 'At most 40 characters'),
});
export type DevSignInRequest = z.infer<typeof DevSignInRequest>;

/** Why a sign-in came back to /sign-in?error=...: the web app explains each. */
export const SIGN_IN_ERRORS = ['cancelled', 'expired', 'failed'] as const;
export type SignInError = (typeof SIGN_IN_ERRORS)[number];
