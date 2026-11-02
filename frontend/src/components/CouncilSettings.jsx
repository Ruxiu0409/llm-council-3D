import { useState } from 'react';
import { shortName } from '../names';
import { EFFORT_LABELS, callEstimate, fromBudget, saveSettings } from '../councilSettings';
import './CouncilSettings.css';

function modelLabel(catalog, id) {
  return catalog.find((m) => m.id === id)?.label || shortName(id);
}

export default function CouncilSettings({ council, settings, onChange }) {
  const [open, setOpen] = useState(false);
  const { catalog, limits } = council;

  const save = (next) => {
    saveSettings(next);
    onChange(next);
  };

  // Any manual change turns the budget into "custom".
  const update = (patch) => save({ ...settings, ...patch, budget: 'custom' });

  const toggleModel = (id) => {
    const has = settings.models.includes(id);
    if (has && settings.models.length === 1) return; // keep at least one
    update({ models: has ? settings.models.filter((m) => m !== id) : [...settings.models, id] });
  };

  const seatOptions = [];
  for (let n = limits.min; n <= limits.max; n++) seatOptions.push(n);

  const summary = [
    settings.models.map((id) => modelLabel(catalog, id)).join('、'),
    settings.seats ? `固定 ${settings.seats} 席` : `自動 ${limits.min}–${settings.maxSeats} 席`,
    `主席 ${modelLabel(catalog, settings.chairman)}`,
    `思考 ${settings.effort ? EFFORT_LABELS[settings.effort] : '預設'}`,
  ].join(' · ');

  return (
    <div className="council-settings">
      <div className="budget-row" role="radiogroup" aria-label="預算">
        {Object.entries(council.budgets).map(([key, tier]) => (
          <button
            type="button"
            role="radio"
            aria-checked={settings.budget === key}
            key={key}
            className={`budget-card budget-${key} ${settings.budget === key ? 'selected' : ''}`}
            onClick={() => save(fromBudget(council, key))}
          >
            <span className="budget-label">{tier.label}</span>
            <span className="budget-hint">{tier.hint}</span>
            <span className="budget-models">{tier.models.map((id) => modelLabel(catalog, id).replace('Claude ', '')).join(' · ')}</span>
          </button>
        ))}
      </div>

      <button type="button" className="settings-summary" onClick={() => setOpen((o) => !o)}>
        <span className="settings-summary-text">
          {settings.budget === 'custom' && <span className="custom-tag">自訂</span>}
          {summary}
        </span>
        <span className="settings-estimate">約 {callEstimate(settings, limits)}呼叫</span>
        <span className={`settings-chevron ${open ? 'open' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="settings-panel">
          <div className="settings-row">
            <div className="settings-label">
              議員模型
              <span className="settings-sublabel">席次會從這些模型中分配，可重複使用同一個</span>
            </div>
            <div className="chip-row">
              {catalog.map((model) => (
                <button
                  type="button"
                  key={model.id}
                  title={model.description || undefined}
                  className={`chip ${settings.models.includes(model.id) ? 'selected' : ''}`}
                  onClick={() => toggleModel(model.id)}
                >
                  {model.label}
                  {model.cost && <span className="chip-hint">{model.cost}</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-label">
              席次
              <span className="settings-sublabel">自動：由主席依問題決定</span>
            </div>
            <div className="chip-row">
              <button
                type="button"
                className={`chip small ${settings.seats ? '' : 'selected'}`}
                onClick={() => update({ seats: null })}
              >
                自動
              </button>
              <button
                type="button"
                className={`chip small ${settings.seats ? 'selected' : ''}`}
                onClick={() => update({ seats: settings.seats || Math.min(settings.maxSeats, 5) })}
              >
                固定
              </button>
            </div>
            {settings.seats && (
              <label className="seat-slider">
                <input
                  type="range"
                  min={limits.min}
                  max={limits.max}
                  value={settings.seats}
                  onChange={(e) => update({ seats: Number(e.target.value) })}
                />
                <span className="seat-count">{settings.seats} 席</span>
              </label>
            )}
            {!settings.seats && (
              <label className="max-seats">
                自動時最多
                <select
                  value={settings.maxSeats}
                  onChange={(e) => update({ maxSeats: Number(e.target.value) })}
                >
                  {seatOptions.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                席
              </label>
            )}
          </div>

          <div className="settings-row">
            <div className="settings-label">
              思考深度
              <span className="settings-sublabel">越深越慢、越耗額度，但想得更周延</span>
            </div>
            <div className="chip-row">
              <button
                type="button"
                className={`chip small ${settings.effort ? '' : 'selected'}`}
                onClick={() => update({ effort: null })}
              >
                預設
              </button>
              {council.efforts.map((level) => (
                <button
                  type="button"
                  key={level}
                  className={`chip small ${settings.effort === level ? 'selected' : ''}`}
                  onClick={() => update({ effort: level })}
                >
                  {EFFORT_LABELS[level]}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-label">
              主席
              <span className="settings-sublabel">負責分配席次與最後裁決</span>
            </div>
            <select
              className="chair-select"
              value={settings.chairman}
              onChange={(e) => update({ chairman: e.target.value })}
            >
              {catalog.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}{model.cost ? `（${model.cost}）` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
