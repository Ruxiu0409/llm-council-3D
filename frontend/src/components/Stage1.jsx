import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { shortName } from '../names';
import './Stage1.css';

export default function Stage1({ responses, focus }) {
  const [activeTab, setActiveTab] = useState(0);
  const [lastFocusAt, setLastFocusAt] = useState(null);

  // Jump to the seat the user clicked in the chamber (once per click).
  if (focus && focus.at !== lastFocusAt) {
    const index = responses?.findIndex((r) => r.model === focus.model) ?? -1;
    if (index >= 0) {
      setLastFocusAt(focus.at);
      setActiveTab(index);
    }
  }

  if (!responses || responses.length === 0) {
    return null;
  }

  return (
    <div className="stage stage1">
      <h3 className="stage-title">Stage 1: Individual Responses</h3>

      <div className="tabs">
        {responses.map((resp, index) => (
          <button
            key={index}
            className={`tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            {shortName(resp.model)}
          </button>
        ))}
      </div>

      <div className="tab-content">
        <div className="model-name">{responses[activeTab].model}</div>
        <div className="response-text markdown-content">
          <ReactMarkdown>{responses[activeTab].response}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
