import WebRTCP2P from './webrtc-firebase.js';
import $ from 'jquery';

// WebRTC P2P UI Integration dengan jQuery
$(document).ready(function() {
    // Inisialisasi library WebRTC P2P
    const p2p = new WebRTCP2P();
    let isHost = false;
    let isConnected = false;
    
    // Firebase configuration - ganti dengan config Anda
    const firebaseConfig = {
      apiKey: "AIzaSyCr1UChjglXhfjxasX9dJCsCt1ZW5trfqw",
      authDomain: "webrtc-tunnel.firebaseapp.com",
      databaseURL: "https://webrtc-tunnel-default-rtdb.asia-southeast1.firebasedatabase.app/",
      projectId: "webrtc-tunnel",
      storageBucket: "webrtc-tunnel.appspot.com",
      messagingSenderId: "638989893698",
      appId: "1:638989893698:web:b4b067233a0e731fb26ddb"
    };
    
    // Set Firebase config
    try {
        p2p.setFirebaseConfig(firebaseConfig);
        console.log('✅ Firebase berhasil dikonfigurasi');
    } catch (error) {
        console.error('❌ Error konfigurasi Firebase:', error);
        updateStatus('Error: Firebase config invalid', 'error');
        return;
    }
    
    // Setup event listeners untuk WebRTC
    setupWebRTCListeners();
    
    // Setup UI event listeners
    setupUIListeners();
    
    // Fungsi untuk setup WebRTC event listeners
    function setupWebRTCListeners() {
        // Listener untuk pesan masuk
        p2p.onMessage((message) => {
            console.log('📨 Pesan diterima:', message);
            
            try {
                // Coba parse sebagai JSON
                const jsonData = JSON.parse(message);
                console.log('📋 JSON Data:', jsonData);
                
                // Tampilkan di console dengan format yang rapi
                if (jsonData.type) {
                    console.log(`📝 Tipe: ${jsonData.type}`);
                    console.log('📄 Payload:', jsonData.payload || jsonData);
                }
            } catch (e) {
                // Jika bukan JSON, tampilkan sebagai plain text
                console.log('💬 Plain Text:', message);
            }
        });
        
        // Listener untuk status koneksi
        p2p.onConnection((status) => {
            console.log('🔗 Status koneksi:', status);
            
            switch (status) {
                case 'connected':
                    isConnected = true;
                    updateStatus('Connected', 'success');
                    enableMessageInput();
                    console.log('✅ Koneksi berhasil! Sekarang bisa mengirim pesan.');
                    break;
                    
                case 'connecting':
                    updateStatus('Connecting...', 'warning');
                    break;
                    
                case 'disconnected':
                    isConnected = false;
                    updateStatus('Disconnected', 'error');
                    disableMessageInput();
                    console.log('❌ Koneksi terputus.');
                    break;
                    
                case 'failed':
                    isConnected = false;
                    updateStatus('Connection Failed', 'error');
                    disableMessageInput();
                    console.log('❌ Koneksi gagal.');
                    break;
                    
                default:
                    console.log('🔄 Status:', status);
            }
        });
        
        // Listener untuk error
        p2p.onError((error) => {
            console.error('❌ WebRTC Error:', error);
            updateStatus('Error: ' + error.message, 'error');
        });
        
        // Listener untuk file (opsional, jika diperlukan)
        p2p.onFile((file, fileName, fileType) => {
            console.log('📁 File diterima:', fileName, fileType, file);
        });
    }
    
    // Fungsi untuk setup UI event listeners
    function setupUIListeners() {
        // Event listener untuk tombol Create Room
        $('#create-room').click(async function() {
            try {
                $(this).prop('disabled', true).text('Creating...');
                updateStatus('Creating room...', 'warning');
                
                console.log('🏠 Membuat room...');
                
                // Inisiasi sebagai host
                const roomId = await p2p.initiate();
                isHost = true;
                
                // Tampilkan room ID
                $('#room-id').text(roomId);
                console.log('✅ Room berhasil dibuat dengan ID:', roomId);
                
                // Update UI
                updateStatus('Room created, waiting for connection...', 'warning');
                $(this).text('Room Created').addClass('btn-success');
                
                // Copy room ID ke clipboard (opsional)
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(roomId);
                    console.log('📋 Room ID disalin ke clipboard');
                }
                
            } catch (error) {
                console.error('❌ Error membuat room:', error);
                updateStatus('Failed to create room', 'error');
                $(this).prop('disabled', false).text('Create Room');
            }
        });
        
        // Event listener untuk tombol Connect Now
        $('#connect-button').click(async function() {
            const partnerId = $('#partnerid').val().trim();
            
            if (!partnerId) {
                alert('Masukkan Partner Remote ID terlebih dahulu');
                $('#partnerid').focus();
                return;
            }
            
            try {
                $(this).prop('disabled', true).text('Connecting...');
                updateStatus('Connecting...', 'warning');
                
                console.log('🔌 Mencoba terhubung ke room:', partnerId);
                
                // Join sebagai client
                await p2p.call(partnerId);
                isHost = false;
                
                console.log('✅ Berhasil join ke room:', partnerId);
                
            } catch (error) {
                console.error('❌ Error connecting:', error);
                updateStatus('Failed to connect', 'error');
                $(this).prop('disabled', false).text('Connect now');
                
                // Show error message
                alert('Gagal terhubung ke room. Pastikan Room ID benar dan room masih aktif.');
            }
        });
        
        // Event listener untuk tombol Send Message
        $('#send-msg').click(function() {
            sendMessage();
        });
        
        // Event listener untuk Enter key pada textarea
        $('#text-msg').keypress(function(e) {
            if (e.which === 13 && !e.shiftKey) { // Enter tanpa Shift
                e.preventDefault();
                sendMessage();
            }
        });
        
        // Event listener untuk input Partner ID (Enter key)
        $('#partnerid').keypress(function(e) {
            if (e.which === 13) { // Enter key
                $('#connect-button').click();
            }
        });
    }
    
    // Fungsi untuk mengirim pesan
    function sendMessage() {
        if (!isConnected) {
            alert('Belum terhubung! Hubungkan terlebih dahulu.');
            return;
        }
        
        const message = $('#text-msg').val().trim();
        if (!message) {
            alert('Masukkan pesan terlebih dahulu');
            $('#text-msg').focus();
            return;
        }
        
        try {
            // Buat object pesan dengan metadata
            const messageData = {
                type: 'chat_message',
                message: message,
                timestamp: Date.now(),
                from: isHost ? 'Host' : 'Client',
                id: Math.random().toString(36).substring(2, 15)
            };
            
            // Kirim pesan
            p2p.sendMessage(messageData);
            
            // Log pesan yang dikirim
            console.log('📤 Pesan dikirim:', messageData);
            
            // Clear textarea
            $('#text-msg').val('');
            
            // Show success feedback
            showSendFeedback();
            
        } catch (error) {
            console.error('❌ Error mengirim pesan:', error);
            alert('Gagal mengirim pesan: ' + error.message);
        }
    }
    
    // Fungsi untuk update status
    function updateStatus(message, type = 'info') {
        const $status = $('#status');
        
        // Remove existing status classes
        $status.removeClass('text-success text-warning text-danger text-info');
        
        // Add appropriate class based on type
        switch (type) {
            case 'success':
                $status.addClass('text-success').text('🟢 ' + message);
                break;
            case 'warning':
                $status.addClass('text-warning').text('🟡 ' + message);
                break;
            case 'error':
                $status.addClass('text-danger').text('🔴 ' + message);
                break;
            default:
                $status.addClass('text-info').text('🔵 ' + message);
        }
    }
    
    // Fungsi untuk enable message input
    function enableMessageInput() {
        $('#text-msg').prop('disabled', false).attr('placeholder', 'Write a Message...');
        $('#send-msg').prop('disabled', false);
    }
    
    // Fungsi untuk disable message input
    function disableMessageInput() {
        $('#text-msg').prop('disabled', true).attr('placeholder', 'Connect first to send messages...');
        $('#send-msg').prop('disabled', true);
    }
    
    // Fungsi untuk show feedback saat mengirim pesan
    function showSendFeedback() {
        const $button = $('#send-msg');
        const originalText = $button.text();
        
        $button.text('Sent!').addClass('btn-success');
        
        setTimeout(() => {
            $button.text(originalText).removeClass('btn-success');
        }, 1000);
    }
    
    // Fungsi untuk disconnect (opsional - bisa dipanggil manual)
    window.disconnect = async function() {
        try {
            await p2p.disconnect();
            console.log('✅ Disconnected successfully');
            
            // Reset UI
            isConnected = false;
            isHost = false;
            updateStatus('Disconnected', 'error');
            disableMessageInput();
            
            // Reset buttons
            $('#create-room').prop('disabled', false).text('Create Room').removeClass('btn-success');
            $('#connect-button').prop('disabled', false).text('Connect now');
            $('#room-id').text('-');
            $('#partnerid').val('');
            
        } catch (error) {
            console.error('❌ Error disconnecting:', error);
        }
    };
    
    // Initialize UI state
    updateStatus('Disconnected', 'error');
    disableMessageInput();
    
    // Additional utility functions
    
    // Fungsi untuk mengirim data JSON custom
    window.sendCustomData = function(type, payload) {
        if (!isConnected) {
            console.error('❌ Belum terhubung!');
            return;
        }
        
        const data = {
            type: type,
            payload: payload,
            timestamp: Date.now(),
            from: isHost ? 'Host' : 'Client'
        };
        
        p2p.sendMessage(data);
        console.log('📤 Custom data dikirim:', data);
    };
    
    // Fungsi untuk testing - mengirim berbagai jenis data
    window.testSendData = function() {
        if (!isConnected) {
            console.error('❌ Belum terhubung!');
            return;
        }
        
        // Test data 1: User info
        setTimeout(() => {
            sendCustomData('user_info', {
                name: 'Test User',
                browser: navigator.userAgent,
                screen: {
                    width: screen.width,
                    height: screen.height
                }
            });
        }, 1000);
        
        // Test data 2: System info
        setTimeout(() => {
            sendCustomData('system_info', {
                platform: navigator.platform,
                language: navigator.language,
                cookieEnabled: navigator.cookieEnabled,
                onLine: navigator.onLine
            });
        }, 2000);
        
        // Test data 3: Custom command
        setTimeout(() => {
            sendCustomData('command', {
                action: 'ping',
                parameters: {
                    timestamp: Date.now(),
                    message: 'Hello from ' + (isHost ? 'Host' : 'Client')
                }
            });
        }, 3000);
        
        console.log('🧪 Test data akan dikirim dalam 3 detik...');
    };
    
    // Log info untuk debugging
    console.log('🚀 WebRTC P2P UI berhasil diinisialisasi');
    console.log('💡 Tips:');
    console.log('  - Gunakan disconnect() untuk memutus koneksi');
    console.log('  - Gunakan sendCustomData(type, payload) untuk kirim data custom');
    console.log('  - Gunakan testSendData() untuk test kirim berbagai data');
});