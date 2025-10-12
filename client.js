// استيراد Firebase SDK
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js'
import { getDatabase, ref, push, onChildAdded, serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-database.js'
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-storage.js'

// ⚠️ استبدل هذه البيانات ببيانات مشروعك من Firebase Console ⚠️
const firebaseConfig = {
  apiKey: "AIzaSyB1AsEHXP05nQ8M66jYPusheLaE60q_JwU",
  authDomain: "mychat-2d881.firebaseapp.com",
  databaseURL: "https://mychat-2d881-default-rtdb.firebaseio.com",
  projectId: "mychat-2d881",
  storageBucket: "mychat-2d881.firebasestorage.app",
  messagingSenderId: "532385733649",
  appId: "1:532385733649:web:7bb6cce9add057acf1e5b0",
  measurementId: "G-2702K5S2V1"
};


// تهيئة Firebase
const app = initializeApp(firebaseConfig)
const database = getDatabase(app)
const storage = getStorage(app)
const messagesRef = ref(database, 'messages')

const messageContainer = document.getElementById('message-container')
const messageForm = document.getElementById('send-container')
const messageInput = document.getElementById('message-input')

// متغيرات الميكروفون
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let audioContext;
let analyser;
let microphone;
let javascriptNode;
let userName = '';

// جودة الصوت
const audioQualities = {
    low: { audioBitsPerSecond: 32000 },
    medium: { audioBitsPerSecond: 64000 },
    high: { audioBitsPerSecond: 128000 }
};

// طلب اسم المستخدم
function getUserName() {
    userName = prompt('ما هو اسمك؟') || 'مستخدم مجهول'
    appendMessage('لقد انضممت للدردشة', 'system')
    
    // إرسال رسالة انضمام للجميع
    push(messagesRef, {
        type: 'system',
        message: `${userName} انضم للدردشة`,
        timestamp: serverTimestamp()
    })
}

// استماع للرسائل الجديدة
onChildAdded(messagesRef, (snapshot) => {
    const data = snapshot.val()
    
    // تجاهل الرسائل القديمة قبل انضمام المستخدم
    if (!userName) return
    
    if (data.type === 'system') {
        // عرض رسائل النظام للجميع
        appendMessage(data.message, 'system')
    } else if (data.type === 'audio') {
        // عرض الرسائل الصوتية
        appendAudioMessage(data.audioURL, 'other', data.userName)
    } else if (data.userName === userName && data.type !== 'audio') {
        // تجاهل رسائلي الخاصة النصية (تم عرضها مسبقاً)
        return
    } else if (data.type === 'message') {
        // عرض رسائل الآخرين النصية
        appendMessage(data.message, 'other', data.userName)
    }
})

// إرسال رسالة جديدة
messageForm.addEventListener('submit', e => {
    e.preventDefault()
    const message = messageInput.value.trim()
    
    if (message === '') return
    
    // عرض الرسالة فوراً
    appendMessage(message, 'self', userName)
    
    // إرسال الرسالة لـ Firebase
    push(messagesRef, {
        message: message,
        userName: userName,
        type: 'message',
        timestamp: serverTimestamp()
    })
    
    messageInput.value = ''
})

// دالة إضافة الرسالة للشاشة
function appendMessage(message, type, userName = '') {
    const messageElement = document.createElement('div')
    messageElement.className = `message ${type}`
    
    if (type === 'self' || type === 'other') {
        messageElement.innerHTML = `<span class="user-name">${userName}:</span> ${message}`
    } else {
        messageElement.textContent = message
    }
    
    messageContainer.append(messageElement)
    messageContainer.scrollTop = messageContainer.scrollHeight
}

// دالة إضافة الرسالة الصوتية
function appendAudioMessage(audioURL, type, userName = '') {
    const messageElement = document.createElement('div')
    messageElement.className = `message audio ${type}`
    
    const audio = new Audio(audioURL);
    
    messageElement.innerHTML = `
        <span class="user-name">${userName} (صوت):</span>
        <audio class="audio-player" controls src="${audioURL}"></audio>
        <span class="audio-duration">${getAudioDuration(audio)}</span>
    `
    
    messageContainer.append(messageElement)
    messageContainer.scrollTop = messageContainer.scrollHeight
    
    // تحديث المدة عندما يتم تحميل الملف
    audio.addEventListener('loadedmetadata', () => {
        const duration = formatTime(audio.duration);
        messageElement.querySelector('.audio-duration').textContent = duration;
    });
}

// تنسيق الوقت
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// حساب مدة الصوت
function getAudioDuration(audio) {
    return '--:--';
}

// بدء التسجيل
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                channelCount: 1,
                sampleRate: 44100,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            } 
        });

        // إعداد المرئيات
        setupAudioVisualizer(stream);

        // إعداد المسجل
        const quality = document.getElementById('audioQuality').value;
        mediaRecorder = new MediaRecorder(stream, audioQualities[quality]);
        
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            
            // عرض الرسالة الصوتية محلياً
            const audioURL = URL.createObjectURL(audioBlob);
            appendAudioMessage(audioURL, 'self', userName);
            
            // رفع الملف لـ Firebase
            await uploadAudioToFirebase(audioBlob, userName);
        };
        
        mediaRecorder.start();
        isRecording = true;
        
        // تحديث الواجهة
        document.querySelector('.mic-btn.record').style.display = 'none';
        document.querySelector('.mic-btn.stop').style.display = 'flex';
        document.querySelector('.recording-indicator').style.display = 'flex';
        
    } catch (error) {
        console.error('Error accessing microphone:', error);
        alert('تعذر الوصول للميكروفون. يرجى التحقق من الصلاحيات.');
    }
}

