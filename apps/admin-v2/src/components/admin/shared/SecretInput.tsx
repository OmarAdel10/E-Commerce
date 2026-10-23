import * as React from "react";
import { Input, type InputProps } from "~/components/ui/input";

/**
 * A provider secret (API key, access token, webhook secret): masked like a
 * password, but never a sign-in field. Browsers ignore `autocomplete="off"`
 * on password fields: they filled the staff member's saved dashboard password
 * into the secret (so Save would store it with the provider) and their email
 * into the nearest text box, the settings search. `new-password` keeps saved
 * sign-ins out, and the password managers' own markers keep theirs out.
 */
export const SecretInput = React.forwardRef<HTMLInputElement, Omit<InputProps, "type" | "autoComplete">>((props, ref) => (
  <Input
    ref={ref}
    type="password"
    autoComplete="new-password"
    spellCheck={false}
    data-1p-ignore=""
    data-lpignore="true"
    data-bwignore=""
    data-form-type="other"
    {...props}
  />
));
SecretInput.displayName = "SecretInput";
