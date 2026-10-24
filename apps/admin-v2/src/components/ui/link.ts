/**
 * A link's hit area when it stands on a line of its own (it starts the line
 * or is all of it): 44px on phones and touch screens, the height of its text
 * with a mouse or trackpad (DESIGN C6). For a link that keeps its own colour
 * (a hint in the error colour, a count in a muted line).
 */
export const standaloneLinkTarget = "inline-flex min-h-11 min-w-6 items-center sm:pointer-fine:min-h-6";

/**
 * A link on a line of its own ("Manage policies", "Phone, email and WhatsApp
 * fields are set in Customer accounts"): the 44px target in the link colour.
 * A link inside a sentence stays plain `text-link` and inline.
 */
export const standaloneLinkClassName = `${standaloneLinkTarget} rounded-md text-body text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`;