// إيقاف التسجيل
function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        
        // إيقاف جميع المسارات
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        
        // تحديث الواجهة
        document.querySelector('.mic-btn.record').style.display = 'flex';
        document.querySelector('.mic-btn.stop').style.display = 'none';
        document.querySelector('.recording-indicator').style.display = 'none';
        document.getElementById('micLevel').style.width = '0%';
    }
}

// إعداد المرئيات
function setupAudioVisualizer(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    microphone = audioContext.createMediaStreamSource(stream);
    javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;

    microphone.connect(analyser);
    analyser.connect(javascriptNode);
    javascriptNode.connect(audioContext.destination);

    javascriptNode.onaudioprocess = () => {
        const array = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(array);
        
        let values = 0;
        for (let i = 0; i < array.length; i++) {
            values += array[i];
        }
        
        const average = values / array.length;
        const level = Math.min(average * 2, 100);
        
        document.getElementById('micLevel').style.width = level + '%';
    };
}

// رفع الملف الصوتي لـ Firebase
async function uploadAudioToFirebase(audioBlob, userName) {
    const timestamp = Date.now();
    const audioRef = storageRef(storage, `audios/${userName}_${timestamp}.webm`);
    
    try {
        const snapshot = await uploadBytes(audioRef, audioBlob);
        const downloadURL = await getDownloadURL(snapshot.ref);
        
        // إرسال الرابط للدردشة
        push(messagesRef, {
            type: 'audio',
            audioURL: downloadURL,
            userName: userName,
            timestamp: serverTimestamp()
        });
        
    } catch (error) {
        console.error('Error uploading audio:', error);
        appendMessage('فشل في إرسال الرسالة الصوتية', 'system');
    }
}

// تحكم في حجم الصوت العالمي
document.getElementById('volumeSlider').addEventListener('input', (e) => {
    const volume = e.target.value / 100;
    document.querySelectorAll('audio').forEach(audio => {
        audio.volume = volume;
    });
});

// جعل الدوال متاحة عالمياً للاستخدام في HTML
window.startRecording = startRecording;
window.stopRecording = stopRecording;

// بدء التطبيق
getUserName();
