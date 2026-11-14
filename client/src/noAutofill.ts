/**
 * Attributes that keep browsers and password managers from offering to autofill a field.
 * The app has no accounts, so the name, room code and chat boxes are never logins.
 */
export const NO_AUTOFILL = {
  autoComplete: 'off',
  autoCorrect: 'off',
  spellCheck: false,
  'data-bwignore': 'true', // Bitwarden
  'data-1p-ignore': 'true', // 1Password
  'data-lpignore': 'true', // LastPass
  'data-form-type': 'other', // Dashlane
  'data-protonpass-ignore': 'true', // Proton Pass
} as const;
