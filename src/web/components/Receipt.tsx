import type { Receipt } from '../../shared/types';
import { fmtMinutes } from '../format';

/** One quiet line: the week so far, counted from check-ins. */
export function ReceiptLine({ receipt }: { receipt: Receipt }) {
  if (!receipt.windowsTaken && !receipt.skipped) {
    return <div className="receipt-line-mini">This week: no check-ins yet. After your first walk, tap how it felt.</div>;
  }
  return (
    <div className="receipt-line-mini">
      This week: <b>{fmtMinutes(receipt.minutesOutside)}</b> outside on <b>{receipt.daysOutside}</b> of 7 days
      {receipt.skipped ? ` · ${receipt.skipped} skipped` : ''}
    </div>
  );
}
