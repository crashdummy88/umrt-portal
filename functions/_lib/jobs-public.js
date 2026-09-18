/**
 * Customer-safe view of a jobs row. Wire-only: returns what is stored,
 * never invents a live Square sync. Invoice URLs are withheld until the
 * stored status is past draft, and only https Square invoice hosts are
 * passed through. Booking land is a separate constant — do not treat
 * square.site or square.link as an invoice.
 *
 * Live invoice/payment events are owned by the umrt-square-events
 * webhook (Cloudflare). This module does not poll Square.
 */
import { sanitizeHttpUrl } from './url-safety.js';

export const SQUARE_BOOK_URL = 'https://united-mobile-rv-llc.square.site/';

export const JOB_STATUS_LABELS = {
  requested: 'Requested',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const DRAFT_INVOICE = new Set(['draft']);
const SENT_INVOICE = new Set([
  'unpaid',
  'published',
  'sent',
  'scheduled',
  'payment_pending',
  'partially_paid',
]);

function hostAllowedForInvoice(hostname) {
  const host = String(hostname || '').toLowerCase();
  return (
    host === 'squareup.com' ||
    host.endsWith('.squareup.com') ||
    host === 'squareupsandbox.com' ||
    host.endsWith('.squareupsandbox.com')
  );
}

export function customerInvoiceUrl(raw, invoiceStatus) {
  const status = String(invoiceStatus || '').toLowerCase();
  if (!status || DRAFT_INVOICE.has(status)) return null;

  const checked = sanitizeHttpUrl(raw);
  if (!checked.ok || !checked.url) return null;

  let host;
  try {
    host = new URL(checked.url).hostname;
  } catch {
    return null;
  }
  return hostAllowedForInvoice(host) ? checked.url : null;
}

export function jobStatusLabel(status) {
  const key = String(status || '').toLowerCase();
  if (JOB_STATUS_LABELS[key]) return JOB_STATUS_LABELS[key];
  const raw = String(status || '').trim();
  return raw || 'On file';
}

export function invoiceLabel({ status, paid }) {
  if (paid) return 'Paid';
  const key = String(status || '').toLowerCase();
  if (!key) return null;
  if (DRAFT_INVOICE.has(key)) return 'Invoice not sent yet';
  if (SENT_INVOICE.has(key)) return 'Invoice sent';
  if (key === 'paid') return 'Paid';
  if (key === 'canceled' || key === 'cancelled') return 'Cancelled';
  if (key === 'refunded') return 'Refunded';
  if (key === 'failed') return 'Payment failed';
  return key.replace(/_/g, ' ');
}

export function shapeCustomerJob(row) {
  const paid = !!row.paid_at;
  const invoiceStatus = row.square_invoice_status
    ? String(row.square_invoice_status).toLowerCase()
    : null;
  const url = customerInvoiceUrl(row.square_invoice_url, invoiceStatus);
  const label = invoiceLabel({ status: invoiceStatus, paid });

  return {
    id: row.id,
    full_name: row.full_name || null,
    rv_year: row.rv_year || null,
    rv_make: row.rv_make || null,
    rv_model: row.rv_model || null,
    issue: row.issue || null,
    city: row.city || null,
    state: row.state || null,
    preferred_date: row.preferred_date || null,
    preferred_time: row.preferred_time || null,
    status: row.status || 'requested',
    status_label: jobStatusLabel(row.status),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    invoice: {
      status: invoiceStatus,
      label,
      url,
      paid,
      amount_cents: paid && row.final_amount_cents != null ? row.final_amount_cents : null,
    },
    book_url: SQUARE_BOOK_URL,
  };
}
