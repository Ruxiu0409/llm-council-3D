import { shortName } from '../names';
import './Stage0.css';

export default function Stage0({ plan }) {
  if (!plan || !plan.seats || plan.seats.length === 0) {
    return null;
  }

  return (
    <div className="stage stage0">
      <h3 className="stage-title">
        Stage 0: Convening the Council ({plan.seats.length} seats)
      </h3>
      {plan.reason && (
        <p className="stage-description">
          <span className="planner-name">{shortName(plan.planner)}:</span> {plan.reason}
        </p>
      )}

      <div className="seat-list">
        {plan.seats.map((seat) => (
          <div key={seat.id} className="seat-card">
            <div className="seat-header">
              <span className="seat-role">{seat.role || 'Open seat'}</span>
              <span className="seat-model">{seat.model}</span>
            </div>
            {seat.brief && <div className="seat-brief">{seat.brief}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
