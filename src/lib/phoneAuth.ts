import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type Auth,
  type ConfirmationResult
} from 'firebase/auth';

export interface PhoneVerificationAdapter {
  sendCode(e164Phone: string, container: HTMLElement): Promise<void>;
  confirmCode(code: string): Promise<void>;
  hasPendingConfirmation(): boolean;
  reset(): void;
  dispose(): void;
}

/**
 * Firebase SMS OTP adapter with deterministic reCAPTCHA reset & cleanup (BUG-002 / ARCH-002).
 * Isolated behind PhoneVerificationAdapter so swapping to WhatsApp verification requires
 * replacing only this adapter without modifying PostGig.tsx.
 */
export function createFirebaseSmsAdapter(auth: Auth): PhoneVerificationAdapter {
  let verifier: RecaptchaVerifier | null = null;
  let containerEl: HTMLElement | null = null;
  let confirmation: ConfirmationResult | null = null;

  const clearVerifier = () => {
    if (verifier) {
      try {
        verifier.clear();
      } catch {
        // Ignore if widget was already detached from DOM
      }
      verifier = null;
    }
    if (containerEl) {
      containerEl.innerHTML = '';
    }
  };

  return {
    async sendCode(e164Phone: string, container: HTMLElement) {
      clearVerifier();
      containerEl = container;
      verifier = new RecaptchaVerifier(auth, container, {
        size: 'invisible',
        callback: () => {}
      });
      try {
        confirmation = await signInWithPhoneNumber(auth, e164Phone, verifier);
      } catch (err) {
        clearVerifier();
        throw err;
      }
    },

    async confirmCode(code: string) {
      if (!confirmation) {
        throw new Error('NO_CONFIRMATION');
      }
      await confirmation.confirm(code);
      confirmation = null;
      clearVerifier();
    },

    hasPendingConfirmation() {
      return confirmation !== null;
    },

    reset() {
      confirmation = null;
      clearVerifier();
    },

    dispose() {
      confirmation = null;
      clearVerifier();
      containerEl = null;
    }
  };
}
