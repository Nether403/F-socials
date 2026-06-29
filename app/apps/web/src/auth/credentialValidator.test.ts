// Feature: accounts-save-history, Property 8: Credential validation accepts exactly the well-formed inputs
// Validates: Requirements 1.5, 1.6, 1.7, 2.6
//
// validateCredentials(email, password) is the client-side gate that decides whether
// a sign-up/sign-in submission is well-formed enough to send. It accepts if and only if:
//   - email is non-empty, at most 254 characters, and syntactically valid
//     (a non-empty local-part, "@", and a domain carrying a dot-separated TLD with
//     no whitespace and no second "@"), AND
//   - password is between 8 and 72 characters inclusive.
// Every rejection carries a human-readable validation message so the caller can
// display it and send no request; an acceptance carries no message.
//
// We assert the iff against an independent oracle (the contract restated
// structurally, not a copy of the implementation regex) and assert that the
// message field tracks validity. The generators cover the whole input space:
// valid emails, empty/over-length/malformed emails, and short/in-range/over-length
// /empty passwords.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateCredentials } from './authClient';

const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;

// --- Independent oracle ------------------------------------------------------
// Restates the spec contract (Property 8 / Req 1.5-1.7, 2.6) structurally rather
// than reusing the implementation's regex: split on "@", require exactly one
// non-empty local-part and a domain that contains a dot with a non-empty label
// before it and a non-empty TLD after it, and reject any whitespace.
function emailSyntaxValid(email: string): boolean {
  if (/\s/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false; // exactly one "@"
  const [local, domain] = parts;
  if (local.length === 0 || domain.length === 0) return false;
  const dot = domain.lastIndexOf('.');
  if (dot <= 0) return false; // a dot must exist with a non-empty domain label before it
  if (dot === domain.length - 1) return false; // and a non-empty TLD after it
  return true;
}

function oracleValid(email: string, password: string): boolean {
  if (email.length === 0) return false;
  if (email.length > MAX_EMAIL_LENGTH) return false;
  if (!emailSyntaxValid(email)) return false;
  if (password.length < MIN_PASSWORD_LENGTH) return false;
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  return true;
}

// --- Generators --------------------------------------------------------------
// A segment with no whitespace and no "@" — a building block for valid emails.
const segment = fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !/[\s@]/.test(s));

// Guaranteed syntactically valid, within the length cap.
const validEmail = fc
  .tuple(segment, segment, segment)
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

// Valid shape but over the 254-char cap, to exercise the length branch.
const tooLongEmail = fc.integer({ min: 255, max: 400 }).map((n) => `${'a'.repeat(n)}@example.com`);

// Explicit malformed shapes.
const malformedEmail = fc.constantFrom(
  'noatsign',
  'a@b', // domain has no dot/TLD
  'a@.com', // empty domain label before the dot
  '@b.com', // empty local-part
  'a@b.', // empty TLD
  'a b@c.com', // whitespace
  'a@@b.com', // two "@"
  'a@b@c.com',
);

const emailArb = fc.oneof(
  fc.constant(''),
  validEmail,
  tooLongEmail,
  malformedEmail,
  fc.emailAddress(),
  fc.string({ maxLength: 300 }),
);

const passwordArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: MIN_PASSWORD_LENGTH - 1 }), // too short
  fc.string({ minLength: MIN_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_LENGTH }), // in range
  fc.string({ minLength: MAX_PASSWORD_LENGTH + 1, maxLength: 120 }), // too long
  fc.string({ maxLength: 120 }),
);

describe('validateCredentials (Property 8: accepts exactly the well-formed inputs)', () => {
  it('accepts iff well-formed and always reports a message on rejection', () => {
    fc.assert(
      fc.property(emailArb, passwordArb, (email, password) => {
        let result: ReturnType<typeof validateCredentials>;
        // Totality: the validator must complete for any input.
        expect(() => {
          result = validateCredentials(email, password);
        }).not.toThrow();

        const expected = oracleValid(email, password);
        // iff: accepted exactly when the contract says the input is well-formed.
        expect(result!.valid).toBe(expected);

        if (expected) {
          // Accepted submissions carry no validation message.
          expect(result!.message).toBeUndefined();
        } else {
          // Rejected submissions carry a non-empty message so the caller can
          // display it and send no request.
          expect(typeof result!.message).toBe('string');
          expect(result!.message!.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
