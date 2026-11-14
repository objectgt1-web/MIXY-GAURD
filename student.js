
const SUPABASE_URL = "https://oikvlwlavggcanjnugco.supabase.co";
const SUPABASE_KEY = "sb_publishable_d2QW2n-Y2_bMlGexo0aOaA_FcK7mFuB";

const form = document.getElementById("joinForm");
const message = document.getElementById("message");
const shareSection = document.getElementById("shareSection");
const requestMessage = document.getElementById("requestMessage");
const acceptButton = document.getElementById("acceptButton");
const declineButton = document.getElementById("declineButton");
const stopButton = document.getElementById("stopButton");
const preview = document.getElementById("preview");

let session = null;
let currentRequest = null;
let screenStream = null;
let peer = null;
let pollTimer = null;
let signalTimer = null;
let lastSignalId = 0;
let pendingCandidates = [];

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

// SAFE STORAGE

function hasExtensionStorage() {
  return !!globalThis.chrome?.storage?.local;
}

async function storageGet(keys) {
  if (hasExtensionStorage()) {
    try {
      return await new Promise((resolve, reject) => {
        globalThis.chrome.storage.local.get(keys, result => {
          const error = globalThis.chrome?.runtime?.lastError;

          if (error) {
            reject(new Error(error.message));
          } else {
            resolve(result || {});
          }
        });
      });
    } catch (error) {
      console.warn("Extension storage unavailable:", error);
    }
  }

  const result = {};

  for (const key of keys) {
    try {
      const saved = sessionStorage.getItem(key);
      result[key] = saved ? JSON.parse(saved) : undefined;
    } catch {
      result[key] = undefined;
    }
  }

  return result;
}

async function storageSet(data) {
  if (hasExtensionStorage()) {
    try {
      await new Promise((resolve, reject) => {
        globalThis.chrome.storage.local.set(data, () => {
          const error = globalThis.chrome?.runtime?.lastError;

          if (error) {
            reject(new Error(error.message));
          } else {
            resolve();
          }
        });
      });

      return;
    } catch (error) {
      console.warn("Extension storage unavailable:", error);
    }
  }

  for (const [key, value] of Object.entries(data)) {
    sessionStorage.setItem(key, JSON.stringify(value));
  }
}

// SUPABASE CONTROL

async function control(action, extra = {}) {
  if (!session?.token) {
    throw new Error("Join your classroom first.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/screen-control`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        "x-student-session": session.token
      },
      body: JSON.stringify({ action, ...extra })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Screen control failed.");
  }

  return result;
}

// CHECK FOR TEACHER REQUESTS

async function checkForRequests() {
  if (!session || currentRequest || screenStream) return;

  try {
    const result = await control("student_poll");

    if (result.requests?.length > 0) {
      currentRequest = result.requests[0];

      requestMessage.textContent =
        "Your teacher requested a screen share. You can accept or decline.";

      acceptButton.hidden = false;
      declineButton.hidden = false;
      acceptButton.disabled = false;
    } else {
      requestMessage.textContent = "Waiting for your teacher...";
    }
  } catch (error) {
    requestMessage.textContent = error.message;
    console.error("Request polling error:", error);
  }
}

function startRequestPolling() {
  clearInterval(pollTimer);
  checkForRequests();
  pollTimer = setInterval(checkForRequests, 3000);
}

// WEBRTC SIGNALING

async function sendSignal(payload) {
  if (!currentRequest) return;

  await control("send_signal", {
    requestId: currentRequest.id,
    payload
  });
}

async function addCandidate(candidate) {
  if (!peer || !candidate) return;

  if (!peer.remoteDescription) {
    pendingCandidates.push(candidate);
    return;
  }

  try {
    await peer.addIceCandidate(
      new RTCIceCandidate(candidate)
    );
  } catch (error) {
    console.error("ICE candidate error:", error);
  }
}

async function flushCandidates() {
  const candidates = pendingCandidates;
  pendingCandidates = [];

  for (const candidate of candidates) {
    await addCandidate(candidate);
  }
}

async function handleTeacherSignals() {
  if (!currentRequest || !peer) return;

  try {
    const result = await control("get_signals", {
      requestId: currentRequest.id,
      afterId: lastSignalId
    });

    for (const signal of result.signals || []) {
      lastSignalId = Math.max(lastSignalId, signal.id);

      if (signal.payload.type === "answer") {
        if (!peer.remoteDescription) {
          await peer.setRemoteDescription(
            new RTCSessionDescription(signal.payload.description)
          );

          await flushCandidates();

          requestMessage.textContent =
            "Connected. Your screen is being shared.";
        }
      }

      if (signal.payload.type === "candidate") {
        await addCandidate(signal.payload.candidate);
      }
    }
  } catch (error) {
    console.error("Signal polling error:", error);
  }
}

