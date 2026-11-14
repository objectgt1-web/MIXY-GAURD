
const SUPABASE_URL = "https://oikvlwlavggcanjnugco.supabase.co";
const SUPABASE_KEY = "sb_publishable_d2QW2n-Y2_bMlGexo0aOaA_FcK7mFuB";

let accessToken = "";
let currentUser = null;

let activeRequest = null;
let teacherPeer = null;
let signalTimer = null;
let lastSignalId = 0;
let pendingCandidates = [];
let handlingSignals = false;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

// CHROME STORAGE

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.storage?.local) {
      reject(new Error("Open the dashboard from the MIXY GUARD extension."));
      return;
    }

    chrome.storage.local.get(keys, result => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result || {});
    });
  });
}

function storageSet(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

// API

async function api(path, options = {}) {
  const response = await fetch(SUPABASE_URL + path, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.msg ||
      data?.error_description ||
      data?.error ||
      text ||
      "Request failed"
    );
  }

  return data;
}

async function teacherControl(action, extra = {}) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/screen-control`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action, ...extra })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Screen control failed");
  }

  return result;
}

// LOGIN

function showLogin() {
  document.getElementById("loginSection").classList.remove("hidden");
  document.getElementById("dashboardSection").classList.add("hidden");
  document.getElementById("logout").classList.add("hidden");
}

function showDashboard() {
  document.getElementById("loginSection").classList.add("hidden");
  document.getElementById("dashboardSection").classList.remove("hidden");
  document.getElementById("logout").classList.remove("hidden");
}

async function loadDashboard() {
  showDashboard();
  await loadClassrooms();
}

document.getElementById("loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  const button = document.getElementById("loginButton");
  const message = document.getElementById("loginMessage");

  button.disabled = true;
  message.textContent = "Signing in...";

  try {
    const response = await fetch(
      SUPABASE_URL + "/auth/v1/token?grant_type=password",
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: document.getElementById("email").value.trim(),
          password: document.getElementById("password").value
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.msg || data.message || "Login failed");
    }

    accessToken = data.access_token;
    currentUser = data.user;

    await storageSet({
      mixyGuardToken: accessToken,
      mixyGuardUser: currentUser
    });

    message.textContent = "";
    await loadDashboard();

  } catch (error) {
    message.textContent = "Login error: " + error.message;
  } finally {
    button.disabled = false;
  }
});

document.getElementById("logout").addEventListener("click", async () => {
  closeTeacherViewer();

  accessToken = "";
  currentUser = null;

  await storageRemove(["mixyGuardToken", "mixyGuardUser"]);
  showLogin();
});

// CLASSROOM CREATION

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));

  return Array.from(bytes, b => chars[b % chars.length]).join("");
}

document.getElementById("createForm").addEventListener("submit", async e => {
  e.preventDefault();

  const button = document.getElementById("createButton");
  const message = document.getElementById("createMessage");
  const name = document.getElementById("className").value.trim();

  if (!name) return;

  button.disabled = true;
  message.textContent = "Creating classroom...";

  try {
    await api("/rest/v1/classrooms", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        teacher_id: currentUser.id,
        class_name: name,
        join_code: makeCode()
      })
    });

    document.getElementById("className").value = "";
    message.textContent = "Classroom created!";
    await loadClassrooms();

  } catch (error) {
    message.textContent = "Error: " + error.message;
  } finally {
    button.disabled = false;
  }
});

// STUDENT MANAGEMENT

async function setApproval(student, approved) {
  const action = approved ? "approve" : "revoke approval for";

  if (!confirm(`Are you sure you want to ${action} ${student.student_name}?`)) {
    return;
  }

  try {
    await api(
      "/rest/v1/students?id=eq." + encodeURIComponent(student.id),
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ approved })
      }
    );

    await loadClassrooms();

  } catch (error) {
    alert("Could not update approval: " + error.message);
  }
}

async function deleteStudent(student, classroomId) {
  if (!confirm(`Delete ${student.student_name} from this classroom?`)) {
    return;
  }

  try {
    await api(
      "/rest/v1/students?id=eq." + encodeURIComponent(student.id) +
      "&classroom_id=eq." + encodeURIComponent(classroomId),
      {
        method: "DELETE",
        headers: { Prefer: "return=minimal" }
      }
    );

    await loadClassrooms();

  } catch (error) {
    alert("Could not delete student: " + error.message);
  }
}

// VIEWER

function prepareViewer() {
  const area = document.getElementById("screenArea");

  if (!area || document.getElementById("teacherScreenVideo")) return;

  area.innerHTML = "";

  const video = document.createElement("video");
  video.id = "teacherScreenVideo";
  video.autoplay = true;
  video.playsInline = true;
  video.controls = true;
  video.style.width = "100%";
  video.style.maxHeight = "65vh";
  video.style.background = "#000";
  video.style.borderRadius = "10px";

  const closeButton = document.createElement("button");
  closeButton.className = "secondary";
  closeButton.textContent = "CLOSE VIEWER";
  closeButton.style.marginTop = "12px";
  closeButton.addEventListener("click", closeTeacherViewer);

  area.append(video, closeButton);
}

async function requestStudentScreen(student, classroomId, button) {
  if (!student.approved) {
    alert("This student needs teacher approval first.");
    return;
  }

  if (activeRequest) {
    alert("Close the current viewer before requesting another screen.");
    return;
  }

  button.disabled = true;
  button.textContent = "SENDING REQUEST...";

  try {
    const result = await teacherControl("create_request", {
      classroomId,
      studentId: student.id
    });

    const requestId = result?.request?.id;

    if (!requestId) {
      throw new Error("The server did not return a request ID.");
    }

    activeRequest = {
      id: requestId,
      studentName: student.student_name
    };

    console.log("Screen request created:", requestId);

    lastSignalId = 0;
    pendingCandidates = [];

    prepareViewer();

    document.getElementById("screenViewer").classList.remove("hidden");
    document.getElementById("viewerStatus").textContent =
      `Request sent to ${student.student_name}. Waiting for them to accept.`;

    startTeacherSignalPolling();

    button.textContent = "REQUEST SENT";

  } catch (error) {
    console.error("Screen request error:", error);
    alert("Could not request screen: " + error.message);
    button.disabled = false;
    button.textContent = "VIEW SCREEN";
  }
}

// SIGNALING

async function sendTeacherSignal(payload) {
  if (!activeRequest) return;

  await teacherControl("send_signal", {
    requestId: activeRequest.id,
    payload
  });
}

async function addTeacherCandidate(candidate) {
  if (!teacherPeer || !candidate) return;

  if (!teacherPeer.remoteDescription) {
    pendingCandidates.push(candidate);
    return;
  }

  try {
    await teacherPeer.addIceCandidate(
      new RTCIceCandidate(candidate)
    );
  } catch (error) {
    console.error("Teacher ICE error:", error);
  }
}

async function flushTeacherCandidates() {
  const candidates = pendingCandidates;
  pendingCandidates = [];

  for (const candidate of candidates) {
    await addTeacherCandidate(candidate);
  }
}

async function handleStudentSignals() {
  if (!activeRequest || handlingSignals) return;

  handlingSignals = true;

  try {
    const result = await teacherControl("get_signals", {
      requestId: activeRequest.id,
      afterId: lastSignalId
    });

    for (const signal of result.signals || []) {
      lastSignalId = Math.max(lastSignalId, Number(signal.id));

      const payload = signal.payload;

      if (payload.type === "offer") {
        if (teacherPeer) {
          teacherPeer.close();
          teacherPeer = null;
        }

        teacherPeer = new RTCPeerConnection(rtcConfig);

        teacherPeer.onicecandidate = event => {
          if (event.candidate) {
            sendTeacherSignal({
              type: "candidate",
              candidate: event.candidate
            }).catch(error => {
              console.error("Could not send teacher ICE candidate:", error);
            });
          }
        };

        teacherPeer.ontrack = event => {
          const video = document.getElementById("teacherScreenVideo");

          if (video) {
            video.srcObject = event.streams[0];
            video.play().catch(error => {
              console.error("Video playback error:", error);
            });
          }

          document.getElementById("viewerStatus").textContent =
            `Viewing ${activeRequest.studentName}'s shared screen.`;
        };

        teacherPeer.onconnectionstatechange = () => {
          if (!teacherPeer) return;

          const state = teacherPeer.connectionState;

          document.getElementById("viewerStatus").textContent =
            state === "connected"
              ? `Connected to ${activeRequest.studentName}'s screen.`
              : state === "failed" || state === "disconnected"
                ? "Connection interrupted. Check the network or try again."
                : `Connecting... (${state})`;
        };

        await teacherPeer.setRemoteDescription(
          new RTCSessionDescription(payload.description)
        );

        await flushTeacherCandidates();

        const answer = await teacherPeer.createAnswer();
        await teacherPeer.setLocalDescription(answer);

        await sendTeacherSignal({
          type: "answer",
          description: teacherPeer.localDescription
        });

        console.log("Teacher sent WebRTC answer.");
      }

      if (payload.type === "candidate") {
        await addTeacherCandidate(payload.candidate);
      }
    }

  } catch (error) {
    if (!error.message.toLowerCase().includes("not accepted")) {
      console.error("Teacher signal polling failed:", {
        requestId: activeRequest?.id,
        error: error.message
      });

      document.getElementById("viewerStatus").textContent =
        error.message;
    }
  } finally {
    handlingSignals = false;
  }
}

