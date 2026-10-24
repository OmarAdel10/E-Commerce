export type AdminAuthStep = "verify-two-factor" | "set-password" | "enroll-two-factor";

/** One pending gate at a time, shared by API authorization and dashboard navigation. */
export function pendingAdminAuthStep(
  user: {
    twoFactorEnabled?: boolean;
    mustChangePassword?: boolean;
    mustEnrollTwoFactor?: boolean;
  },
  session: { twoFactorVerified?: boolean | null } | null | undefined,
): AdminAuthStep | null {
  // An established second factor must be proven before changing credentials.
  if (user.twoFactorEnabled === true && session?.twoFactorVerified !== true) return "verify-two-factor";
  if (user.mustChangePassword === true) return "set-password";
  if (user.mustEnrollTwoFactor === true && user.twoFactorEnabled !== true) return "enroll-two-factor";
  return null;
}
