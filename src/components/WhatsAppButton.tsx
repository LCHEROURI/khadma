import { ContactButtons } from './ContactButtons';

export function WhatsAppButton({ gigId }: { gigId: string }) {
  return <ContactButtons gigId={gigId} contactMethods={['whatsapp']} />;
}
