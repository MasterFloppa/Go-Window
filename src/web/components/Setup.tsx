import { useState } from 'react';
import type { Settings } from '../../shared/types';
import { client } from '../api';
import { FreeHoursEditor } from './FreeHours';
import { LocationPicker } from './LocationPicker';
import { ActivityPicker } from './Settings';

export function Setup({ settings, onDone }: { settings: Settings; onDone: (s: Settings) => void }) {
  const [s, setS] = useState(settings);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    try {
      const r = await client.saveSettings(s);
      onDone(r.settings);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="setup stack">
      <section className="card">
        <h2>🌿 Find your go window</h2>
        <p className="muted">
          Go Window looks at the next 3 days of weather and air quality, keeps only the hours you are actually free, and tells
          you the best time to step outside. A local open-weight model explains the plan. Every check-in teaches it your
          limits.
        </p>
      </section>

      {step === 0 && (
        <section className="card">
          <h2>1. Where are you?</h2>
          <LocationPicker value={s.location} onChange={(location) => setS({ ...s, location })} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" disabled={!s.location} onClick={() => setStep(1)}>
              Next
            </button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="card">
          <h2>2. What do you want to do?</h2>
          <ActivityPicker value={s.activity} onChange={(activity) => setS({ ...s, activity })} />
          <label className="check">
            <input type="checkbox" checked={s.sensitive} onChange={(e) => setS({ ...s, sensitive: e.target.checked })} />
            I'm sensitive to heat or air (asthma, pregnancy, older age)
          </label>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={() => setStep(0)}>
              Back
            </button>
            <button className="btn" onClick={() => setStep(2)}>
              Next
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="card">
          <h2>3. When are you actually free?</h2>
          <p className="muted small">We filled in a typical week. Adjust it to your real routine; you can change it later.</p>
          <FreeHoursEditor value={s.freeHours} onChange={(freeHours) => setS({ ...s, freeHours })} />
          {error && <div className="banner error">{error}</div>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn" onClick={finish}>
              Show my windows
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
