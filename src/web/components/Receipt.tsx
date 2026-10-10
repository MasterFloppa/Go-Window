import type { Receipt } from '../../shared/types';
import { fmtMinutes, shortDate } from '../format';

export function ReceiptCard({ receipt }: { receipt: Receipt }) {
  return (
    <section className="card receipt">
      <div className="spread">
        <b>TOUCH-GRASS RECEIPT</b>
        <span className="muted small">
          {shortDate(receipt.from)} – {shortDate(receipt.to)}
        </span>
      </div>
      <div className="big" style={{ margin: '8px 0' }}>
        {fmtMinutes(receipt.minutesOutside)}
      </div>
      <div className="receipt-line">
        <span>Days outside</span>
        <span>{receipt.daysOutside} / 7</span>
      </div>
      <div className="receipt-line">
        <span>Windows taken</span>
        <span>
          {receipt.windowsTaken} / {Math.max(receipt.windowsOffered, receipt.windowsTaken)}
        </span>
      </div>
      <div className="receipt-line">
        <span>Skipped</span>
        <span>{receipt.skipped}</span>
      </div>
      <div className="muted small" style={{ marginTop: 8 }}>
        Counted from your check-ins. Screens off, grass touched.
      </div>
    </section>
  );
}
