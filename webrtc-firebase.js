// Import Firebase v9+ modules
import { initializeApp } from 'firebase/app';
import { 
  getDatabase, 
  ref, 
  set, 
  push, 
  onValue, 
  get, 
  remove,
  serverTimestamp,
  off
} from 'firebase/database';

class WebRTCP2P {
  constructor() {
    this.firebaseConfig = null;
    this.app = null;
    this.db = null;
    this.localConnection = null;
    this.dataChannel = null;
    this.sessionId = null;
    this.isInitiator = false;
    this.onMessageCallback = null;
    this.onFileCallback = null;
    this.onConnectionCallback = null;
    this.onErrorCallback = null;
    this.remoteCandidatesBuffer = [];
    // Firebase listeners untuk cleanup
    this.firebaseListeners = [];
    
    // ICE servers untuk NAT traversal
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];
  }

  /**
   * Set konfigurasi Firebase
   * @param {Object} config - Firebase configuration object
   */
  setFirebaseConfig(config) {
    try {
      this.firebaseConfig = config;
      
      // Initialize Firebase app
      this.app = initializeApp(this.firebaseConfig);
      
      // Initialize Realtime Database
      this.db = getDatabase(this.app);
      
      console.log('Firebase berhasil dikonfigurasi');
    } catch (error) {
      console.error('Error konfigurasi Firebase:', error);
      throw new Error(`Firebase initialization failed: ${error.message}`);
    }
  }

  /**
   * Inisiasi sebagai host - membuat session baru
   * @returns {Promise<string>} Session ID yang digenerate
   */
  async initiate() {
    if (!this.db) {
      throw new Error('Firebase belum dikonfigurasi. Panggil setFirebaseConfig() terlebih dahulu.');
    }

    try {
      this.isInitiator = true;
      
      // Generate random session ID
      this.sessionId = this._generateSessionId();
      
      // Setup WebRTC connection
      await this._setupWebRTCConnection();
      
      // Create data channel (hanya initiator yang membuat channel)
      this.dataChannel = this.localConnection.createDataChannel('messages', {
        ordered: true
      });
      this._setupDataChannel(this.dataChannel);
      
      // Setup Firebase listeners untuk signaling
      this._setupFirebaseListeners();
      
      // Create offer
      const offer = await this.localConnection.createOffer();
      await this.localConnection.setLocalDescription(offer);
      
      // Simpan offer ke Firebase
      const offerRef = ref(this.db, `sessions/${this.sessionId}/offer`);
      await set(offerRef, {
        type: offer.type,
        sdp: offer.sdp,
        timestamp: serverTimestamp()
      });
      
      console.log(`Session berhasil dibuat dengan ID: ${this.sessionId}`);
      return this.sessionId;
    } catch (error) {
      console.error('Error saat inisiasi:', error);
      throw error;
    }
  }

  /**
   * Panggil session yang sudah ada
   * @param {string} sessionId - ID session yang ingin disambungkan
   */
  async call(sessionId) {
    if (!this.db) {
      throw new Error('Firebase belum dikonfigurasi. Panggil setFirebaseConfig() terlebih dahulu.');
    }

    try {
      this.sessionId = sessionId;
      this.isInitiator = false;
      
      // Setup WebRTC connection
      await this._setupWebRTCConnection();
      
      // Setup Firebase listeners
      this._setupFirebaseListeners();
      
      // Ambil offer dari Firebase
      const offerRef = ref(this.db, `sessions/${sessionId}/offer`);
      const offerSnapshot = await get(offerRef);
      const offerData = offerSnapshot.val();
      
      if (!offerData) {
        throw new Error(`Session dengan ID ${sessionId} tidak ditemukan.`);
      }
      
      // Set remote description
      await this.localConnection.setRemoteDescription(new RTCSessionDescription(offerData));
      await this._processBufferedCandidates();
      // Create answer
      const answer = await this.localConnection.createAnswer();
      await this.localConnection.setLocalDescription(answer);
      
      // Simpan answer ke Firebase
      const answerRef = ref(this.db, `sessions/${sessionId}/answer`);
      await set(answerRef, {
        type: answer.type,
        sdp: answer.sdp,
        timestamp: serverTimestamp()
      });
      
      console.log(`Berhasil join ke session: ${sessionId}`);
    } catch (error) {
      console.error('Error saat call:', error);
      throw error;
    }
  }

  /**
   * Kirim pesan JSON
   * @param {Object|string} message - Pesan yang akan dikirim
   */
  sendMessage(message) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel belum terbuka. Pastikan koneksi sudah established.');
    }
    
    try {
      const data = {
        type: 'message',
        payload: typeof message === 'string' ? message : JSON.stringify(message),
        timestamp: Date.now()
      };
      
      this.dataChannel.send(JSON.stringify(data));
    } catch (error) {
      console.error('Error mengirim pesan:', error);
      if (this.onErrorCallback) {
        this.onErrorCallback(error);
      }
    }
  }

  /**
   * Kirim file
   * @param {File} file - File yang akan dikirim
   * @param {Function} progressCallback - Optional callback untuk progress (percentage)
   */
  async sendFile(file, progressCallback = null) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel belum terbuka. Pastikan koneksi sudah established.');
    }
    
    try {
      const CHUNK_SIZE = 16384; // 16KB chunks
      
      // Kirim metadata file terlebih dahulu
      const metadata = {
        type: 'file_start',
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        timestamp: Date.now()
      };
      
      this.dataChannel.send(JSON.stringify(metadata));
      
      // Baca dan kirim file dalam chunks
      let offset = 0;
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      let chunkIndex = 0;
      
      const sendNextChunk = async () => {
        if (offset >= file.size) {
          // Kirim sinyal selesai
          const endData = {
            type: 'file_end',
            fileName: file.name,
            timestamp: Date.now()
          };
          this.dataChannel.send(JSON.stringify(endData));
          return;
        }
        
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const arrayBuffer = await slice.arrayBuffer();
        
        const chunkData = {
          type: 'file_chunk',
          data: Array.from(new Uint8Array(arrayBuffer)), // Convert to array for JSON
          offset: offset,
          chunkIndex: chunkIndex,
          isLast: offset + CHUNK_SIZE >= file.size
        };
        
        this.dataChannel.send(JSON.stringify(chunkData));
        
        // Update progress
        if (progressCallback) {
          const progress = Math.round((chunkIndex + 1) / totalChunks * 100);
          progressCallback(progress);
        }
        
        offset += CHUNK_SIZE;
        chunkIndex++;
        
        // Send next chunk dengan delay kecil untuk mencegah overwhelming
        setTimeout(sendNextChunk, 10);
      };
      
      await sendNextChunk();
    } catch (error) {
      console.error('Error mengirim file:', error);
      if (this.onErrorCallback) {
        this.onErrorCallback(error);
      }
    }
  }

  /**
   * Set callback untuk menerima pesan
   * @param {Function} callback - Callback function(message)
   */
  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  /**
   * Set callback untuk menerima file
   * @param {Function} callback - Callback function(file, fileName, fileType)
   */
  onFile(callback) {
    this.onFileCallback = callback;
  }

  /**
   * Set callback untuk status koneksi  
   * @param {Function} callback - Callback function(status)
   */
  onConnection(callback) {
    this.onConnectionCallback = callback;
  }

  /**
   * Set callback untuk error
   * @param {Function} callback - Callback function(error)
   */
  onError(callback) {
    this.onErrorCallback = callback;
  }

  /**
   * Tutup koneksi dan bersihkan session
   */
  async disconnect() {
    try {
      // Remove Firebase listeners
      this._cleanupFirebaseListeners();
      
      if (this.dataChannel) {
        this.dataChannel.close();
        this.dataChannel = null;
      }
      
      if (this.localConnection) {
        this.localConnection.close();
        this.localConnection = null;
      }
      
      // Hapus session dari Firebase (hanya initiator)
      if (this.sessionId && this.isInitiator && this.db) {
        const sessionRef = ref(this.db, `sessions/${this.sessionId}`);
        await remove(sessionRef);
      }
      
      console.log('Koneksi berhasil ditutup');
    } catch (error) {
      console.error('Error saat disconnect:', error);
      if (this.onErrorCallback) {
        this.onErrorCallback(error);
      }
    }
  }

  // === PRIVATE METHODS ===

  _generateSessionId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  async _setupWebRTCConnection() {
    this.localConnection = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    // Handle ICE candidates
    this.localConnection.onicecandidate = async (event) => {
      if (event.candidate && this.db && this.sessionId) {
        try {
          // Simpan ICE candidate ke Firebase
          const candidatesRef = ref(this.db, `sessions/${this.sessionId}/candidates`);
          const newCandidateRef = push(candidatesRef);
          await set(newCandidateRef, {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            from: this.isInitiator ? 'initiator' : 'caller',
            timestamp: serverTimestamp()
          });
        } catch (error) {
          console.error('Error saving ICE candidate:', error);
        }
      }
    };

    // Handle connection state changes
    this.localConnection.onconnectionstatechange = () => {
      const state = this.localConnection.connectionState;
      console.log('Connection state:', state);
      
      if (this.onConnectionCallback) {
        this.onConnectionCallback(state);
      }
      
      // Handle connection errors
      if (state === 'failed' || state === 'disconnected') {
        if (this.onErrorCallback) {
          this.onErrorCallback(new Error(`Connection ${state}`));
        }
      }
    };

    // Handle ICE connection state changes
    this.localConnection.oniceconnectionstatechange = () => {
      const state = this.localConnection.iceConnectionState;
      console.log('ICE connection state:', state);
    };

    // Handle incoming data channel (untuk non-initiator)
    this.localConnection.ondatachannel = (event) => {
      const channel = event.channel;
      this._setupDataChannel(channel);
      this.dataChannel = channel;
    };
  }

  _setupDataChannel(channel) {
    const fileBuffers = new Map(); // Untuk menyimpan file chunks
    
    channel.onopen = () => {
      console.log('Data channel terbuka');
      if (this.onConnectionCallback) {
        this.onConnectionCallback('connected');
      }
    };

    channel.onclose = () => {
      console.log('Data channel tertutup');
      if (this.onConnectionCallback) {
        this.onConnectionCallback('disconnected');
      }
    };

    channel.onerror = (error) => {
      console.error('Data channel error:', error);
      if (this.onErrorCallback) {
        this.onErrorCallback(error);
      }
    };

    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'message') {
          if (this.onMessageCallback) {
            this.onMessageCallback(data.payload);
          }
        } else if (data.type === 'file_start') {
          // Mulai menerima file
          fileBuffers.set(data.fileName, {
            chunks: new Array(Math.ceil(data.fileSize / 16384)), // Pre-allocate array
            metadata: data,
            receivedChunks: 0,
            totalChunks: Math.ceil(data.fileSize / 16384)
          });
          console.log(`Mulai menerima file: ${data.fileName} (${data.fileSize} bytes)`);
        } else if (data.type === 'file_chunk') {
          // Terima chunk file
          const fileName = Array.from(fileBuffers.keys())[0]; // Ambil file yang sedang diterima
          if (fileName && fileBuffers.has(fileName)) {
            const fileData = fileBuffers.get(fileName);
            
            // Store chunk at correct index
            fileData.chunks[data.chunkIndex] = new Uint8Array(data.data);
            fileData.receivedChunks++;
            
            console.log(`Received chunk ${data.chunkIndex + 1}/${fileData.totalChunks} for ${fileName}`);
            
            // Check if all chunks received
            if (fileData.receivedChunks === fileData.totalChunks) {
              // Gabungkan semua chunks
              let totalSize = 0;
              fileData.chunks.forEach(chunk => {
                if (chunk) totalSize += chunk.length;
              });
              
              const completeFile = new Uint8Array(totalSize);
              let offset = 0;
              
              fileData.chunks.forEach(chunk => {
                if (chunk) {
                  completeFile.set(chunk, offset);
                  offset += chunk.length;
                }
              });
              
              // Buat blob dan panggil callback
              const blob = new Blob([completeFile], { type: fileData.metadata.fileType });
              
              if (this.onFileCallback) {
                this.onFileCallback(blob, fileData.metadata.fileName, fileData.metadata.fileType);
              }
              
              console.log(`File ${fileName} berhasil diterima lengkap`);
              
              // Bersihkan buffer
              fileBuffers.delete(fileName);
            }
          }
        } else if (data.type === 'file_end') {
          console.log(`Transfer file ${data.fileName} selesai`);
        }
      } catch (error) {
        console.error('Error parsing message:', error);
        if (this.onErrorCallback) {
          this.onErrorCallback(error);
        }
      }
    };
  }

  _setupFirebaseListeners() {
    // Listen untuk answer (hanya untuk initiator)
    if (this.isInitiator) {
      const answerRef = ref(this.db, `sessions/${this.sessionId}/answer`);
      const answerListener = onValue(answerRef, async (snapshot) => {
        const answerData = snapshot.val();
        if (answerData && this.localConnection && this.localConnection.signalingState !== 'stable') {
          try {
            await this.localConnection.setRemoteDescription(new RTCSessionDescription(answerData));
            await this._processBufferedCandidates();
            console.log('Remote description set from answer');
          } catch (error) {
            console.error('Error setting remote description:', error);
          }
        }
      });
      this.firebaseListeners.push({ ref: answerRef, listener: answerListener });
    }

    // Listen untuk ICE candidates
    const candidatesRef = ref(this.db, `sessions/${this.sessionId}/candidates`);
    const candidatesListener = onValue(candidatesRef, async (snapshot) => {
      const candidates = snapshot.val();
      if (candidates) {
        for (const [key, candidateData] of Object.entries(candidates)) {
          const isFromOtherPeer = this.isInitiator ? 
            candidateData.from === 'caller' : 
            candidateData.from === 'initiator';

          if (isFromOtherPeer) {
            const candidate = new RTCIceCandidate({
              candidate: candidateData.candidate,
              sdpMid: candidateData.sdpMid,
              sdpMLineIndex: candidateData.sdpMLineIndex
            });

            try {
              if (this.localConnection && this.localConnection.remoteDescription) {
                // Jika remote description sudah ada, langsung tambahkan
                await this.localConnection.addIceCandidate(candidate);
              } else {
                // Jika belum, simpan di buffer
                console.log('Buffering ICE candidate...');
                this.remoteCandidatesBuffer.push(candidate);
              }
            } catch (error) {
              // Log error, tapi jangan hentikan proses jika hanya buffer
              if (this.localConnection && this.localConnection.remoteDescription) {
                  console.error('Error adding ICE candidate:', error);
              }
            }
          }
        }
      }
    });
    this.firebaseListeners.push({ ref: candidatesRef, listener: candidatesListener });
  }

  async _processBufferedCandidates() {
    console.log(`Processing ${this.remoteCandidatesBuffer.length} buffered candidates.`);
    while (this.remoteCandidatesBuffer.length > 0) {
        const candidate = this.remoteCandidatesBuffer.shift(); // Ambil dari depan
        try {
            if (this.localConnection) {
                await this.localConnection.addIceCandidate(candidate);
                console.log('Added buffered candidate.');
            }
        } catch (error) {
            console.error('Error adding buffered ICE candidate:', error);
        }
    }
  }

  _cleanupFirebaseListeners() {
    this.firebaseListeners.forEach(({ ref, listener }) => {
      off(ref, 'value', listener);
    });
    this.firebaseListeners = [];
  }
}

export default WebRTCP2P;