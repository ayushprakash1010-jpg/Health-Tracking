// src/Metrics.js
import React from "react";

import "./Metrics.css";

const MetricBox = ({ value, label, color, largeValue }) => (
  <div className="metric-box">
    <div
      className="metric-value"
      style={{ color: color, fontSize: largeValue ? "2.1rem" : "1.8rem" }}
    >
      {value}
    </div>
    <div className="metric-label">{label}</div>
  </div>
);

const Metrics = ({
  blinkCount,
  totalBlinks,
  blinkRate,
  eyeStatus,
  timeSinceLastBlink,
  currentExpression,
  happyDuration,
  surprisedDuration,
  angryDuration,
  headPose,
  noseCoords,
  lastAction,
  patientStatus,
  gazeDirection,
  gazePoint,
}) => {
  return (
    <>
      <div className="left-bar">
        <div className="bar-title">Expressions</div>
        <MetricBox
          value={currentExpression}
          label="Current Expression"
          color="#ffd700"
          largeValue={true}
        />
        <MetricBox
          value={`${Math.round(happyDuration)}s`}
          label="Happy Duration"
          color="#ffd700"
        />
        <MetricBox
          value={`${Math.round(surprisedDuration)}s`}
          label="Surprised Duration"
          color="#ffd700"
        />
        <MetricBox
          value={`${Math.round(angryDuration)}s`}
          label="Angry/Stressed"
          color="#ffd700"
        />
      </div>

      <div className="right-bar">
        <div className="bar-title">Head & Gaze Tracking</div>
        <MetricBox
          value={headPose}
          label="Head Pose"
          color="#77aaff"
          largeValue={true}
        />
        <MetricBox
          value={gazeDirection}
          label="Gaze Direction"
          color="#ff6b6b"
          largeValue={true}
        />
        <MetricBox
          value={
            gazePoint
              ? `X:${(gazePoint.x * 100).toFixed(0)}% Y:${(gazePoint.y * 100).toFixed(0)}%`
              : "N/A"
          }
          label="Gaze Coordinates"
          color="#ff6b6b"
        />
        <MetricBox
          value={
            noseCoords
              ? `X:${noseCoords.x.toFixed(2)} Y:${noseCoords.y.toFixed(2)}`
              : "N/A"
          }
          label="Nose Position"
          color="#77aaff"
        />
        <MetricBox
          value={patientStatus}
          label="Patient Status"
          color="#d9a9ff"
          largeValue={true}
        />
      </div>

      <div className="bottom-bar">
        <MetricBox
          value={blinkCount}
          label="Consecutive Blinks"
          color="#4dff4d"
        />
        <MetricBox value={totalBlinks} label="Total Blinks" color="#4dff4d" />
        <MetricBox
          value={`${blinkRate} BPM`}
          label="Blink Rate"
          color="#4dff4d"
        />
        <MetricBox value={eyeStatus} label="Eye Status" color="#4dff4d" />
        <MetricBox
          value={`${Math.round(timeSinceLastBlink)}s`}
          label="Time Since Blink"
          color="#4dff4d"
        />
        <MetricBox
          value={lastAction}
          label="Last Action Triggered"
          color="#FFFFFF"
          largeValue={true}
        />
      </div>
    </>
  );
};

export default Metrics;