function startTeacherSignalPolling() {
  clearInterval(signalTimer);
  handleStudentSignals();
  signalTimer = setInterval(handleStudentSignals, 1000);
}

// CLOSE VIEWER

function closeTeacherViewer() {
  clearInterval(signalTimer);
  signalTimer = null;

  if (teacherPeer) {
    teacherPeer.close();
    teacherPeer = null;
  }

  pendingCandidates = [];
  activeRequest = null;
  lastSignalId = 0;
  handlingSignals = false;

  const video = document.getElementById("teacherScreenVideo");

  if (video) {
    video.srcObject = null;
  }

  const viewer = document.getElementById("screenViewer");

  if (viewer) {
    viewer.classList.add("hidden");
  }
}

// LOAD STUDENTS

async function loadStudents(classroomId, container) {
  container.textContent = "Loading students...";

  try {
    const students = await api(
      "/rest/v1/students?select=id,student_name,classroom_id,approved&classroom_id=eq." +
      encodeURIComponent(classroomId) +
      "&order=created_at.asc"
    );

    container.innerHTML = "";

    const heading = document.createElement("strong");
    heading.textContent =
      students.length + (students.length === 1 ? " student" : " students");

    container.appendChild(heading);

    if (!students.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No students have joined yet.";
      container.appendChild(empty);
      return 0;
    }

    for (const student of students) {
      const row = document.createElement("div");
      row.className = "student-row";

      const nameButton = document.createElement("button");
      nameButton.className = "student-name";
      nameButton.textContent = student.student_name;

      const status = document.createElement("span");
      status.textContent = student.approved ? "APPROVED" : "PENDING APPROVAL";
      status.style.color = student.approved ? "#86efac" : "#fbbf24";
      status.style.fontSize = "12px";

      const actions = document.createElement("div");
      actions.className = "student-actions";

      const approvalButton = document.createElement("button");
      approvalButton.className = "secondary";
      approvalButton.textContent =
        student.approved ? "REVOKE APPROVAL" : "APPROVE STUDENT";

      approvalButton.addEventListener("click", () => {
        setApproval(student, !student.approved);
      });

      const viewButton = document.createElement("button");
      viewButton.className = "secondary";
      viewButton.textContent = "VIEW SCREEN";
      viewButton.disabled = !student.approved;

      viewButton.addEventListener("click", () => {
        requestStudentScreen(student, classroomId, viewButton);
      });

      const deleteButton = document.createElement("button");
      deleteButton.className = "danger";
      deleteButton.textContent = "DELETE STUDENT";

      deleteButton.addEventListener("click", () => {
        deleteStudent(student, classroomId);
      });

      const panel = document.createElement("div");
      panel.className = "student-panel hidden";
      panel.style.width = "100%";

      const panelTitle = document.createElement("h3");
      panelTitle.textContent = student.student_name;

      const panelInfo = document.createElement("p");
      panelInfo.className = "muted";
      panelInfo.textContent = student.approved
        ? "This student is approved."
        : "This student is waiting for teacher approval.";

      const panelApproval = document.createElement("button");
      panelApproval.className = "secondary";
      panelApproval.textContent =
        student.approved ? "REVOKE APPROVAL" : "APPROVE STUDENT";

      panelApproval.addEventListener("click", () => {
        setApproval(student, !student.approved);
      });

      const panelDelete = document.createElement("button");
      panelDelete.className = "danger";
      panelDelete.textContent = "DELETE STUDENT";

      panelDelete.addEventListener("click", () => {
        deleteStudent(student, classroomId);
      });

      panel.append(panelTitle, panelInfo, panelApproval, panelDelete);

      nameButton.addEventListener("click", () => {
        panel.classList.toggle("hidden");
      });

      actions.append(status, viewButton, approvalButton, deleteButton);
      row.append(nameButton, actions, panel);
      container.appendChild(row);
    }

    return students.length;

  } catch (error) {
    container.textContent = "Could not load students: " + error.message;
    return 0;
  }
}

