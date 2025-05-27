import { db } from './webrtc-firebase.js';
import {
  collection, doc, setDoc, getDoc, onSnapshot, addDoc
} from 'firebase/firestore';

let pc = new RTCPeerConnection();
let dataChannel;
let roomRef;

const connectBtn = document.getElementById("connect-button");
const createRoomBtn = document.getElementById("create-room");
const partnerInput = document.getElementById("partnerid");
const roomIdDisplay = document.getElementById("room-id");
const sendMsgBtn = document.getElementById("send-msg");
const msgInput = document.getElementById("text-msg");

createRoomBtn.onclick = async () => {
  dataChannel = pc.createDataChannel("chat");
  setupDataChannel();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  roomRef = doc(collection(db, "rooms"));
  await setDoc(roomRef, { offer: { type: offer.type, sdp: offer.sdp } });

  roomIdDisplay.innerText = roomRef.id;

  // Listen for answer
  onSnapshot(roomRef, async (snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answer = new RTCSessionDescription(data.answer);
      await pc.setRemoteDescription(answer);
    }
  });

  // ICE candidates
  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      await addDoc(collection(roomRef, "callerCandidates"), event.candidate.toJSON());
    }
  };

  onSnapshot(collection(roomRef, "calleeCandidates"), (snapshot) => {
    snapshot.docChanges().forEach(change => {
      if (change.type === "added") {
        pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
      }
    });
  });
};

connectBtn.onclick = async () => {
  const roomId = partnerInput.value;
  roomRef = doc(db, "rooms", roomId);
  const roomSnap = await getDoc(roomRef);
  const roomData = roomSnap.data();

  if (!roomSnap.exists()) {
    alert("Room not found!");
    return;
  }

  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel();
  };

  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      await addDoc(collection(roomRef, "calleeCandidates"), event.candidate.toJSON());
    }
  };

  onSnapshot(collection(roomRef, "callerCandidates"), (snapshot) => {
    snapshot.docChanges().forEach(change => {
      if (change.type === "added") {
        pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
      }
    });
  });

  await pc.setRemoteDescription(new RTCSessionDescription(roomData.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  await setDoc(roomRef, { ...roomData, answer: { type: answer.type, sdp: answer.sdp } });
};

sendMsgBtn.onclick = () => {
  const message = msgInput.value;
  if (dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(message);
    console.log("You:", message);
    msgInput.value = "";
  }
};

function setupDataChannel() {
  dataChannel.onopen = () => {
    console.log("✅ Data channel opened");
    updateStatus("connected");
  };

  dataChannel.onmessage = (event) => {
    console.log("Partner:", event.data);
  };

  dataChannel.onclose = () => {
    console.log("❌ Data channel closed");
    updateStatus("disconnected");
  };
}

function updateStatus(status) {
  const green = document.querySelector(".text-green-800");
  const red = document.querySelector(".text-red-800");
  if (status === "connected") {
    green.classList.remove("hidden");
    red.classList.add("hidden");
  } else {
    green.classList.add("hidden");
    red.classList.remove("hidden");
  }
}