function startSignalPolling() {
  clearInterval(signalTimer);
  handleTeacherSignals();
  signalTimer = setInterval(handleTeacherSignals, 1000);
}

// JOIN CLASSROOM

form.addEventListener("submit", async event => {
  event.preventDefault();

  const studentName =
    document.getElementById("studentName").value.trim();

  const code =
    document.getElementById("code").value.trim();

  message.textContent = "Joining classroom...";

  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/join-class`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY
        },
        body: JSON.stringify({ studentName, code })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Could not join classroom.");
    }

    if (!result.studentSessionToken || !result.student?.id) {
      throw new Error("Student session was not returned.");
    }

    session = {
      token: result.studentSessionToken,
      studentId: result.student.id,
      classroomId: result.student.classroom_id,
      studentName: result.student.student_name
    };

    await storageSet({
      mixyStudentSession: session
    });

    form.hidden = true;
    shareSection.style.display = "block";

    message.textContent = `Joined ${result.classroomName}!`;
    requestMessage.textContent = "Waiting for teacher approval.";

    startRequestPolling();

  } catch (error) {
    message.textContent = error.message;
    console.error("Join error:", error);
  }
});

// ACCEPT SCREEN REQUEST

acceptButton.addEventListener("click", async () => {
  if (!currentRequest) return;

  acceptButton.disabled = true;

  requestMessage.textContent =
    "Choose the screen or window you want to share.";

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });

    await control("student_respond", {
      requestId: currentRequest.id,
      accepted: true
    });

    preview.srcObject = screenStream;
    preview.hidden = false;

    peer = new RTCPeerConnection(rtcConfig);

    peer.onicecandidate = event => {
      if (event.candidate) {
        sendSignal({
          type: "candidate",
          candidate: event.candidate
        }).catch(console.error);
      }
    };

    screenStream.getTracks().forEach(track => {
      peer.addTrack(track, screenStream);
    });

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    await sendSignal({
      type: "offer",
      description: peer.localDescription
    });

    lastSignalId = 0;
    startSignalPolling();

    requestMessage.textContent =
      "Waiting for your teacher to connect. You can stop sharing anytime.";

    acceptButton.hidden = true;
    declineButton.hidden = true;
    stopButton.hidden = false;

    screenStream.getVideoTracks()[0].addEventListener(
      "ended",
      stopSharing
    );

  } catch (error) {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
    }

    screenStream = null;
    preview.srcObject = null;
    preview.hidden = true;

    if (peer) peer.close();
    peer = null;

    try {
      await control("student_respond", {
        requestId: currentRequest.id,
        accepted: false
      });
    } catch {}

    requestMessage.textContent =
      error.name === "NotAllowedError"
        ? "You cancelled screen sharing."
        : error.message;

    currentRequest = null;
    acceptButton.disabled = false;
    acceptButton.hidden = true;
    declineButton.hidden = true;

    startRequestPolling();
  }
});

// DECLINE REQUEST

declineButton.addEventListener("click", async () => {
  if (!currentRequest) return;

  try {
    await control("student_respond", {
      requestId: currentRequest.id,
      accepted: false
    });

    requestMessage.textContent = "You declined the request.";

  } catch (error) {
    requestMessage.textContent = error.message;
  }

  currentRequest = null;
  acceptButton.hidden = true;
  declineButton.hidden = true;

  startRequestPolling();
});

// STOP SHARING

async function stopSharing() {
  const requestId = currentRequest?.id;

  clearInterval(signalTimer);

  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
  }

  if (peer) peer.close();

  screenStream = null;
  peer = null;
  pendingCandidates = [];

  preview.srcObject = null;
  preview.hidden = true;
  stopButton.hidden = true;

  if (requestId) {
    try {
      await control("stop_sharing", { requestId });
    } catch (error) {
      console.error(error);
    }
  }

  currentRequest = null;
  requestMessage.textContent = "Screen sharing stopped.";
}

stopButton.addEventListener("click", stopSharing);

// RESTORE STUDENT SESSION

async function restoreSession() {
  try {
    const saved = await storageGet(["mixyStudentSession"]);

    if (!saved.mixyStudentSession?.token) return;

    session = saved.mixyStudentSession;

    form.hidden = true;
    shareSection.style.display = "block";

    message.textContent = "Joined classroom!";
    requestMessage.textContent = "Checking for teacher requests...";

    startRequestPolling();

  } catch (error) {
    message.textContent = error.message;
    console.error("Session restore error:", error);
  }
}

restoreSession();