// LOAD CLASSROOMS

async function loadClassrooms() {
  const container = document.getElementById("classrooms");
  container.textContent = "Loading...";

  try {
    const classes = await api(
      "/rest/v1/classrooms?select=id,class_name,join_code,created_at&order=created_at.desc"
    );

    document.getElementById("classCount").textContent = classes.length;
    container.innerHTML = "";

    let totalStudents = 0;

    if (!classes.length) {
      container.textContent = "No classrooms yet. Create one above.";
      document.getElementById("studentCount").textContent = "0";
      return;
    }

    for (const classroom of classes) {
      const item = document.createElement("div");
      item.className = "classroom";

      const top = document.createElement("div");
      top.className = "classroom-top";

      const info = document.createElement("div");

      const title = document.createElement("strong");
      title.textContent = classroom.class_name;

      const caption = document.createElement("p");
      caption.className = "muted";
      caption.textContent = "Student join code";

      const code = document.createElement("div");
      code.className = "code";
      code.textContent = classroom.join_code;

      info.append(title, caption, code);

      const copy = document.createElement("button");
      copy.textContent = "COPY CODE";

      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(classroom.join_code);
          copy.textContent = "COPIED";
          setTimeout(() => copy.textContent = "COPY CODE", 1500);
        } catch {
          alert("Could not copy code.");
        }
      });

      top.append(info, copy);

      const studentsBox = document.createElement("div");
      studentsBox.className = "students-list";

      item.append(top, studentsBox);
      container.appendChild(item);

      totalStudents += await loadStudents(classroom.id, studentsBox);
    }

    document.getElementById("studentCount").textContent = totalStudents;

  } catch (error) {
    container.textContent = "Could not load classrooms: " + error.message;
  }
}

// START

async function start() {
  try {
    const saved = await storageGet([
      "mixyGuardToken",
      "mixyGuardUser"
    ]);

    if (!saved.mixyGuardToken) {
      showLogin();
      return;
    }

    accessToken = saved.mixyGuardToken;
    currentUser = saved.mixyGuardUser;

    currentUser = await api("/auth/v1/user");

    prepareViewer();
    await loadDashboard();

  } catch (error) {
    console.error("Dashboard startup error:", error);

    if (accessToken) {
      await storageRemove(["mixyGuardToken", "mixyGuardUser"]);
      accessToken = "";
    }

    showLogin();
  }
}

start();
