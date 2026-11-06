export interface CheckoutResult {
  status: "paid";
  paymentId: string;
  txUrl: string | null;
  pointsEarned: number;
  demo?: boolean;
}

export interface CheckoutOptions {
  /** The invoice your server created with paykit.invoices.create(). */
  invoiceId: string;
  /** Defaults to https://paykit-server.vercel.app */
  server?: string;
  /** Brand colour for the dialog. Defaults to the merchant's profile accent. */
  accent?: string;
  /** Link shown after payment. Defaults to the PayKit wallet. */
  walletUrl?: string;
  /** Called once the payment is verified onchain, before the dialog closes. */
  onPaid?: (result: CheckoutResult) => void;
  /** Presentation mode: connects MetaMask but completes locally. No funds move. */
  demo?: boolean;
  demoInvoice?: { amount: string; amountDue: string; reference?: string; description?: string; merchant: { name: string } };
}

/**
 * Opens the PayKit checkout over the current page: connects MetaMask, switches to Whitechain,
 * offers points rewards, asks for one gasless USDT signature and waits for onchain settlement.
 * Resolves when the dialog closes.
 */
export declare function openCheckout(options: CheckoutOptions): Promise<CheckoutResult | { status: "closed" }>;

declare const _default: { openCheckout: typeof openCheckout };
export default _default;
