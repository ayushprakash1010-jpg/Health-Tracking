// src/App.js
import React, { useRef, useEffect, useState } from "react";
import Webcam from "react-webcam";
import { FaceMesh, FACEMESH_TESSELATION } from "@mediapipe/face_mesh";
import { Camera } from "@mediapipe/camera_utils";
import { drawConnectors } from "@mediapipe/drawing_utils";
import Metrics from "./Metrics";
import "./App.css";

// --- Configuration Constants ---
const BLINK_THRESHOLD = 0.23;
const SLEEP_THRESHOLD_FRAMES = 210,
  AWAKE_THRESHOLD_FRAMES = 210;
const SMILE_THRESHOLD = 0.42,
  MOUTH_OPEN_THRESHOLD = 0.18,
  BROW_FURROW_THRESHOLD = 0.125;
const BLINK_RESET_FRAMES = 50;
const NOSE_X_THRESHOLD_LEFT = 0.47,
  NOSE_X_THRESHOLD_RIGHT = 0.53;
const NOSE_Y_THRESHOLD_UP = 0.43;
const NOSE_Y_THRESHOLD_DOWN = 0.6;
const GESTURE_SEQUENCE_FRAMES = 60;
const GESTURE_ACTIONS = {
  WASHROOM: ["Left", "Right", "Left", "Right"],
  EMERGENCY: ["Up", "Down", "Up", "Down"],
};
const RIGHT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
const LEFT_EYE_INDICES = [362, 385, 387, 263, 373, 380];

// // Eye tracking specific landmarks
// const RIGHT_EYE_CENTER = 468;
// const LEFT_EYE_CENTER = 473;
const RIGHT_IRIS = [469, 470, 471, 472];
const LEFT_IRIS = [474, 475, 476, 477];

