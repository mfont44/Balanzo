/**
 * Password validation for sign-up: 8+ chars, 1 number, 1 special character.
 */

export interface PasswordValidation {
  length: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
  isValid: boolean;
}

const MIN_LENGTH = 8;
const HAS_NUMBER = /\d/;
const HAS_SPECIAL = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;

export function validatePassword(password: string): PasswordValidation {
  const length = password.length >= MIN_LENGTH;
  const hasNumber = HAS_NUMBER.test(password);
  const hasSpecial = HAS_SPECIAL.test(password);
  return {
    length,
    hasNumber,
    hasSpecial,
    isValid: length && hasNumber && hasSpecial,
  };
}
