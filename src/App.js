// src/App.js
import React, { useRef, useEffect, useState } from "react";
import Webcam from "react-webcam";
import { FaceMesh } from "@mediapipe/face_mesh";
import { Camera } from "@mediapipe/camera_utils";
import "./App.css";

// --- Configuration Constants ---
const BLINK_THRESHOLD = 0.23;
const DWELL_TIME = 4000; // 4 seconds to trigger selection
const BLINK_COOLDOWN = 500;
const RIGHT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
const LEFT_EYE_INDICES = [362, 385, 387, 263, 373, 380];
const RIGHT_IRIS = [469, 470, 471, 472];
const LEFT_IRIS = [474, 475, 476, 477];

// --- Cursor smoothing ---
const SMOOTHING_FACTOR = 0.7; // closer to 1 = smoother but slower
let lastSmoothed = { x: 0.5, y: 0.5 };

function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const gazeOverlayRef = useRef(null);

  const [isTracking, setIsTracking] = useState(false);
  const [gazePoint, setGazePoint] = useState({ x: 0.5, y: 0.5 }); //eslint-disable-line
  const [currentQuadrant, setCurrentQuadrant] = useState(null);
  const [dwellProgress, setDwellProgress] = useState({});
  const [lastSelection, setLastSelection] = useState(null);
  const [eyeStatus, setEyeStatus] = useState("Open");

  const dwellTimersRef = useRef({});
  const dwellStartTimeRef = useRef({});
  const lastBlinkTimeRef = useRef(0);
  const inBlinkRef = useRef(false);

  const quadrants = [
    { id: "water", name: "Water", icon: "💧", color: "#d4e8ff", textColor: "#1976d2" },
    { id: "food", name: "Food", icon: "🍴", color: "#d4f4dd", textColor: "#2e7d32" },
    { id: "emergency", name: "Emergency", icon: "⚠️", color: "#ffd4e5", textColor: "#c62828" },
    { id: "help", name: "Help", icon: "👁️", color: "#fff7c2", textColor: "#f57f17" }
  ];

  // --- Stable gaze filter ---
  const smoothGaze = (newGaze) => {
    if (!newGaze) return lastSmoothed;
    lastSmoothed = {
      x: lastSmoothed.x * SMOOTHING_FACTOR + newGaze.x * (1 - SMOOTHING_FACTOR),
      y: lastSmoothed.y * SMOOTHING_FACTOR + newGaze.y * (1 - SMOOTHING_FACTOR),
    };
    return lastSmoothed;
  };

  // --- EAR (Eye Aspect Ratio) for blink detection ---
  const calculateEAR = (landmarks, eyeIndices) => {
    const euclideanDistance = (p1, p2) =>
      Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);

    const p1 = landmarks[eyeIndices[0]];
    const p2 = landmarks[eyeIndices[1]];
    const p3 = landmarks[eyeIndices[2]];
    const p4 = landmarks[eyeIndices[3]];
    const p5 = landmarks[eyeIndices[4]];
    const p6 = landmarks[eyeIndices[5]];

    return (
      (euclideanDistance(p2, p6) + euclideanDistance(p3, p5)) /
      (2.0 * euclideanDistance(p1, p4))
    );
  };

  // --- Quadrant detection ---
  const getQuadrantFromGaze = (x, y) => {
    if (x < 0.5 && y < 0.5) return "water";
    if (x >= 0.5 && y < 0.5) return "food";
    if (x < 0.5 && y >= 0.5) return "emergency";
    if (x >= 0.5 && y >= 0.5) return "help";
    return null;
  };

  // --- Handle selection + backend notification ---
  const handleSelection = async (quadrantId) => {
    const quadrant = quadrants.find((q) => q.id === quadrantId);
    setLastSelection(quadrant.name);

    // Notify backend
    try {
      await fetch("http://localhost:5000/selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selection: quadrant.name,
          timestamp: Date.now(),
        }),
      });
    } catch (err) {
      console.error("Failed to notify backend:", err);
    }

    // Reset dwell
    dwellTimersRef.current = {};
    dwellStartTimeRef.current = {};
    setDwellProgress({});

    setTimeout(() => setLastSelection(null), 3000);
  };

  // --- Calculate gaze direction ---
  const calculateGazeDirection = (landmarks) => {
    if (!landmarks || landmarks.length < 478) return null;
    try {
      const rightIris = RIGHT_IRIS.map((i) => landmarks[i]).filter(Boolean);
      const leftIris = LEFT_IRIS.map((i) => landmarks[i]).filter(Boolean);

      const rightEyeCornerOuter = landmarks[33];
      const rightEyeCornerInner = landmarks[133];
      const leftEyeCornerOuter = landmarks[362];
      const leftEyeCornerInner = landmarks[263];

      const rightEyeTop = landmarks[159];
      const rightEyeBottom = landmarks[145];
      const leftEyeTop = landmarks[386];
      const leftEyeBottom = landmarks[374];

      const rightEyeCenter = {
        x: (rightEyeCornerOuter.x + rightEyeCornerInner.x) / 2,
        y: (rightEyeTop.y + rightEyeBottom.y) / 2,
      };
      const leftEyeCenter = {
        x: (leftEyeCornerOuter.x + leftEyeCornerInner.x) / 2,
        y: (leftEyeTop.y + leftEyeBottom.y) / 2,
      };

      const rightPupil = rightIris.length >= 4
        ? {
            x: rightIris.reduce((sum, p) => sum + p.x, 0) / rightIris.length,
            y: rightIris.reduce((sum, p) => sum + p.y, 0) / rightIris.length,
          }
        : { ...rightEyeCenter };

      const leftPupil = leftIris.length >= 4
        ? {
            x: leftIris.reduce((sum, p) => sum + p.x, 0) / leftIris.length,
            y: leftIris.reduce((sum, p) => sum + p.y, 0) / leftIris.length,
          }
        : { ...leftEyeCenter };

      const rightEyeWidth = Math.abs(rightEyeCornerOuter.x - rightEyeCornerInner.x);
      const leftEyeWidth = Math.abs(leftEyeCornerOuter.x - leftEyeCornerInner.x);
      const rightEyeHeight = Math.abs(rightEyeTop.y - rightEyeBottom.y);
      const leftEyeHeight = Math.abs(leftEyeTop.y - leftEyeBottom.y);

      const rightGazeX = (rightPupil.x - rightEyeCenter.x) / (rightEyeWidth / 2);
      const rightGazeY = (rightPupil.y - rightEyeCenter.y) / (rightEyeHeight / 2);
      const leftGazeX = (leftPupil.x - leftEyeCenter.x) / (leftEyeWidth / 2);
      const leftGazeY = (leftPupil.y - leftEyeCenter.y) / (leftEyeHeight / 2);

      const avgGazeX = (rightGazeX + leftGazeX) / 2;
      const avgGazeY = (rightGazeY + leftGazeY) / 2;

      const screenX = Math.max(0, Math.min(1, 0.5 - avgGazeX * 0.8));
      const screenY = Math.max(0, Math.min(1, 0.5 + avgGazeY * 1.2));

      return { x: screenX, y: screenY };
    } catch (err) {
      console.warn("Gaze calculation error:", err);
      return null;
    }
  };

  // --- Mediapipe onResults callback ---
  const onResults = (results) => {
    if (!results.multiFaceLandmarks || !results.multiFaceLandmarks[0]) return;
    const landmarks = results.multiFaceLandmarks[0];

    // Blink detection
    const rightEAR = calculateEAR(landmarks, RIGHT_EYE_INDICES);
    const leftEAR = calculateEAR(landmarks, LEFT_EYE_INDICES);
    const avgEAR = (leftEAR + rightEAR) / 2.0;
    setEyeStatus(avgEAR < BLINK_THRESHOLD ? "Closed" : "Open");

    const now = Date.now();
    if (avgEAR < BLINK_THRESHOLD) {
      if (!inBlinkRef.current && now - lastBlinkTimeRef.current > BLINK_COOLDOWN) {
        inBlinkRef.current = true;
        lastBlinkTimeRef.current = now;

        if (currentQuadrant && dwellProgress[currentQuadrant] >= 100) {
          handleSelection(currentQuadrant);
        }
      }
    } else {
      inBlinkRef.current = false;
    }

    // Gaze calculation
    const gazeData = calculateGazeDirection(landmarks);
    if (gazeData) {
      const smoothedGaze = smoothGaze(gazeData);
      setGazePoint(smoothedGaze);

      const quadrant = getQuadrantFromGaze(smoothedGaze.x, smoothedGaze.y);
      setCurrentQuadrant(quadrant);

      const overlay = gazeOverlayRef.current;
      if (overlay) {
        const dotX = smoothedGaze.x * window.innerWidth;
        const dotY = smoothedGaze.y * window.innerHeight;
        overlay.style.left = `${dotX}px`;
        overlay.style.top = `${dotY}px`;
      }

      // Dwell timing
      if (quadrant) {
        if (!dwellStartTimeRef.current[quadrant]) {
          dwellStartTimeRef.current[quadrant] = now;
        }
        const elapsed = now - dwellStartTimeRef.current[quadrant];
        const progress = Math.min((elapsed / DWELL_TIME) * 100, 100);
        setDwellProgress((prev) => ({ ...prev, [quadrant]: progress }));
      }

      // Clear other quadrants
      Object.keys(dwellStartTimeRef.current).forEach((key) => {
        if (key !== quadrant) {
          delete dwellStartTimeRef.current[key];
          setDwellProgress((prev) => {
            const newProgress = { ...prev };
            delete newProgress[key];
            return newProgress;
          });
        }
      });
    }
  };

  // --- Initialize Mediapipe FaceMesh ---
  useEffect(() => {
    const faceMesh = new FaceMesh({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    faceMesh.onResults(onResults);

    if (webcamRef.current && webcamRef.current.video) {
      const camera = new Camera(webcamRef.current.video, {
        onFrame: async () => {
          if (webcamRef.current && webcamRef.current.video) {
            await faceMesh.send({ image: webcamRef.current.video });
          }
        },
        width: 640,
        height: 480,
      });
      camera.start();
      setIsTracking(true);
    }
  }, []);//eslint-disable-line

  return (
    <div className="App">
      {/* Header */}
      <div className="header">
        <h1 className="header-title">Eye-Gaze Communication Interface</h1>
        <div className="tracking-status">
          {isTracking && (
            <>
              <div className="tracking-dot"></div>
              <span>Tracking Active</span>
            </>
          )}
        </div>
      </div>

      {/* Quadrants */}
      <div className="quadrant-grid">
        {quadrants.map((quadrant) => {
          const progress = dwellProgress[quadrant.id] || 0;
          const isActive = currentQuadrant === quadrant.id;
          return (
            <div
              key={quadrant.id}
              className={`quadrant ${isActive ? "active" : ""}`}
              style={{ backgroundColor: quadrant.color }}
            >
              <div className="quadrant-content">
                <div className="quadrant-icon">{quadrant.icon}</div>
                <h2 className="quadrant-title" style={{ color: quadrant.textColor }}>
                  {quadrant.name}
                </h2>
              </div>

              {isActive && progress > 0 && (
                <div className="progress-ring">
                  <svg width="200" height="200">
                    <circle
                      cx="100"
                      cy="100"
                      r="80"
                      stroke={quadrant.textColor}
                      strokeWidth="8"
                      fill="none"
                      opacity="0.2"
                    />
                    <circle
                      cx="100"
                      cy="100"
                      r="80"
                      stroke={quadrant.textColor}
                      strokeWidth="8"
                      fill="none"
                      strokeDasharray={`${2 * Math.PI * 80}`}
                      strokeDashoffset={`${2 * Math.PI * 80 * (1 - progress / 100)}`}
                      style={{
                        transform: "rotate(-90deg)",
                        transformOrigin: "100px 100px",
                        transition: "stroke-dashoffset 0.1s linear",
                      }}
                    />
                  </svg>
                </div>
              )}

              {isActive && progress >= 100 && (
                <div className="blink-prompt" style={{ backgroundColor: quadrant.textColor }}>
                  <span>Blink to Select</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Cursor */}
      <div ref={gazeOverlayRef} className="gaze-cursor">
        <div className={`gaze-dot ${eyeStatus === "Closed" ? "blinking" : ""}`}></div>
      </div>

      {/* Instructions */}
      {!isTracking && (
        <div className="instructions">
          <h3>How to use:</h3>
          <ol>
            <li>1. Allow camera access</li>
            <li>2. Look at any quadrant for 4 seconds</li>
            <li>3. The red cursor shows your gaze position</li>
            <li>4. A ring fills as you focus on an icon</li>
            <li>5. When ready, <strong>blink</strong> to select</li>
          </ol>
        </div>
      )}

      {/* Feedback */}
      {lastSelection && (
        <div className="selection-feedback">
          <h2>{lastSelection} Selected! ✓</h2>
        </div>
      )}

      <Webcam ref={webcamRef} className="webcam-hidden" />
      <canvas ref={canvasRef} className="canvas-hidden" />
    </div>
  );
}

export default App;