function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const pipCanvasRef = useRef(null);
  const gazeOverlayRef = useRef(null);

  const [lastAction, setLastAction] = useState("None");
  const [headPose, setHeadPose] = useState("Center");
  const [patientStatus, setPatientStatus] = useState("Awake");
  const [currentExpression, setCurrentExpression] = useState("Neutral");
  const [blinkCount, setBlinkCount] = useState(0);
  const [totalBlinks, setTotalBlinks] = useState(0);
  const [blinkRate, setBlinkRate] = useState(0);
  const [eyeStatus, setEyeStatus] = useState("Open");
  const [timeSinceLastBlink, setTimeSinceLastBlink] = useState(0);
  const [noseCoords, setNoseCoords] = useState(null);
  const [gazePoint, setGazePoint] = useState({ x: 0, y: 0 });
  const [gazeDirection, setGazeDirection] = useState("Center");

  // Smoothing for gaze tracking
  const gazeHistoryRef = useRef([]);
  const GAZE_HISTORY_SIZE = 5;

  const expressionDurationsRef = useRef({
    Happy: 0,
    Surprised: 0,
    Neutral: 0,
    Angry: 0,
  });
  const lastFrameTimeRef = useRef(performance.now());
  const blinkTimestampsRef = useRef([]);
  const lastBlinkTimeRef = useRef(Date.now());
  const consecutiveBlinksRef = useRef(0);
  const inBlinkRef = useRef(false);
  const blinkFrameCounterRef = useRef(0);
  const eyesClosedFrameCounterRef = useRef(0);
  const eyesOpenFrameCounterRef = useRef(0);
  const gestureSequenceRef = useRef([]);
  const gestureFrameCounterRef = useRef(0);
  const lastDirectionRef = useRef(null);
  const lastActionSentRef = useRef("None");

  // Eye tracking functions
  const calculateGazeDirection = (landmarks) => {
    if (!landmarks || landmarks.length < 478) return null;

    try {
      // Get iris landmarks (if available with refined landmarks)
      const rightIris = RIGHT_IRIS.map(i => landmarks[i]).filter(Boolean);
      const leftIris = LEFT_IRIS.map(i => landmarks[i]).filter(Boolean);
      
      // Fallback to eye corners and center points
      const rightEyeCornerOuter = landmarks[33];
      const rightEyeCornerInner = landmarks[133];
      const leftEyeCornerOuter = landmarks[362];
      const leftEyeCornerInner = landmarks[263];
      
      const rightEyeTop = landmarks[159];
      const rightEyeBottom = landmarks[145];
      const leftEyeTop = landmarks[386];
      const leftEyeBottom = landmarks[374];

      if (!rightEyeCornerOuter || !rightEyeCornerInner || !leftEyeCornerOuter || !leftEyeCornerInner) {
        return null;
      }

      // Calculate eye centers
      const rightEyeCenter = {
        x: (rightEyeCornerOuter.x + rightEyeCornerInner.x) / 2,
        y: (rightEyeTop.y + rightEyeBottom.y) / 2
      };
      
      const leftEyeCenter = {
        x: (leftEyeCornerOuter.x + leftEyeCornerInner.x) / 2,
        y: (leftEyeTop.y + leftEyeBottom.y) / 2
      };

      // Use iris data if available, otherwise use pupil estimation
      let rightPupil, leftPupil;
      
      if (rightIris.length >= 4) {
        rightPupil = {
          x: rightIris.reduce((sum, p) => sum + p.x, 0) / rightIris.length,
          y: rightIris.reduce((sum, p) => sum + p.y, 0) / rightIris.length
        };
      } else {
        // Estimate pupil position based on eye geometry
        rightPupil = { ...rightEyeCenter };
      }
      
      if (leftIris.length >= 4) {
        leftPupil = {
          x: leftIris.reduce((sum, p) => sum + p.x, 0) / leftIris.length,
          y: leftIris.reduce((sum, p) => sum + p.y, 0) / leftIris.length
        };
      } else {
        // Estimate pupil position based on eye geometry
        leftPupil = { ...leftEyeCenter };
      }

      // Calculate gaze ratios
      const rightEyeWidth = Math.abs(rightEyeCornerOuter.x - rightEyeCornerInner.x);
      const leftEyeWidth = Math.abs(leftEyeCornerOuter.x - leftEyeCornerInner.x);
      const rightEyeHeight = Math.abs(rightEyeTop.y - rightEyeBottom.y);
      const leftEyeHeight = Math.abs(leftEyeTop.y - leftEyeBottom.y);

      // Calculate relative pupil position within each eye
      const rightGazeX = (rightPupil.x - rightEyeCenter.x) / (rightEyeWidth / 2);
      const rightGazeY = (rightPupil.y - rightEyeCenter.y) / (rightEyeHeight / 2);
      const leftGazeX = (leftPupil.x - leftEyeCenter.x) / (leftEyeWidth / 2);
      const leftGazeY = (leftPupil.y - leftEyeCenter.y) / (leftEyeHeight / 2);

      // Average both eyes for more stable tracking
      const avgGazeX = (rightGazeX + leftGazeX) / 2;
      const avgGazeY = (rightGazeY + leftGazeY) / 2;

      // FIXED: Convert to screen coordinates with proper mirroring and full range
      // For X: Flip the horizontal coordinate to match natural eye movement
      // When you look left, gaze should appear on left side of screen
      const screenX = Math.max(0, Math.min(1, 0.5 - avgGazeX * 0.8)); // Flipped and increased sensitivity
      
      // For Y: Expand the vertical range to cover full screen
      // Increased multiplier and adjusted offset for full screen coverage
      const screenY = Math.max(0, Math.min(1, 0.5 + avgGazeY * 1.2)); // Increased sensitivity for full range

      return { x: screenX, y: screenY, gazeX: avgGazeX, gazeY: avgGazeY };
    } catch (error) {
      console.warn('Gaze calculation error:', error);
      return null;
    }
  };

  const smoothGaze = (newGaze) => {
    if (!newGaze) return { x: 0.5, y: 0.5 };

    gazeHistoryRef.current.push(newGaze);
    if (gazeHistoryRef.current.length > GAZE_HISTORY_SIZE) {
      gazeHistoryRef.current.shift();
    }

    // Calculate weighted average (more recent points have higher weight)
    let totalWeight = 0;
    let weightedX = 0;
    let weightedY = 0;

    gazeHistoryRef.current.forEach((point, index) => {
      const weight = (index + 1) / gazeHistoryRef.current.length;
      weightedX += point.x * weight;
      weightedY += point.y * weight;
      totalWeight += weight;
    });

    return {
      x: weightedX / totalWeight,
      y: weightedY / totalWeight
    };
  };

  const getGazeDirectionFromCoords = (gazeX, gazeY) => {
    // Reduced threshold for more sensitive direction detection
    const threshold = 0.12;
    
    if (Math.abs(gazeX) < threshold && Math.abs(gazeY) < threshold) {
      return "Center";
    }
    
    if (Math.abs(gazeX) > Math.abs(gazeY)) {
      return gazeX > threshold ? "Right" : gazeX < -threshold ? "Left" : "Center";
    } else {
      return gazeY > threshold ? "Down" : gazeY < -threshold ? "Up" : "Center";
    }
  };

  const onResults = (results) => {
    if (
      !canvasRef.current ||
      !pipCanvasRef.current ||
      !gazeOverlayRef.current ||
      !results.multiFaceLandmarks ||
      !results.multiFaceLandmarks[0]
    )
      return;
    
    const now = performance.now();
    const deltaTime = (now - lastFrameTimeRef.current) / 1000;
    lastFrameTimeRef.current = now;

    const canvasCtx = canvasRef.current.getContext("2d");
    canvasCtx.save();
    canvasCtx.clearRect(
      0,
      0,
      canvasRef.current.width,
      canvasRef.current.height
    );
    canvasCtx.drawImage(
      results.image,
      0,
      0,
      canvasRef.current.width,
      canvasRef.current.height
    );

    const landmarks = results.multiFaceLandmarks[0];

    // Eye tracking and gaze calculation
    const gazeData = calculateGazeDirection(landmarks);
    if (gazeData) {
      const smoothedGaze = smoothGaze(gazeData);
      setGazePoint(smoothedGaze);
      setGazeDirection(getGazeDirectionFromCoords(gazeData.gazeX, gazeData.gazeY));
      
      // Update gaze overlay to cover entire viewport
      const overlay = gazeOverlayRef.current;
      if (overlay) {
        // Calculate position relative to entire viewport
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const dotX = smoothedGaze.x * viewportWidth;
        const dotY = smoothedGaze.y * viewportHeight;
        
        // Update CSS custom properties for smooth animation
        overlay.style.setProperty('--gaze-x', `${dotX}px`);
        overlay.style.setProperty('--gaze-y', `${dotY}px`);
      }
    }

    const pipCtx = pipCanvasRef.current.getContext("2d");
    pipCtx.save();
    pipCtx.clearRect(
      0,
      0,
      pipCanvasRef.current.width,
      pipCanvasRef.current.height
    );
    pipCtx.drawImage(
      results.image,
      0,
      0,
      pipCanvasRef.current.width,
      pipCanvasRef.current.height
    );
    drawConnectors(pipCtx, landmarks, FACEMESH_TESSELATION, {
      color: "#00ff8970",
      lineWidth: 0.5,
    });

    // Draw eye tracking indicators on pip canvas
    if (gazeData) {
      pipCtx.fillStyle = "#ff0000";
      pipCtx.strokeStyle = "#ffffff";
      pipCtx.lineWidth = 2;
      
      // Draw gaze direction indicators
      const centerX = pipCanvasRef.current.width / 2;
      const centerY = pipCanvasRef.current.height / 2;
      const gazeX = centerX + gazeData.gazeX * 50;
      const gazeY = centerY + gazeData.gazeY * 50;
      
      pipCtx.beginPath();
      pipCtx.arc(gazeX, gazeY, 6, 0, 2 * Math.PI);
      pipCtx.fill();
      pipCtx.stroke();
    }
    
    pipCtx.restore();

    const euclideanDistance = (p1, p2) =>
      Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
    const calculateEAR = (landmarks, eyeIndices) => {
      const p1 = landmarks[eyeIndices[0]],
        p2 = landmarks[eyeIndices[1]],
        p3 = landmarks[eyeIndices[2]],
        p4 = landmarks[eyeIndices[3]],
        p5 = landmarks[eyeIndices[4]],
        p6 = landmarks[eyeIndices[5]];
      return (
        (euclideanDistance(p2, p6) + euclideanDistance(p3, p5)) /
        (2.0 * euclideanDistance(p1, p4))
      );
    };

    const rightEAR = calculateEAR(landmarks, RIGHT_EYE_INDICES);
    const leftEAR = calculateEAR(landmarks, LEFT_EYE_INDICES);
    const avgEAR = (leftEAR + rightEAR) / 2.0;

    setEyeStatus(avgEAR < BLINK_THRESHOLD ? "Closed" : "Open");

    if (avgEAR < BLINK_THRESHOLD) {
      if (!inBlinkRef.current) {
        inBlinkRef.current = true;
        consecutiveBlinksRef.current++;
        setBlinkCount(consecutiveBlinksRef.current);
        setTotalBlinks((prev) => prev + 1);
        blinkTimestampsRef.current.push(Date.now());
        lastBlinkTimeRef.current = Date.now();
      }
      blinkFrameCounterRef.current = 0;
      eyesOpenFrameCounterRef.current = 0;
      eyesClosedFrameCounterRef.current++;
      if (eyesClosedFrameCounterRef.current > SLEEP_THRESHOLD_FRAMES) {
        setPatientStatus((currentStatus) =>
          currentStatus === "Awake" ? "Sleeping" : currentStatus
        );
      }
    } else {
      inBlinkRef.current = false;
      eyesClosedFrameCounterRef.current = 0;
      eyesOpenFrameCounterRef.current++;
      if (eyesOpenFrameCounterRef.current > AWAKE_THRESHOLD_FRAMES) {
        setPatientStatus((currentStatus) =>
          currentStatus === "Sleeping" ? "Awake" : currentStatus
        );
      }
      blinkFrameCounterRef.current++;
      if (blinkFrameCounterRef.current > BLINK_RESET_FRAMES) {
        if (consecutiveBlinksRef.current === 5)
          setLastAction("Water Requested");
        else if (consecutiveBlinksRef.current === 7)
          setLastAction("Food Requested");
        consecutiveBlinksRef.current = 0;
        setBlinkCount(0);
      }
    }

    const processHeadGesture = (direction) => {
      if (direction !== lastDirectionRef.current && direction !== "Center") {
        gestureSequenceRef.current.push(direction);
        lastDirectionRef.current = direction;
        gestureFrameCounterRef.current = 0;
        if (
          gestureSequenceRef.current.slice(-4).join(",") ===
          GESTURE_ACTIONS.WASHROOM.join(",")
        ) {
          setLastAction("Washroom Requested");
          gestureSequenceRef.current = [];
        }
        if (
          gestureSequenceRef.current.slice(-4).join(",") ===
          GESTURE_ACTIONS.EMERGENCY.join(",")
        ) {
          setLastAction("EMERGENCY ALERT");
          gestureSequenceRef.current = [];
        }
      }
    };

    const nose = landmarks[1];
    if (nose) {
      const mirroredX = 1.0 - nose.x;
      const noseY = nose.y;
      setNoseCoords({ x: mirroredX, y: noseY });
      let currentDirection = "Center";

      if (mirroredX < NOSE_X_THRESHOLD_LEFT) currentDirection = "Left";
      else if (mirroredX > NOSE_X_THRESHOLD_RIGHT) currentDirection = "Right";
      else if (noseY < NOSE_Y_THRESHOLD_UP) currentDirection = "Up";
      else if (noseY > NOSE_Y_THRESHOLD_DOWN) currentDirection = "Down";

      setHeadPose(currentDirection);
      processHeadGesture(currentDirection);
    }

    const leftMouth = landmarks[61],
      rightMouth = landmarks[291];
    const topLip = landmarks[13],
      bottomLip = landmarks[14];
    const leftFace = landmarks[234],
      rightFace = landmarks[454];
    const innerLeftBrow = landmarks[55],
      innerRightBrow = landmarks[285];
    if (
      leftMouth &&
      rightMouth &&
      topLip &&
      bottomLip &&
      leftFace &&
      rightFace &&
      innerLeftBrow &&
      innerRightBrow
    ) {
      const mouthWidth = euclideanDistance(leftMouth, rightMouth);
      const faceWidth = euclideanDistance(leftFace, rightFace);
      const smileRatio = mouthWidth / faceWidth;
      const mouthHeight = euclideanDistance(topLip, bottomLip);
      const faceHeight = Math.abs(landmarks[10].y - landmarks[152].y);
      const mouthOpenRatio = mouthHeight / faceHeight;
      const browDistance = euclideanDistance(innerLeftBrow, innerRightBrow);
      const browFurrowRatio = browDistance / faceWidth;

      let detectedExpression = "Neutral";
      if (smileRatio > SMILE_THRESHOLD) detectedExpression = "Happy";
      else if (mouthOpenRatio > MOUTH_OPEN_THRESHOLD)
        detectedExpression = "Surprised";
      else if (browFurrowRatio < BROW_FURROW_THRESHOLD)
        detectedExpression = "Angry";

      setCurrentExpression(detectedExpression);
      expressionDurationsRef.current[detectedExpression] += deltaTime;
    }

    gestureFrameCounterRef.current++;
    if (gestureFrameCounterRef.current > GESTURE_SEQUENCE_FRAMES) {
      gestureSequenceRef.current = [];
      lastDirectionRef.current = "Center";
    }
    canvasCtx.restore();
  };

  useEffect(() => {
    let messageToSend = null;
    if (lastAction !== "None" && lastAction !== lastActionSentRef.current) {
      messageToSend = `🚨 Patient Alert: ${lastAction}`;
      lastActionSentRef.current = lastAction;
    } else if (
      patientStatus === "Sleeping" &&
      lastActionSentRef.current !== "Patient is Sleeping"
    ) {
      messageToSend = `💤 Patient Status: Sleeping`;
      lastActionSentRef.current = "Patient is Sleeping";
    } else if (
      patientStatus === "Awake" &&
      lastActionSentRef.current === "Patient is Sleeping"
    ) {
      messageToSend = `☀️ Patient Status: Awake`;
      lastActionSentRef.current = "Awake";
    }
    if (messageToSend) {
      fetch("http://localhost:3001/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageToSend }),
      }).catch((error) => console.error("Error sending notification:", error));
    }
    fetch("http://localhost:3001/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: patientStatus }),
    }).catch((error) => console.error("Error updating server status:", error));
  }, [lastAction, patientStatus]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetch("http://localhost:3001/update-expressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durations: expressionDurationsRef.current }),
      }).catch((error) => console.error("Error updating expressions:", error));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const oneMinuteAgo = Date.now() - 60000;
      blinkTimestampsRef.current = blinkTimestampsRef.current.filter(
        (ts) => ts > oneMinuteAgo
      );
      setBlinkRate(blinkTimestampsRef.current.length);
      setTimeSinceLastBlink((Date.now() - lastBlinkTimeRef.current) / 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const faceMesh = new FaceMesh({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`,
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    faceMesh.onResults(onResults);
    if (webcamRef.current && webcamRef.current.video) {
      const camera = new Camera(webcamRef.current.video, {
        onFrame: async () => {
          if (webcamRef.current && webcamRef.current.video)
            await faceMesh.send({ image: webcamRef.current.video });
        },
        width: 640,
        height: 480,
      });
      camera.start();
    }
  }, []);//eslint-disable-line


  return (
    <div className="App">
      <div className="master-container">
        <h1 className="main-title">Healthcare Gesture Control System</h1>
        <div className="container">
          <Webcam ref={webcamRef} className="webcam" />
          <canvas ref={canvasRef} className="canvas" />
          <canvas ref={pipCanvasRef} className="pip-canvas" />
          
          {/* Gaze tracking overlay */}
          <div ref={gazeOverlayRef} className="gaze-overlay">
            <div className="gaze-dot"></div>
          </div>
        </div>
        <Metrics
          blinkCount={blinkCount}
          totalBlinks={totalBlinks}
          blinkRate={blinkRate}
          eyeStatus={eyeStatus}
          timeSinceLastBlink={timeSinceLastBlink}
          currentExpression={currentExpression}
          happyDuration={expressionDurationsRef.current.Happy}
          surprisedDuration={expressionDurationsRef.current.Surprised}
          angryDuration={expressionDurationsRef.current.Angry}
          headPose={headPose}
          noseCoords={noseCoords}
          lastAction={lastAction}
          patientStatus={patientStatus}
          gazeDirection={gazeDirection}
          gazePoint={gazePoint}
        />
      </div>
    </div>
  );
}

export default App;